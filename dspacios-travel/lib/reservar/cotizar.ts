// ─────────────────────────────────────────────────────────────────────────
// Cotización EN VIVO de hoteles por fechas (porción/dinámico) — solo lectura.
// Extraído de app/(dashboard)/dashboard/reservar/actions.ts (paso 1 de la
// separación de ese archivo): liquidarHotelPaquete, cotizarPorFechas y
// buscarHoteles no insertan/actualizan nada, solo consultan y calculan.
// Requiere service-role porque `tarifa_hotel` es interno.
// ─────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import {
  noches,
  liquidarHotelNoches,
  marcar,
  componerTarifa,
  temporadaParaFecha,
  toTemporadaRango,
  minNochesAplicable,
  factorLiquidacion,
  type TemporadaRango,
} from "@/lib/calc/paquetes";
import { defaultAcomConfig, type AcomRoom, type AcomConfig } from "@/lib/acomodaciones";
import {
  validarCantidadMenores,
  validarEdadesMenores,
  validarHabitacionesConsultadas,
  validarAdultosDeclarados,
  validarFechaConsulta,
  validarDestinoConsulta,
  validarPaxTotalConsulta,
  validarPaxServicioConsulta,
  clasificarMenoresPorEdad,
  verificarTarifasMenoresDisponibles,
  type ClasificacionMenores,
} from "@/lib/reservar/edadesMenores";
import { distribuirPorHabitaciones, type HabitacionConsultada } from "@/lib/reservar/distribucionHabitaciones";
import {
  construirContextoServicios, calcularResultadoServicio, resolverLiquidacionServicioPuntual,
  type DatosServicioPar, type ResultadoServicio, type ResultadoServicioPuntual,
} from "@/lib/reservar/liquidacionServicio";

// Acomodaciones (incluye niños e infante) y su columna neta en tarifa_hotel.
const ACOM_ALL = ["sencilla", "doble", "triple", "multiple", "nino", "nino2", "infante"] as const;
const COL_NETO: Record<string, string> = {
  sencilla: "neto_sencilla", doble: "neto_doble", triple: "neto_triple",
  multiple: "neto_multiple", nino: "neto_nino", nino2: "neto_nino2", infante: "neto_infante",
};

export type ComboCotizado = { categoria: string; regimen: string; precios: Record<string, number>; netos?: Record<string, number> };

