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
  temporadaVigenteParaFecha,
  toTemporadaRango,
  minNochesAplicable,
  factorLiquidacion,
  precioServicio,
  redondearVenta,
  type TemporadaRango,
} from "@/lib/calc/paquetes";
import { PAX_TARIFA_DEFAULT, type AcomRoom } from "@/lib/acomodaciones";
import {
  MAX_PAX_CONSULTA,
  validarCantidadMenores,
  validarEdadesMenores,
  clasificarYRepartirMenores,
  type ClasificacionMenores,
} from "@/lib/reservar/edadesMenores";

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
// declaran por EDAD EXACTA (nunca fecha de nacimiento), global — no por
// habitación — y se clasifican infante/Niño 1/Niño 2 PER HOTEL, porque cada
// hotel puede tener un umbral de edad distinto (`edad_infante_max`/
// `edad_nino_max`, ver lib/reservar/edadesMenores.ts): un hotel cuyo umbral no
// deja acomodar la composición (por edad o por no tener las 2 tarifas de
// niño) simplemente no aparece en el resultado — es una búsqueda entre varios
// hoteles, no un solo cálculo que deba fallar entero por uno de ellos. ───────
export type BusquedaInput = {
  fechaIda: string;
  fechaRegreso: string;
  habitaciones: { acom: AcomRoom }[]; // una entrada por habitación (sin niños por habitación)
  cantidadMenores: number;
  edadesMenores: number[]; // edad exacta de cada menor — global, no por habitación
  destino?: string; // filtra por destino (vacío = todos)
};
export type BusquedaResultado = {
  hotelId: number; hotelNombre: string | null; destino: string | null;
  paqueteId: number; categoria: string; regimen: string;
  total: number; noches: number; fechaIda: string; fechaRegreso: string;
  habitaciones: Record<string, number>;
  menores: ClasificacionMenores; // clasificación real (infante/Niño 1/Niño 2) para ESTE hotel
  edadesMenores: number[]; // las mismas edades de la búsqueda — para persistir en el carrito
  pax: number;
  // Todos los combos válidos (categoría × régimen) para esta composición, con su
  // precio. El top-level categoria/regimen/total es el más barato (predeterminado).
  combos: { categoria: string; regimen: string; total: number; pax: number; menores: ClasificacionMenores }[];
};

