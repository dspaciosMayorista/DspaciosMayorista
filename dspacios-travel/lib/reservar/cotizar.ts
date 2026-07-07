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
import { PAX_TARIFA_DEFAULT, type AcomRoom } from "@/lib/acomodaciones";

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
    admin.from("hotel_temporadas").select("nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts, min_noches").eq("hotel_id", hotelId),
    admin.from("tarifa_hotel").select("*").eq("hotel_id", hotelId),
    admin.from("armado_servicios").select("incluido, servicios_adicionales(precio_persona, liquidacion)").eq("paquete_id", paqueteId),
    admin.from("hotel_blackouts").select("fecha_inicio, fecha_fin, total, acomodaciones").eq("hotel_id", hotelId),
  ]);

  // Black out general del hotel: cierra noches (total o por acomodación) por encima
  // de cualquier vigencia. Si alguna noche de la estadía cae en un blackout total,
  // el hotel no se vende; si es por acomodación, esas acomodaciones quedan fuera.
  const nochesStay: string[] = [];
  { const base = new Date(`${fechaIda}T00:00:00`).getTime(); for (let n = 0; n < numNoches; n++) nochesStay.push(new Date(base + n * 86_400_000).toISOString().slice(0, 10)); }
  const acomCerradas = new Set<string>();
  let cierreTotal = false;
  for (const b of blackouts ?? []) {
    const cubre = nochesStay.some((d) => (b.fecha_inicio as string) <= d && d <= (b.fecha_fin as string));
    if (!cubre) continue;
    if (b.total) cierreTotal = true;
    else for (const a of ((b.acomodaciones as string[] | null) ?? [])) acomCerradas.add(a);
  }
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
      const costoHotel = liquidarHotelNoches({ fechaIda, numNoches, temporadas, netoPorTemporada });
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
  // Quita las acomodaciones cerradas por blackout; descarta combos sin habitación.
  if (acomCerradas.size) {
    for (const c of combos) for (const a of acomCerradas) { delete c.precios[a]; delete c.netos?.[a]; }
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
      admin.from("hotel_temporadas").select("nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts, min_noches").eq("hotel_id", input.hotelId),
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
// precio (el combo categoría/régimen más barato por hotel). ───────────────────
export type BusquedaInput = {
  fechaIda: string;
  fechaRegreso: string;
  habitaciones: { acom: AcomRoom; ninos: number }[]; // una entrada por habitación
  infantes: number;
  destino?: string; // filtra por destino (vacío = todos)
};
export type BusquedaResultado = {
  hotelId: number; hotelNombre: string | null; destino: string | null;
  paqueteId: number; categoria: string; regimen: string;
  total: number; noches: number; fechaIda: string; fechaRegreso: string;
  habitaciones: Record<string, number>; ninos: number; pax: number;
  // Todos los combos válidos (categoría × régimen) para esta composición, con su
  // precio. El top-level categoria/regimen/total es el más barato (predeterminado).
  combos: { categoria: string; regimen: string; total: number; pax: number }[];
};

export async function buscarHoteles(input: BusquedaInput): Promise<{ ok: true; resultados: BusquedaResultado[] } | { ok: false; error: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "Búsqueda no disponible (falta service-role)." };
  if (!input.fechaIda || !input.fechaRegreso) return { ok: false, error: "Indica fecha de ida y regreso." };
  const numNoches = noches(input.fechaIda, input.fechaRegreso);
  if (numNoches <= 0) return { ok: false, error: "El regreso debe ser posterior a la ida." };
  if (!input.habitaciones.length) return { ok: false, error: "Indica al menos una habitación." };

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

  // Composición agregada por acomodación: nº de habitaciones y niños asignados.
  const porAcom = new Map<AcomRoom, { count: number; ninos: number }>();
  for (const r of input.habitaciones) {
    const g = porAcom.get(r.acom) ?? { count: 0, ninos: 0 };
    g.count += 1; g.ninos += Math.max(0, Math.trunc(r.ninos) || 0);
    porAcom.set(r.acom, g);
  }
  const totalNinos = [...porAcom.values()].reduce((s, g) => s + g.ninos, 0);
  const habitaciones: Record<string, number> = {};
  for (const [a, g] of porAcom) habitaciones[a] = g.count;

  const resultados: BusquedaResultado[] = [];
  for (const { paquete, hotel } of pares.values()) {
    const res = await liquidarHotelPaquete(admin, paquete, hotel, input.fechaIda, numNoches);
    if (!res || !res.combos.length) continue;
    if (numNoches < (res.minNoches ?? 1)) continue; // exige más noches de las buscadas
    const { data: acomCfg } = await admin.from("hotel_acomodaciones").select("acomodacion, pax_tarifa, chd_max").eq("hotel_id", hotel);
    const reglas = (acomCfg ?? []) as { acomodacion: string; pax_tarifa: number; chd_max: number }[];
    const paxTarifa = (a: AcomRoom) => reglas.find((x) => x.acomodacion === a)?.pax_tarifa ?? PAX_TARIFA_DEFAULT[a];
    const chdMax = (a: AcomRoom) => reglas.find((x) => x.acomodacion === a)?.chd_max ?? PAX_TARIFA_DEFAULT[a];

    const combosValidos: { total: number; categoria: string; regimen: string; pax: number }[] = [];
    for (const combo of res.combos) {
      let total = 0; let pax = 0; let ok = true;
      for (const [acom, g] of porAcom) {
        const pvp = combo.precios[acom];
        if (pvp == null) { ok = false; break; }
        const adultos = g.count * paxTarifa(acom);
        total += adultos * pvp; pax += adultos;
        if (g.ninos > 0) {
          if (g.ninos > g.count * chdMax(acom)) { ok = false; break; }
          const pvpN = combo.precios["nino"];
          if (pvpN == null) { ok = false; break; }
          total += g.ninos * pvpN; pax += g.ninos;
        }
      }
      if (ok) combosValidos.push({ total, categoria: combo.categoria, regimen: combo.regimen, pax });
    }
    if (combosValidos.length) {
      combosValidos.sort((a, b) => a.total - b.total); // más barato primero (predeterminado)
      const mejor = combosValidos[0];
      resultados.push({
        hotelId: hotel, hotelNombre: res.hotelNombre, destino: res.destinoNombre,
        paqueteId: paquete, categoria: mejor.categoria, regimen: mejor.regimen,
        total: mejor.total, noches: numNoches, fechaIda: input.fechaIda, fechaRegreso: input.fechaRegreso,
        habitaciones, ninos: totalNinos, pax: mejor.pax,
        combos: combosValidos,
      });
    }
  }
  resultados.sort((a, b) => a.total - b.total);
  return { ok: true, resultados };
}