// ── Liquidación EN VIVO de un hotel para fechas elegidas (motor por fechas) ──
// Reutiliza el mismo motor del generador de tarifario, pero para las noches que
// el asesor elige en Reservar (porción/dinámico). Devuelve SOLO PVP por
// categoría/régimen/acomodación (los costos netos no se exponen al cliente;
// sí se devuelven aquí como `netos`, autoritativos, para uso interno del
// cómputo de la reserva).
export async function liquidarHotelPaquete(
  admin: ReturnType<typeof createAdminClient>,
  paqueteId: number,
  hotelId: number,
  fechaIda: string,
  numNoches: number
): Promise<{ combos: ComboCotizado[]; destinoNombre: string | null; hotelNombre: string | null; minNoches: number; moneda: string } | null> {
  if (numNoches <= 0) return null;
  const { data: pq } = await admin
    .from("armado_paquetes")
    .select("pct_mk, impuesto_fijo, destino_id, destinos(nombre)")
    .eq("id", paqueteId)
    .maybeSingle();
  if (!pq) return null;
  const pctMk = Number(pq.pct_mk) || 0;
  const impuesto = Number(pq.impuesto_fijo) || 0;
  const destinoNombre = (pq.destinos as unknown as { nombre: string } | null)?.nombre ?? null;

  const [{ data: hsel }, { data: temps }, { data: tarifas }, { data: servSel }, { data: blackouts }] = await Promise.all([
    admin.from("armado_hoteles").select("categorias, regimenes, hoteles(nombre, moneda)").eq("paquete_id", paqueteId).eq("hotel_id", hotelId).maybeSingle(),
    admin.from("hotel_temporadas").select("nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts, min_noches, regimen_restringido").eq("hotel_id", hotelId),
    admin.from("tarifa_hotel").select("*").eq("hotel_id", hotelId),
    admin.from("armado_servicios").select("incluido, servicios_adicionales(precio_persona, liquidacion)").eq("paquete_id", paqueteId),
    admin.from("hotel_blackouts").select("fecha_inicio, fecha_fin, total, acomodaciones, categorias").eq("hotel_id", hotelId),
  ]);

  // Black out general del hotel: cierra noches por encima de cualquier vigencia.
  // Si alguna noche de la estadía cae en un cierre total, el hotel no se vende.
  // Los cierres parciales se acumulan como reglas y se evalúan por combo más
  // abajo (migración 145: además de acomodaciones, ahora también por categoría).
  const nochesStay: string[] = [];
  { const base = new Date(`${fechaIda}T00:00:00`).getTime(); for (let n = 0; n < numNoches; n++) nochesStay.push(new Date(base + n * 86_400_000).toISOString().slice(0, 10)); }
  // Cada regla dice qué cierra: categorías vacías = todas; acomodaciones vacías
  // = todas. Si vienen las dos, cierra la INTERSECCIÓN (esas acomodaciones solo
  // dentro de esas categorías).
  const reglasCierre: { categorias: string[]; acomodaciones: string[] }[] = [];
  let cierreTotal = false;
  for (const b of blackouts ?? []) {
    const cubre = nochesStay.some((d) => (b.fecha_inicio as string) <= d && d <= (b.fecha_fin as string));
    if (!cubre) continue;
    if (b.total) { cierreTotal = true; continue; }
    reglasCierre.push({
      categorias: ((b.categorias as string[] | null) ?? []),
      acomodaciones: ((b.acomodaciones as string[] | null) ?? []),
    });
  }
  // ¿Está cerrada esta acomodación dentro de esta categoría?
  const estaCerrada = (categoria: string, acom: string) =>
    reglasCierre.some((r) =>
      (r.categorias.length === 0 || r.categorias.includes(categoria)) &&
      (r.acomodaciones.length === 0 || r.acomodaciones.includes(acom))
    );
  const hotelMeta = hsel?.hoteles as unknown as { nombre: string; moneda?: string | null } | null;
  const monedaHotel = (hotelMeta?.moneda ?? "COP") === "USD" ? "USD" : "COP";
  if (cierreTotal) return { combos: [], destinoNombre, hotelNombre: hotelMeta?.nombre ?? null, minNoches: 1, moneda: monedaHotel };
  const filtroCat = (hsel?.categorias as string[] | null) ?? null;
  const filtroReg = (hsel?.regimenes as string[] | null) ?? null;
  const hotelNombre = hotelMeta?.nombre ?? null;
  const temporadas: TemporadaRango[] = (temps ?? []).map(toTemporadaRango);

  // Servicios INCLUIDOS se hornean por persona (igual que el generador).
  let aporteServ = 0;
  for (const s of servSel ?? []) {
    if (!(s.incluido as boolean)) continue;
    const srv = s.servicios_adicionales as unknown as { precio_persona: number | null; liquidacion: string | null } | null;
    if (srv?.precio_persona == null) continue;
    aporteServ += marcar(Number(srv.precio_persona) || 0, pctMk) * factorLiquidacion(srv.liquidacion, numNoches);
  }

  type TarifaRow = Record<string, unknown>;
  const grupos = new Map<string, Map<string, TarifaRow>>();
  for (const r of (tarifas ?? []) as TarifaRow[]) {
    const cat = (r.tipo_habitacion as string) ?? "";
    const reg = (r.alimentacion as string) ?? "";
    const key = `${cat}|||${reg}`;
    if (!grupos.has(key)) grupos.set(key, new Map());
    grupos.get(key)!.set((r.temporada as string) ?? "", r);
  }

  const combos: ComboCotizado[] = [];
  for (const [key, tempMap] of grupos) {
    const [categoria, regimen] = key.split("|||");
    if (filtroCat && filtroCat.length && !filtroCat.includes(categoria)) continue;
    if (filtroReg && filtroReg.length && !filtroReg.includes(regimen)) continue;
    const precios: Record<string, number> = {};
    const netos: Record<string, number> = {};
    for (const acom of ACOM_ALL) {
      const col = COL_NETO[acom];
      const netoPorTemporada: Record<string, number | null> = {};
      for (const [temp, row] of tempMap) { const v = row[col]; netoPorTemporada[temp] = v == null ? null : Number(v); }
      const costoHotel = liquidarHotelNoches({ fechaIda, numNoches, temporadas, netoPorTemporada, regimen });
      // null = no aplica. En habitaciones, 0 también es "no aplica" (no gratis);
      // en niños e infante el 0 sí es válido (gratis).
      const esRoom = acom !== "nino" && acom !== "nino2" && acom !== "infante";
      if (costoHotel == null) continue;
      if (esRoom && costoHotel <= 0) continue;
      const t = componerTarifa({ aporteHotel: marcar(costoHotel, pctMk), aporteServicios: aporteServ, aporteVuelo: 0, impuesto, moneda: monedaHotel });
      precios[acom] = t.pvp;
      netos[acom] = costoHotel; // costo neto/persona — fuente del costo al reservar
    }
    if (Object.keys(precios).length) combos.push({ categoria, regimen, precios, netos });
  }
  // Quita lo cerrado por blackout. Se evalúa por (categoría, acomodación), así
  // que un cierre puede llevarse una categoría entera, una acomodación en todas
  // las categorías, o solo una acomodación dentro de una categoría.
  if (reglasCierre.length) {
    for (const c of combos) {
      for (const a of Object.keys(c.precios)) {
        if (estaCerrada(c.categoria, a)) { delete c.precios[a]; delete c.netos?.[a]; }
      }
    }
  }
  const combosF = combos.filter((c) => Object.keys(c.precios).some((a) => a !== "nino" && a !== "nino2" && a !== "infante"));
  return { combos: combosF, destinoNombre, hotelNombre, minNoches: minNochesAplicable(temporadas, fechaIda), moneda: monedaHotel };
}