export async function buscarHoteles(input: BusquedaInput): Promise<{ ok: true; resultados: BusquedaResultado[] } | { ok: false; error: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "Búsqueda no disponible (falta service-role)." };
  if (!input.fechaIda || !input.fechaRegreso) return { ok: false, error: "Indica fecha de ida y regreso." };
  const numNoches = noches(input.fechaIda, input.fechaRegreso);
  if (numNoches <= 0) return { ok: false, error: "El regreso debe ser posterior a la ida." };
  if (!input.habitaciones.length) return { ok: false, error: "Indica al menos una habitación." };

  const vCant = validarCantidadMenores(input.cantidadMenores);
  if (!vCant.ok) return { ok: false, error: vCant.error };
  const vEdades = validarEdadesMenores(input.edadesMenores, vCant.cantidad);
  if (!vEdades.ok) return { ok: false, error: vEdades.error };
  const edades = vEdades.edades;
  if (input.habitaciones.length + edades.length > MAX_PAX_CONSULTA) {
    return { ok: false, error: `No se pueden cotizar más de ${MAX_PAX_CONSULTA} pax en una sola búsqueda.` };
  }

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

  // Composición agregada por acomodación: nº de habitaciones por tipo.
  const porAcom = new Map<AcomRoom, number>();
  for (const r of input.habitaciones) porAcom.set(r.acom, (porAcom.get(r.acom) ?? 0) + 1);
  const habitaciones: Record<string, number> = {};
  for (const [a, count] of porAcom) habitaciones[a] = count;

  const resultados: BusquedaResultado[] = [];
  for (const { paquete, hotel } of pares.values()) {
    const res = await liquidarHotelPaquete(admin, paquete, hotel, input.fechaIda, numNoches);
    if (!res || !res.combos.length) continue;
    if (numNoches < (res.minNoches ?? 1)) continue; // exige más noches de las buscadas

    const [{ data: acomCfg }, { data: hotelRow }] = await Promise.all([
      admin.from("hotel_acomodaciones").select("acomodacion, pax_tarifa, chd_max, inf_max").eq("hotel_id", hotel),
      admin.from("hoteles").select("edad_infante_max, edad_nino_max, adults_only").eq("id", hotel).maybeSingle(),
    ]);
    if (edades.length > 0 && hotelRow?.adults_only) continue; // Adults Only: no acepta menores, sin excepción

    const reglas = (acomCfg ?? []) as { acomodacion: string; pax_tarifa: number; chd_max: number; inf_max: number }[];
    const paxTarifa = (a: AcomRoom) => reglas.find((x) => x.acomodacion === a)?.pax_tarifa ?? PAX_TARIFA_DEFAULT[a];
    let capChd = 0, capInf = 0;
    for (const [a, count] of porAcom) {
      const r = reglas.find((x) => x.acomodacion === a);
      capChd += count * (r?.chd_max ?? PAX_TARIFA_DEFAULT[a]);
      capInf += count * (r?.inf_max ?? PAX_TARIFA_DEFAULT[a]);
    }

    // Clasificación REAL por edad, contra el umbral de ESTE hotel — nunca una
    // edad de referencia genérica. Si no cuadra (alguien mayor al umbral de
    // niño, o más de 2 menores en edad de niño, o excede la capacidad de las
    // habitaciones elegidas), este hotel queda fuera del resultado.
    let menores: ClasificacionMenores = { infantes: 0, nino: 0, nino2: 0 };
    if (edades.length > 0) {
      const rClasif = clasificarYRepartirMenores(edades, hotelRow?.edad_infante_max ?? 2, hotelRow?.edad_nino_max ?? 10);
      if (!rClasif.ok) continue;
      if (rClasif.c.infantes > capInf || rClasif.c.nino + rClasif.c.nino2 > capChd) continue;
      menores = rClasif.c;
    }

    const combosValidos: { total: number; categoria: string; regimen: string; pax: number; menores: ClasificacionMenores }[] = [];
    for (const combo of res.combos) {
      let total = 0; let pax = 0; let ok = true;
      for (const [acom, count] of porAcom) {
        const pvp = combo.precios[acom];
        if (pvp == null) { ok = false; break; }
        const adultos = count * paxTarifa(acom);
        total += adultos * pvp; pax += adultos;
      }
      if (!ok) continue;
      if (menores.nino > 0) {
        const pvpN = combo.precios["nino"];
        if (pvpN == null) continue; // sin tarifa de Niño 1: este combo no sirve, nunca gratis
        total += menores.nino * pvpN; pax += menores.nino;
      }
      if (menores.nino2 > 0) {
        const pvpN2 = combo.precios["nino2"];
        if (pvpN2 == null) continue; // sin tarifa de Niño 2: este combo no sirve
        total += menores.nino2 * pvpN2; pax += menores.nino2;
      }
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
        habitaciones, menores: mejor.menores, edadesMenores: edades, pax: mejor.pax,
        combos: combosValidos,
      });
    }
  }
  resultados.sort((a, b) => a.total - b.total);
  return { ok: true, resultados };
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
export type ResultadoServicio = {
  servicioId: number; nombre: string; destino: string | null; descripcion: string | null;
  paqueteId: number; total: number; pax: number; noches: number; moneda: string;
};