export type CotizarResult =
  | { ok: true; combos: ComboCotizado[]; noches: number; moneda: string }
  | { ok: false; error: string };

/** Cotiza un hotel para las fechas que elige el asesor (porción/dinámico). */
export async function cotizarPorFechas(input: {
  paqueteId: number; hotelId: number; fechaIda: string; fechaRegreso: string;
}): Promise<CotizarResult> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "Cotización por fechas no disponible (falta service-role)." };
  if (!input.fechaIda || !input.fechaRegreso) return { ok: false, error: "Indica fecha de ida y de regreso." };
  const numNoches = noches(input.fechaIda, input.fechaRegreso);
  if (numNoches <= 0) return { ok: false, error: "El regreso debe ser posterior a la ida." };
  const admin = createAdminClient();
  const { data: pq } = await admin
    .from("armado_paquetes")
    .select("fecha_viaje_inicio, fecha_viaje_fin")
    .eq("id", input.paqueteId)
    .maybeSingle();
  if (pq?.fecha_viaje_inicio && input.fechaIda < pq.fecha_viaje_inicio)
    return { ok: false, error: `La ida no puede ser antes del ${pq.fecha_viaje_inicio} (rango del paquete).` };
  if (pq?.fecha_viaje_fin && input.fechaRegreso > pq.fecha_viaje_fin)
    return { ok: false, error: `El regreso no puede ser después del ${pq.fecha_viaje_fin} (rango del paquete).` };
  const res = await liquidarHotelPaquete(admin, input.paqueteId, input.hotelId, input.fechaIda, numNoches);
  if (res && numNoches < (res.minNoches ?? 1)) {
    return { ok: false, error: `Este alojamiento exige un mínimo de ${res.minNoches} noche(s) para esas fechas.` };
  }
  if (!res || !res.combos.length) {
    // Diagnóstico: ¿qué temporada de las noches elegidas no tiene tarifa cargada?
    const [{ data: temps }, { data: tars }] = await Promise.all([
      admin.from("hotel_temporadas").select("nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts, min_noches, regimen_restringido").eq("hotel_id", input.hotelId),
      admin.from("tarifa_hotel").select("temporada").eq("hotel_id", input.hotelId),
    ]);
    const temporadas = (temps ?? []).map(toTemporadaRango);
    const conTarifa = new Set((tars ?? []).map((t) => (t.temporada ?? "").trim()));
    const base = new Date(`${input.fechaIda}T00:00:00`).getTime();
    const faltan = new Set<string>();
    let hayNocheSinTemp = false;
    for (let n = 0; n < numNoches; n++) {
      const temp = temporadaParaFecha(new Date(base + n * 86_400_000), temporadas);
      if (!temp) hayNocheSinTemp = true;
      else if (!conTarifa.has(temp.trim())) faltan.add(temp);
    }
    let error = "No hay tarifa para esas fechas (revisa temporadas del hotel).";
    if (faltan.size) error = `Falta cargar la tarifa de la temporada: ${[...faltan].join(", ")} (cae dentro de tu rango de fechas).`;
    else if (hayNocheSinTemp) error = "Hay noches que no caen en ninguna temporada del hotel; define la temporada para esas fechas.";
    return { ok: false, error };
  }
  // Se devuelve al cliente SIN `netos` (el costo interno no sale del servidor).
  const combosPublicos = res.combos.map((c) => ({ categoria: c.categoria, regimen: c.regimen, precios: c.precios }));
  return { ok: true, combos: combosPublicos, noches: numNoches, moneda: res.moneda };
}

// ── Mini-motor de búsqueda (público): liquida TODOS los hoteles de porción para
// las fechas y la composición de habitaciones, y devuelve los que CABEN ya con
// precio (el combo categoría/régimen más barato por hotel). Los menores se
// declaran por EDAD EXACTA (nunca fecha de nacimiento) y se clasifican
// infante/niño PER HOTEL, porque cada hotel puede tener un umbral de edad
// distinto (`edad_infante_max`/`edad_nino_max`, ver
// lib/reservar/edadesMenores.ts). Quién paga Niño 1/Niño 2 se decide
// DESPUÉS, repartiendo por HABITACIÓN (`distribuirPorHabitaciones`, ver
// lib/reservar/distribucionHabitaciones.ts) — NO es un límite de 2 niños en
// toda la búsqueda: un hotel cuyas habitaciones consultadas no alcanzan a
// acomodar la composición (por edad, por capacidad de niño/infante o por la
// cantidad de adultos declarada) simplemente no aparece en el resultado — es
// una búsqueda entre varios hoteles, no un solo cálculo que deba fallar
// entero por uno de ellos. `adultos` es la cantidad REAL declarada por el
// usuario (campo "Adultos" de Vista Booking) — debe coincidir con lo que las
// habitaciones elegidas implican (`pax_tarifa` por habitación), si no la
// búsqueda entera falla con un mensaje claro (no es un rechazo por hotel). ──
export type BusquedaInput = {
  fechaIda: string;
  fechaRegreso: string;
  habitaciones: { acom: AcomRoom }[]; // una entrada por habitación, en orden de captura
  adultos: number; // cantidad real de adultos declarada — debe cuadrar con las habitaciones
  cantidadMenores: number;
  edadesMenores: number[]; // edad exacta de cada menor
  destino?: string; // filtra por destino (vacío = todos)
};
export type BusquedaResultado = {
  hotelId: number; hotelNombre: string | null; destino: string | null;
  paqueteId: number; categoria: string; regimen: string;
  total: number; noches: number; fechaIda: string; fechaRegreso: string;
  habitaciones: Record<string, number>;
  menores: ClasificacionMenores; // totales de la distribución por habitación, para ESTE hotel
  edadesMenores: number[]; // las mismas edades de la búsqueda — para persistir en el carrito
  pax: number;
  // Todos los combos válidos (categoría × régimen) para esta composición, con su
  // precio. El top-level categoria/regimen/total es el más barato (predeterminado).
  combos: { categoria: string; regimen: string; total: number; pax: number; menores: ClasificacionMenores }[];
};