export async function buscarReceptivos(input: BusquedaServiciosInput): Promise<{ ok: true; resultados: ResultadoServicio[] } | { ok: false; error: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "Búsqueda no disponible (falta service-role)." };
  if (!input.fechaIda || !input.fechaRegreso) return { ok: false, error: "Indica fecha de ida y regreso." };
  const numNoches = Math.max(1, noches(input.fechaIda, input.fechaRegreso));
  const pax = Math.max(1, Math.trunc(input.pax) || 1);

  const admin = createAdminClient();
  let q = admin
    .from("tarifario_resultado")
    .select("paquete_id, servicio_id, servicio_nombre, destino_nombre, descripcion")
    .eq("modulo", "servicios")
    .eq("paquete_activo", true)
    .not("servicio_id", "is", null);
  if (input.destino?.trim()) q = q.eq("destino_nombre", input.destino.trim());
  const { data: filas } = await q;
  const pares = new Map<string, { paqueteId: number; servicioId: number; nombre: string; destino: string | null; descripcion: string | null }>();
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

  const pctMkPorPaquete = new Map((paquetes ?? []).map((p) => [p.id, Number(p.pct_mk) || 0]));
  const modoPorPar = new Map((armado ?? []).map((a) => [`${a.paquete_id}-${a.servicio_id}`, a.modo === "grupo" ? "grupo" as const : "persona" as const]));
  const svcPorId = new Map((servicios ?? []).map((s) => [s.id, s]));

  const gruposPorServ = new Map<string, { pax_desde: number; pax_hasta: number; precio: number }[]>();
  for (const g of grupos ?? []) {
    const k = `${g.servicio_id}|${g.temporada ?? "GENERAL"}`;
    (gruposPorServ.get(k) ?? gruposPorServ.set(k, []).get(k)!).push({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: g.precio });
  }
  const tempsPorServ = new Map<number, TemporadaRango[]>();
  const netoTempServ = new Map<string, number>();
  const recTempServ = new Map<string, number>();
  for (const t of temporadas ?? []) {
    (tempsPorServ.get(t.servicio_id) ?? tempsPorServ.set(t.servicio_id, []).get(t.servicio_id)!).push(toTemporadaRango(t));
    if (t.precio_persona != null) netoTempServ.set(`${t.servicio_id}|${t.nombre}`, Number(t.precio_persona));
    if (t.recargo_individual != null) recTempServ.set(`${t.servicio_id}|${t.nombre}`, Number(t.recargo_individual));
  }

  const fechaIdaDate = new Date(`${input.fechaIda}T00:00:00`);
  const resultados: ResultadoServicio[] = [];
  for (const par of pares.values()) {
    const srv = svcPorId.get(par.servicioId);
    if (!srv) continue;
    const modo = modoPorPar.get(`${par.paqueteId}-${par.servicioId}`) ?? "persona";
    const tt = tempsPorServ.get(par.servicioId);
    const nombreTemp = tt?.length ? temporadaVigenteParaFecha(fechaIdaDate, tt) : null;
    const netoPersona = (nombreTemp ? netoTempServ.get(`${par.servicioId}|${nombreTemp}`) : undefined) ?? srv.precio_persona ?? null;
    const gruposTemp = nombreTemp ? gruposPorServ.get(`${par.servicioId}|${nombreTemp}`) : undefined;
    const gruposServ = gruposTemp?.length ? gruposTemp : (gruposPorServ.get(`${par.servicioId}|GENERAL`) ?? []);
    if (modo === "persona" && netoPersona == null) continue; // sin tarifa para esa fecha
    if (modo === "grupo" && !gruposServ.length) continue;

    let costoNeto = precioServicio(modo, netoPersona, gruposServ, pax) * factorLiquidacion(srv.liquidacion, numNoches);
    if (modo === "persona" && pax === 1) {
      const recTemp = nombreTemp ? recTempServ.get(`${par.servicioId}|${nombreTemp}`) : undefined;
      costoNeto += Math.max(recTemp ?? (Number(srv.recargo_individual) || 0), 0);
    }
    const pctMk = pctMkPorPaquete.get(par.paqueteId) ?? 0;
    const moneda = srv.moneda ?? "COP";
    const total = redondearVenta(marcar(costoNeto, pctMk), moneda);
    if (total <= 0) continue;

    resultados.push({
      servicioId: par.servicioId, nombre: par.nombre, destino: par.destino, descripcion: par.descripcion,
      paqueteId: par.paqueteId, total, pax, noches: numNoches, moneda,
    });
  }
  resultados.sort((a, b) => a.total - b.total);
  return { ok: true, resultados };
}