// `inputRaw` se trata como `unknown` — esta función es alcanzable desde el
// navegador (Server Action) con cualquier body HTTP, sin importar lo que
// declare el tipo `BusquedaInput`. Se valida la FORMA completa (objeto,
// fechas, destino, adultos, habitaciones, cantidad de menores, edades) antes
// de tocar la base de datos o el motor de liquidación.
export async function buscarHoteles(inputRaw: unknown): Promise<{ ok: true; resultados: BusquedaResultado[]; diagnostico?: string } | { ok: false; error: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "Búsqueda no disponible (falta service-role)." };
  if (typeof inputRaw !== "object" || inputRaw === null || Array.isArray(inputRaw)) {
    return { ok: false, error: "La consulta no tiene una forma válida." };
  }
  const o = inputRaw as Record<string, unknown>;
  const vIda = validarFechaConsulta(o.fechaIda);
  if (!vIda.ok) return { ok: false, error: vIda.error };
  const vReg = validarFechaConsulta(o.fechaRegreso);
  if (!vReg.ok) return { ok: false, error: vReg.error };
  const vDestino = validarDestinoConsulta(o.destino);
  if (!vDestino.ok) return { ok: false, error: vDestino.error };
  const vHabs = validarHabitacionesConsultadas(o.habitaciones);
  if (!vHabs.ok) return { ok: false, error: vHabs.error };
  const vAdultos = validarAdultosDeclarados(o.adultos);
  if (!vAdultos.ok) return { ok: false, error: vAdultos.error };
  const vCant = validarCantidadMenores(o.cantidadMenores);
  if (!vCant.ok) return { ok: false, error: vCant.error };
  const vEdades = validarEdadesMenores(o.edadesMenores, vCant.cantidad);
  if (!vEdades.ok) return { ok: false, error: vEdades.error };

  const input: BusquedaInput = {
    fechaIda: vIda.fecha, fechaRegreso: vReg.fecha, habitaciones: vHabs.habitaciones,
    adultos: vAdultos.adultos, cantidadMenores: vCant.cantidad, edadesMenores: vEdades.edades,
    destino: vDestino.destino || undefined,
  };
  const edades = input.edadesMenores;

  const numNoches = noches(input.fechaIda, input.fechaRegreso);
  if (numNoches <= 0) return { ok: false, error: "El regreso debe ser posterior a la ida." };
  const vPaxTotal = validarPaxTotalConsulta(input.adultos, edades.length);
  if (!vPaxTotal.ok) return { ok: false, error: vPaxTotal.error };

  const admin = createAdminClient();
  let q = admin
    .from("tarifario_resultado")
    .select("paquete_id, hotel_id, destino_nombre")
    .eq("modulo", "porcion_terrestre")
    .eq("paquete_activo", true);
  if (input.destino?.trim()) q = q.eq("destino_nombre", input.destino.trim());
  const { data: filas } = await q;
  const pares = new Map<string, { paquete: number; hotel: number }>();
  for (const f of filas ?? []) if (f.paquete_id != null && f.hotel_id != null) pares.set(`${f.paquete_id}-${f.hotel_id}`, { paquete: f.paquete_id, hotel: f.hotel_id });

  // Composición agregada por acomodación (nº de habitaciones por tipo, para
  // el precio de cada combo). La LISTA en orden de captura (`input.habitaciones`)
  // se conserva aparte para la distribución por habitación, que sí depende
  // del orden en que se armaron las habitaciones.
  const porAcom = new Map<AcomRoom, number>();
  for (const r of input.habitaciones) porAcom.set(r.acom, (porAcom.get(r.acom) ?? 0) + 1);
  const habitacionesOut: Record<string, number> = {};
  for (const [a, count] of porAcom) habitacionesOut[a] = count;

  const resultados: BusquedaResultado[] = [];
  // Motivo de rechazo por hotel evaluado — nunca se expone cuál hotel dio
  // cuál motivo; solo sirve para armar un diagnóstico agregado si la
  // búsqueda entera queda en 0 resultados por la misma composición.
  const rechazos = new Map<string, number>();
  let evaluados = 0;
  const registrarRechazo = (motivo: string) => rechazos.set(motivo, (rechazos.get(motivo) ?? 0) + 1);

  for (const { paquete, hotel } of pares.values()) {
    const res = await liquidarHotelPaquete(admin, paquete, hotel, input.fechaIda, numNoches);
    if (!res || !res.combos.length) continue;
    if (numNoches < (res.minNoches ?? 1)) continue; // exige más noches de las buscadas

    const [{ data: acomCfg }, { data: hotelRow }] = await Promise.all([
      admin.from("hotel_acomodaciones").select("acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max").eq("hotel_id", hotel),
      admin.from("hoteles").select("edad_infante_max, edad_nino_max, adults_only").eq("id", hotel).maybeSingle(),
    ]);
    evaluados++;
    if (edades.length > 0 && hotelRow?.adults_only) { registrarRechazo("Este hotel es Adults Only y no acepta menores."); continue; }

    const reglas = (acomCfg ?? []) as AcomConfig[];
    const configDe = (a: AcomRoom): AcomConfig => reglas.find((x) => x.acomodacion === a) ?? defaultAcomConfig(a);

    // Clasificación REAL por edad, contra el umbral de ESTE hotel — nunca una
    // edad de referencia genérica. Alguien mayor al umbral de niño no tiene
    // cabida en este campo (falla cerrado, nunca se cuenta como adulto solo).
    let ninosClasif = 0, infantesClasif = 0;
    if (edades.length > 0) {
      const rClasif = clasificarMenoresPorEdad(edades, hotelRow?.edad_infante_max ?? 2, hotelRow?.edad_nino_max ?? 10);
      if (!rClasif.ok) { registrarRechazo(rClasif.error); continue; }
      ninosClasif = rClasif.c.ninos;
      infantesClasif = rClasif.c.infantes;
    }

    // Distribución REAL por habitación: primer niño de cada habitación →
    // Niño 1, segundo → Niño 2 (nunca un límite global de 2 en toda la
    // búsqueda), respetando la capacidad real de cada habitación consultada
    // y la cantidad de adultos declarada.
    const habitacionesConsultadas: HabitacionConsultada[] = input.habitaciones.map((h) => ({ acom: h.acom, config: configDe(h.acom) }));
    const rDist = distribuirPorHabitaciones({
      adultosDeclarados: input.adultos,
      ninos: ninosClasif,
      infantes: infantesClasif,
      habitaciones: habitacionesConsultadas,
    });
    if (!rDist.ok) { registrarRechazo(rDist.error); continue; }
    const menores: ClasificacionMenores = { infantes: rDist.totales.infantes, nino: rDist.totales.nino, nino2: rDist.totales.nino2 };

    const combosValidos: { total: number; categoria: string; regimen: string; pax: number; menores: ClasificacionMenores }[] = [];
    for (const combo of res.combos) {
      const errTarifa = verificarTarifasMenoresDisponibles(menores, { nino: combo.precios["nino"] != null, nino2: combo.precios["nino2"] != null });
      if (errTarifa) continue; // este combo (categoría/régimen) no tiene la tarifa de niño que hace falta

      let total = 0; let pax = 0; let ok = true;
      for (const [acom, count] of porAcom) {
        const pvp = combo.precios[acom];
        if (pvp == null) { ok = false; break; }
        const adultos = count * configDe(acom).pax_tarifa;
        total += adultos * pvp; pax += adultos;
      }
      if (!ok) continue;
      if (menores.nino > 0) { total += menores.nino * combo.precios["nino"]!; pax += menores.nino; }
      if (menores.nino2 > 0) { total += menores.nino2 * combo.precios["nino2"]!; pax += menores.nino2; }
      // Infante: si el hotel no configuró tarifa para este combo, es gratis
      // (misma asimetría documentada del resto del motor de reservas).
      if (menores.infantes > 0 && combo.precios["infante"] != null) total += menores.infantes * combo.precios["infante"];
      combosValidos.push({ total, categoria: combo.categoria, regimen: combo.regimen, pax, menores });
    }
    if (combosValidos.length) {
      combosValidos.sort((a, b) => a.total - b.total); // más barato primero (predeterminado)
      const mejor = combosValidos[0];
      resultados.push({
        hotelId: hotel, hotelNombre: res.hotelNombre, destino: res.destinoNombre,
        paqueteId: paquete, categoria: mejor.categoria, regimen: mejor.regimen,
        total: mejor.total, noches: numNoches, fechaIda: input.fechaIda, fechaRegreso: input.fechaRegreso,
        habitaciones: habitacionesOut, menores: mejor.menores, edadesMenores: edades, pax: mejor.pax,
        combos: combosValidos,
      });
    } else {
      registrarRechazo("Ninguna categoría/régimen de este hotel tiene tarifa configurada para esa composición.");
    }
  }
  resultados.sort((a, b) => a.total - b.total);

  // Nunca "sin resultados" a secas si sí había hoteles candidatos y todos
  // quedaron descartados por la misma composición: se entrega el motivo más
  // frecuente entre los evaluados, sin exponer cuál hotel lo dio.
  let diagnostico: string | undefined;
  if (!resultados.length && evaluados > 0 && rechazos.size) {
    diagnostico = [...rechazos.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return { ok: true, resultados, diagnostico };
}

// ── Mini-motor de búsqueda de RECEPTIVOS (servicios): liquida EN VIVO cada
// tour/servicio publicado para el destino, fechas y pax elegidos — misma idea
// que buscarHoteles, pero resolviendo temporada (si el servicio tiene tarifa
// por fecha) y el rango de grupo/persona según el pax buscado. ──────────────
export type BusquedaServiciosInput = {
  fechaIda: string;
  fechaRegreso: string;
  pax: number;
  destino?: string; // vacío = todos
};
export type { ResultadoServicio, ResultadoServicioPuntual };

// `inputRaw` se trata como `unknown` — igual que `buscarHoteles` — esta
// función es alcanzable desde el navegador (Server Action, ver
// app/(dashboard)/dashboard/reservar/actions.ts) con cualquier body HTTP.
// Se valida la FORMA completa (objeto, fechas reales de calendario + rango,
// pax entero acotado, destino con longitud máxima) ANTES de tocar la base de
// datos con service-role — ningún payload manipulado (null, arreglos,
// fechas imposibles, pax decimal/NaN/Infinity/negativo/gigante, destino
// gigante) debe poder lanzar un TypeError ni llegar a consultar Supabase.
export async function buscarReceptivos(inputRaw: unknown): Promise<{ ok: true; resultados: ResultadoServicio[] } | { ok: false; error: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "Búsqueda no disponible (falta service-role)." };
  if (typeof inputRaw !== "object" || inputRaw === null || Array.isArray(inputRaw)) {
    return { ok: false, error: "La consulta no tiene una forma válida." };
  }
  const o = inputRaw as Record<string, unknown>;
  const vIda = validarFechaConsulta(o.fechaIda);
  if (!vIda.ok) return { ok: false, error: vIda.error };
  const vReg = validarFechaConsulta(o.fechaRegreso);
  if (!vReg.ok) return { ok: false, error: vReg.error };
  const vDestino = validarDestinoConsulta(o.destino);
  if (!vDestino.ok) return { ok: false, error: vDestino.error };
  const vPax = validarPaxServicioConsulta(o.pax);
  if (!vPax.ok) return { ok: false, error: vPax.error };

  const input: BusquedaServiciosInput = {
    fechaIda: vIda.fecha, fechaRegreso: vReg.fecha, pax: vPax.pax, destino: vDestino.destino || undefined,
  };

  const numNoches = noches(input.fechaIda, input.fechaRegreso);
  if (numNoches <= 0) return { ok: false, error: "El regreso debe ser posterior a la ida." };
  const pax = input.pax;

  const admin = createAdminClient();
  let q = admin
    .from("tarifario_resultado")
    .select("paquete_id, servicio_id, servicio_nombre, destino_nombre, descripcion")
    .eq("modulo", "servicios")
    .eq("paquete_activo", true)
    .not("servicio_id", "is", null);
  if (input.destino?.trim()) q = q.eq("destino_nombre", input.destino.trim());
  const { data: filas } = await q;
  const pares = new Map<string, DatosServicioPar>();
  for (const f of filas ?? []) {
    if (f.paquete_id == null || f.servicio_id == null) continue;
    pares.set(`${f.paquete_id}-${f.servicio_id}`, {
      paqueteId: f.paquete_id, servicioId: f.servicio_id,
      nombre: f.servicio_nombre ?? "Servicio", destino: f.destino_nombre, descripcion: f.descripcion,
    });
  }
  if (!pares.size) return { ok: true, resultados: [] };

  const paqueteIds = [...new Set([...pares.values()].map((p) => p.paqueteId))];
  const servicioIds = [...new Set([...pares.values()].map((p) => p.servicioId))];

  const [{ data: paquetes }, { data: armado }, { data: servicios }, { data: grupos }, { data: temporadas }] = await Promise.all([
    admin.from("armado_paquetes").select("id, pct_mk").in("id", paqueteIds),
    admin.from("armado_servicios").select("paquete_id, servicio_id, modo").in("paquete_id", paqueteIds).in("servicio_id", servicioIds),
    admin.from("servicios_adicionales").select("id, precio_persona, recargo_individual, liquidacion, moneda").in("id", servicioIds),
    admin.from("servicio_tarifa_pax").select("servicio_id, pax_desde, pax_hasta, precio, temporada").in("servicio_id", servicioIds),
    admin.from("servicio_temporadas").select("servicio_id, nombre, fecha_inicio, fecha_fin, compra_inicio, compra_fin, prioridad, precio_persona, recargo_individual").in("servicio_id", servicioIds),
  ]);

  const ctx = construirContextoServicios({
    paquetes: paquetes ?? [], armado: armado ?? [], servicios: servicios ?? [], grupos: grupos ?? [], temporadas: temporadas ?? [],
  });

  const fechaIdaDate = new Date(`${input.fechaIda}T00:00:00`);
  const resultados: ResultadoServicio[] = [];
  for (const par of pares.values()) {
    const r = calcularResultadoServicio(par, ctx, fechaIdaDate, numNoches, pax);
    if (r) resultados.push(r);
  }
  resultados.sort((a, b) => a.total - b.total);
  return { ok: true, resultados };
}

// Re-liquida EN VIVO un único servicio/tour puntual — usado por el checkout
// público para volver a calcular el precio real de un tour del carrito,
// nunca confiando en nombre/precio/moneda/pax que mande el navegador (ver
// FRONTERA en app/tarifario/checkout/actions.ts). Confirma primero que el par
// (paqueteId, servicioId) esté REALMENTE publicado y activo en
// `tarifario_resultado` — el nombre/destino/descripción canónicos salen de
// ahí, nunca del cliente.
//
// FALLA CERRADO (ronda 4): esta función solo consulta — TODA la decisión de
// qué hacer con lo consultado (incl. no usar defaults de modo/markup, exigir
// que el armado pertenezca exactamente al par, y distinguir un error técnico
// de una configuración incompleta de un servicio genuinamente no disponible)
// vive en `resolverLiquidacionServicioPuntual` (lib/reservar/liquidacionServicio.ts,
// módulo puro, testeable con node --test sin tocar Supabase). El llamador
// (`crearCotizacionCarrito` en checkout/actions.ts) debe abortar la
// cotización COMPLETA ante `tipo: "error_consulta"` o `"configuracion_invalida"`
// — solo `"no_disponible"` es un motivo legítimo para excluir el tour del
// carrito y seguir con el resto.
export async function liquidarServicioPuntual(input: {
  paqueteId: number; servicioId: number; fechaIda: string; fechaRegreso: string; pax: number;
}): Promise<ResultadoServicioPuntual> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, tipo: "error_consulta", error: "Cotización de servicios no disponible (falta service-role)." };
  }
  const numNoches = Math.max(1, noches(input.fechaIda, input.fechaRegreso));
  const pax = Math.max(1, Math.trunc(input.pax) || 1);

  const admin = createAdminClient();
  const { data: fila, error: filaErr } = await admin
    .from("tarifario_resultado")
    .select("servicio_nombre, destino_nombre, descripcion")
    .eq("modulo", "servicios")
    .eq("paquete_activo", true)
    .eq("paquete_id", input.paqueteId)
    .eq("servicio_id", input.servicioId)
    .limit(1)
    .maybeSingle();

  const par: DatosServicioPar = {
    servicioId: input.servicioId, paqueteId: input.paqueteId,
    nombre: fila?.servicio_nombre ?? "Servicio", destino: fila?.destino_nombre ?? null, descripcion: fila?.descripcion ?? null,
  };

  // Se consultan las 5 tablas restantes en paralelo sin importar si la fila
  // del tarifario se confirmó — `resolverLiquidacionServicioPuntual` revisa
  // `filaTarifarioError`/`filaTarifarioEncontrada` ANTES que cualquier otro
  // dato, así que un tarifario ausente/erróneo aborta igual sin depender de
  // que estas consultas hayan encontrado algo.
  const [
    { data: paquete, error: paqueteErr },
    { data: armado, error: armadoErr },
    { data: servicio, error: servicioErr },
    { data: grupos, error: gruposErr },
    { data: temporadas, error: temporadasErr },
  ] = await Promise.all([
    admin.from("armado_paquetes").select("id, pct_mk").eq("id", input.paqueteId).maybeSingle(),
    admin.from("armado_servicios").select("paquete_id, servicio_id, modo").eq("paquete_id", input.paqueteId).eq("servicio_id", input.servicioId).maybeSingle(),
    admin.from("servicios_adicionales").select("id, precio_persona, recargo_individual, liquidacion, moneda").eq("id", input.servicioId).maybeSingle(),
    admin.from("servicio_tarifa_pax").select("servicio_id, pax_desde, pax_hasta, precio, temporada").eq("servicio_id", input.servicioId),
    admin.from("servicio_temporadas").select("servicio_id, nombre, fecha_inicio, fecha_fin, compra_inicio, compra_fin, prioridad, precio_persona, recargo_individual").eq("servicio_id", input.servicioId),
  ]);

  const fechaIdaDate = new Date(`${input.fechaIda}T00:00:00`);
  return resolverLiquidacionServicioPuntual({
    par, fechaIdaDate, numNoches, pax,
    filaTarifarioEncontrada: !!fila,
    filaTarifarioError: filaErr?.message ?? null,
    paquete: paquete ?? null, paqueteError: paqueteErr?.message ?? null,
    armado: armado ?? null, armadoError: armadoErr?.message ?? null,
    servicio: servicio ?? null, servicioError: servicioErr?.message ?? null,
    grupos: grupos ?? [], gruposError: gruposErr?.message ?? null,
    temporadas: temporadas ?? [], temporadasError: temporadasErr?.message ?? null,
  });
}
