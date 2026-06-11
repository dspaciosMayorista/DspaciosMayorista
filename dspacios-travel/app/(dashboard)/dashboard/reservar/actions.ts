"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { precioServicio, noches, liquidarHotelNoches, marcar, componerTarifa, temporadaParaFecha, toTemporadaRango, factorLiquidacion, type TemporadaRango } from "@/lib/calc/paquetes";
import { ACOM_ROOMS, ACOM_ROOM_LABEL, PAX_TARIFA_DEFAULT, clasificarPorEdad, validarReservaHabitaciones, type AcomRoom, type AcomConfig } from "@/lib/acomodaciones";
import { parseRuta, ciudadIata } from "@/lib/iata";
import { calcularEdad } from "@/lib/utils";
import type { Json } from "@/types/database";

const oNull = (s: string | null | undefined) => (s && s.trim() !== "" ? s.trim() : null);

// Acomodaciones (incluye niños) y su columna neta en tarifa_hotel.
const ACOM_ALL = ["sencilla", "doble", "triple", "multiple", "nino", "nino2"] as const;
const COL_NETO: Record<string, string> = {
  sencilla: "neto_sencilla", doble: "neto_doble", triple: "neto_triple",
  multiple: "neto_multiple", nino: "neto_nino", nino2: "neto_nino2",
};

export type ComboCotizado = { categoria: string; regimen: string; precios: Record<string, number> };

// ── Liquidación EN VIVO de un hotel para fechas elegidas (motor por fechas) ──
// Reutiliza el mismo motor del generador de tarifario, pero para las noches que
// el asesor elige en Reservar (porción/dinámico). Devuelve SOLO PVP por
// categoría/régimen/acomodación (los costos netos no se exponen). Requiere
// service-role porque `tarifa_hotel` es interno.
async function liquidarHotelPaquete(
  admin: ReturnType<typeof createAdminClient>,
  paqueteId: number,
  hotelId: number,
  fechaIda: string,
  numNoches: number
): Promise<{ combos: ComboCotizado[]; destinoNombre: string | null; hotelNombre: string | null } | null> {
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
    admin.from("armado_hoteles").select("categorias, regimenes, hoteles(nombre)").eq("paquete_id", paqueteId).eq("hotel_id", hotelId).maybeSingle(),
    admin.from("hotel_temporadas").select("nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts").eq("hotel_id", hotelId),
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
  if (cierreTotal) return { combos: [], destinoNombre, hotelNombre: (hsel?.hoteles as unknown as { nombre: string } | null)?.nombre ?? null };
  const filtroCat = (hsel?.categorias as string[] | null) ?? null;
  const filtroReg = (hsel?.regimenes as string[] | null) ?? null;
  const hotelNombre = (hsel?.hoteles as unknown as { nombre: string } | null)?.nombre ?? null;
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
    for (const acom of ACOM_ALL) {
      const col = COL_NETO[acom];
      const netoPorTemporada: Record<string, number | null> = {};
      for (const [temp, row] of tempMap) { const v = row[col]; netoPorTemporada[temp] = v == null ? null : Number(v); }
      const costoHotel = liquidarHotelNoches({ fechaIda, numNoches, temporadas, netoPorTemporada });
      // null = no aplica. En habitaciones, 0 también es "no aplica" (no gratis);
      // solo en niños el 0 es válido.
      const esRoom = acom !== "nino" && acom !== "nino2";
      if (costoHotel == null) continue;
      if (esRoom && costoHotel <= 0) continue;
      const t = componerTarifa({ aporteHotel: marcar(costoHotel, pctMk), aporteServicios: aporteServ, aporteVuelo: 0, impuesto });
      precios[acom] = t.pvp;
    }
    if (Object.keys(precios).length) combos.push({ categoria, regimen, precios });
  }
  // Quita las acomodaciones cerradas por blackout; descarta combos sin habitación.
  if (acomCerradas.size) {
    for (const c of combos) for (const a of acomCerradas) delete c.precios[a];
  }
  const combosF = combos.filter((c) => Object.keys(c.precios).some((a) => a !== "nino" && a !== "nino2"));
  return { combos: combosF, destinoNombre, hotelNombre };
}

export type CotizarResult =
  | { ok: true; combos: ComboCotizado[]; noches: number }
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
  if (!res || !res.combos.length) {
    // Diagnóstico: ¿qué temporada de las noches elegidas no tiene tarifa cargada?
    const [{ data: temps }, { data: tars }] = await Promise.all([
      admin.from("hotel_temporadas").select("nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts").eq("hotel_id", input.hotelId),
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
  return { ok: true, combos: res.combos, noches: numNoches };
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
    const { data: acomCfg } = await admin.from("hotel_acomodaciones").select("acomodacion, pax_tarifa, chd_max").eq("hotel_id", hotel);
    const reglas = (acomCfg ?? []) as { acomodacion: string; pax_tarifa: number; chd_max: number }[];
    const paxTarifa = (a: AcomRoom) => reglas.find((x) => x.acomodacion === a)?.pax_tarifa ?? PAX_TARIFA_DEFAULT[a];
    const chdMax = (a: AcomRoom) => reglas.find((x) => x.acomodacion === a)?.chd_max ?? PAX_TARIFA_DEFAULT[a];

    let mejor: { total: number; categoria: string; regimen: string; pax: number } | null = null;
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
      if (ok && (!mejor || total < mejor.total)) mejor = { total, categoria: combo.categoria, regimen: combo.regimen, pax };
    }
    if (mejor) resultados.push({
      hotelId: hotel, hotelNombre: res.hotelNombre, destino: res.destinoNombre,
      paqueteId: paquete, categoria: mejor.categoria, regimen: mejor.regimen,
      total: mejor.total, noches: numNoches, fechaIda: input.fechaIda, fechaRegreso: input.fechaRegreso,
      habitaciones, ninos: totalNinos, pax: mejor.pax,
    });
  }
  resultados.sort((a, b) => a.total - b.total);
  return { ok: true, resultados };
}

export type PasajeroReserva = {
  nombres: string;
  apellidos: string;
  tipoDoc: string;
  numeroDoc: string;
  fechaNacimiento: string;
  nacionalidad: string;
  esInfante: boolean;
};

export type ReservaInput = {
  paqueteId: number;
  bloqueoId: number | null;
  modulo: "bloqueo" | "porcion_terrestre" | "servicios";
  hotelId: number;
  paxServicios?: number;   // pax cuando es paquete tipo servicios (sin hotel)
  fechaIda?: string;       // motor por fechas (porción/dinámico): fechas elegidas
  fechaRegreso?: string;
  categoria: string;
  regimen: string;
  habitaciones: Record<string, number>; // CANTIDAD DE HABITACIONES por tipo (sencilla/doble/…)
  ninos: number;                          // cantidad de niños (Niño 1)
  ninos2: number;                         // cantidad de niños (Niño 2)
  infantes: number;                       // cantidad de infantes (sin silla, $0)
  cliente: { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; telefono: string; email: string };
  tipoAsesor: "interno" | "agencia" | "freelance";
  asesorInterno: string;
  agenciaNombre: string;
  agenciaAsesor: string;
  freelanceNombre: string;
  aliadoId?: number | null;   // id del catálogo de agencias/freelance (B2B)
  plazo: string;
  pasajeros: PasajeroReserva[];
  servicios?: number[];   // ids de servicios add-on seleccionados
};

export type ReservaResult = { ok: true; numero: string } | { ok: false; error: string };

// ── Cálculo de la reserva (SIN efectos): precios, líneas, pax, impuesto ──────
// Bloque de solo-lectura compartido por reservarDesdeTarifario (que luego inserta
// contrato/sillas/CxP) y por crearCotizacion (que solo guarda el snapshot). Tener
// una única fuente del precio evita que cotización y contrato diverjan.
type ComputoReserva = {
  meta: { hotel_nombre: string | null; destino_nombre: string | null; fecha_ida: string | null; fecha_regreso: string | null };
  pvpPorAcom: Record<string, number>;
  precioVenta: number;
  paxConSilla: number;
  totalPax: number;
  numNinos: number;
  numNinos2: number;
  lineasHab: { acom: AcomRoom; habitaciones: number; pax: number; pvp: number }[];
  serviciosItems: { nombre: string; precio: number }[];
  impuestoTotal: number;
};

async function computarReserva(
  sb: Awaited<ReturnType<typeof createClient>>,
  input: ReservaInput
): Promise<{ ok: true; data: ComputoReserva } | { ok: false; error: string }> {
  const esServicios = input.modulo === "servicios";

  const pvpPorAcom: Record<string, number> = {};
  let precioVenta = 0;
  let paxConSilla = 0;
  const lineasHab: { acom: AcomRoom; habitaciones: number; pax: number; pvp: number }[] = [];
  const numNinos = Math.max(0, Math.trunc(Number(input.ninos) || 0));
  const numNinos2 = Math.max(0, Math.trunc(Number(input.ninos2) || 0));
  let meta: { hotel_nombre: string | null; destino_nombre: string | null; fecha_ida: string | null; fecha_regreso: string | null };

  const usarFechas =
    input.modulo !== "bloqueo" && !!input.fechaIda && !!input.fechaRegreso && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!esServicios && usarFechas) {
    const numNoches = noches(input.fechaIda!, input.fechaRegreso!);
    if (numNoches <= 0) return { ok: false, error: "El regreso debe ser posterior a la ida." };
    const admin = createAdminClient();
    const res = await liquidarHotelPaquete(admin, input.paqueteId, input.hotelId, input.fechaIda!, numNoches);
    const combo = res?.combos.find((c) => c.categoria === input.categoria && c.regimen === input.regimen);
    if (!combo) return { ok: false, error: "No hay tarifa para esas fechas / categoría / régimen." };
    for (const [acom, p] of Object.entries(combo.precios)) pvpPorAcom[acom] = p;
    meta = { hotel_nombre: res!.hotelNombre, destino_nombre: res!.destinoNombre, fecha_ida: input.fechaIda!, fecha_regreso: input.fechaRegreso! };

    const { data: acomCfgF } = await sb
      .from("hotel_acomodaciones")
      .select("acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max")
      .eq("hotel_id", input.hotelId);
    const reglasF = (acomCfgF ?? []) as AcomConfig[];
    const paxTarifaF = (a: AcomRoom) => reglasF.find((x) => x.acomodacion === a)?.pax_tarifa ?? PAX_TARIFA_DEFAULT[a];
    for (const a of ACOM_ROOMS) {
      const rooms = Math.max(0, Math.trunc(Number(input.habitaciones?.[a]) || 0));
      if (rooms <= 0 || pvpPorAcom[a] == null) continue;
      const pax = rooms * paxTarifaF(a);
      precioVenta += pax * pvpPorAcom[a];
      paxConSilla += pax;
      lineasHab.push({ acom: a, habitaciones: rooms, pax, pvp: pvpPorAcom[a] });
    }
    if (numNinos > 0 && pvpPorAcom["nino"] != null) { precioVenta += numNinos * pvpPorAcom["nino"]; paxConSilla += numNinos; }
    if (numNinos2 > 0 && pvpPorAcom["nino2"] != null) { precioVenta += numNinos2 * pvpPorAcom["nino2"]; paxConSilla += numNinos2; }
    if (paxConSilla <= 0) return { ok: false, error: "Indica al menos una habitación (cantidad por tipo)." };

    const { data: hotelRowF } = await sb
      .from("hoteles").select("edad_infante_max, edad_nino_max, pax_min, pax_max").eq("id", input.hotelId).maybeSingle();
    const realF = clasificarPorEdad(
      input.pasajeros.map((p) => calcularEdad(p.fechaNacimiento, meta.fecha_ida)),
      hotelRowF?.edad_infante_max ?? 2, hotelRowF?.edad_nino_max ?? 10
    );
    // Sin pasajeros (cotización preliminar desde el carrito público) se omite la
    // validación de edades vs acomodación; se revalida al convertir en contrato.
    if (input.pasajeros.length) {
      const habNumF: Record<string, number> = {};
      for (const a of ACOM_ROOMS) { const n = Math.max(0, Math.trunc(Number(input.habitaciones?.[a]) || 0)); if (n > 0) habNumF[a] = n; }
      const valF = validarReservaHabitaciones({
        habitaciones: habNumF, reglas: reglasF, ninosDeclarados: numNinos + numNinos2,
        infantesDeclarados: Math.max(0, Math.trunc(Number(input.infantes) || 0)),
        paxMinHotel: hotelRowF?.pax_min ?? null, paxMaxHotel: hotelRowF?.pax_max ?? null, real: realF,
      });
      if (valF.errores.length) return { ok: false, error: valF.errores.join(" ") };
    }
  } else if (!esServicios) {
    let q = sb
      .from("tarifario_resultado")
      .select("acomodacion, precio_pvp, hotel_nombre, destino_nombre, fecha_ida, fecha_regreso")
      .eq("paquete_id", input.paqueteId)
      .eq("hotel_id", input.hotelId)
      .eq("categoria", input.categoria)
      .eq("regimen", input.regimen);
    q = input.bloqueoId ? q.eq("bloqueo_id", input.bloqueoId) : q.is("bloqueo_id", null);
    const { data: filas, error: fe } = await q;
    if (fe) return { ok: false, error: fe.message };
    if (!filas || !filas.length) return { ok: false, error: "No se encontró la tarifa seleccionada en el tarifario." };
    for (const f of filas) if (f.acomodacion) pvpPorAcom[f.acomodacion] = f.precio_pvp;
    meta = filas[0];

    const { data: acomCfg } = await sb
      .from("hotel_acomodaciones")
      .select("acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max")
      .eq("hotel_id", input.hotelId);
    const reglas = (acomCfg ?? []) as AcomConfig[];
    const paxTarifa = (a: AcomRoom) => {
      const c = reglas.find((x) => x.acomodacion === a);
      return c?.pax_tarifa ?? PAX_TARIFA_DEFAULT[a];
    };

    for (const a of ACOM_ROOMS) {
      const rooms = Math.max(0, Math.trunc(Number(input.habitaciones?.[a]) || 0));
      if (rooms <= 0 || pvpPorAcom[a] == null) continue;
      const pvp = pvpPorAcom[a];
      const pax = rooms * paxTarifa(a);
      precioVenta += pax * pvp;
      paxConSilla += pax;
      lineasHab.push({ acom: a, habitaciones: rooms, pax, pvp });
    }
    if (numNinos > 0 && pvpPorAcom["nino"] != null) { precioVenta += numNinos * pvpPorAcom["nino"]; paxConSilla += numNinos; }
    if (numNinos2 > 0 && pvpPorAcom["nino2"] != null) { precioVenta += numNinos2 * pvpPorAcom["nino2"]; paxConSilla += numNinos2; }

    if (paxConSilla <= 0) return { ok: false, error: "Indica al menos una habitación (cantidad por tipo)." };

    const { data: hotelRow } = await sb
      .from("hoteles")
      .select("edad_infante_max, edad_nino_max, pax_min, pax_max")
      .eq("id", input.hotelId)
      .maybeSingle();
    const real = clasificarPorEdad(
      input.pasajeros.map((p) => calcularEdad(p.fechaNacimiento, meta.fecha_ida)),
      hotelRow?.edad_infante_max ?? 2,
      hotelRow?.edad_nino_max ?? 10
    );
    if (input.pasajeros.length) {
      const habitacionesNum: Record<string, number> = {};
      for (const a of ACOM_ROOMS) {
        const n = Math.max(0, Math.trunc(Number(input.habitaciones?.[a]) || 0));
        if (n > 0) habitacionesNum[a] = n;
      }
      const val = validarReservaHabitaciones({
        habitaciones: habitacionesNum,
        reglas,
        ninosDeclarados: numNinos + numNinos2,
        infantesDeclarados: Math.max(0, Math.trunc(Number(input.infantes) || 0)),
        paxMinHotel: hotelRow?.pax_min ?? null,
        paxMaxHotel: hotelRow?.pax_max ?? null,
        real,
      });
      if (val.errores.length) return { ok: false, error: val.errores.join(" ") };
    }
  } else {
    const { data: m } = await sb
      .from("tarifario_resultado")
      .select("destino_nombre, paquete_nombre")
      .eq("paquete_id", input.paqueteId)
      .eq("modulo", "servicios")
      .limit(1)
      .maybeSingle();
    meta = { hotel_nombre: m?.paquete_nombre ?? "Servicios", destino_nombre: m?.destino_nombre ?? null, fecha_ida: null, fecha_regreso: null };
  }

  // Servicios (en tipo servicios es el total; en hotel son add-ons).
  const totalPax = esServicios ? (Number(input.paxServicios) || 0) : paxConSilla + (Number(input.infantes) || 0);
  const serviciosItems: { nombre: string; precio: number }[] = [];
  if (input.servicios?.length) {
    const { data: srvRows } = await sb
      .from("tarifario_resultado")
      .select("servicio_id, servicio_nombre, tipo_tarifa, pax_desde, pax_hasta, precio_pvp")
      .eq("paquete_id", input.paqueteId)
      .eq("modulo", "servicios")
      .in("servicio_id", input.servicios);
    const byServ = new Map<number, { nombre: string; modo: "persona" | "grupo"; personaPvp: number | null; grupos: { pax_desde: number; pax_hasta: number; precio: number }[] }>();
    for (const r of srvRows ?? []) {
      if (r.servicio_id == null) continue;
      let s = byServ.get(r.servicio_id);
      if (!s) {
        s = { nombre: r.servicio_nombre ?? "Servicio", modo: r.tipo_tarifa === "grupo" ? "grupo" : "persona", personaPvp: null, grupos: [] };
        byServ.set(r.servicio_id, s);
      }
      if (s.modo === "grupo") s.grupos.push({ pax_desde: r.pax_desde ?? 1, pax_hasta: r.pax_hasta ?? 1, precio: r.precio_pvp });
      else s.personaPvp = r.precio_pvp;
    }
    for (const s of byServ.values()) {
      const p = precioServicio(s.modo, s.personaPvp, s.grupos, totalPax);
      if (p > 0) { precioVenta += p; serviciosItems.push({ nombre: s.nombre, precio: p }); }
    }
  }

  if (esServicios && precioVenta <= 0) {
    return { ok: false, error: "Selecciona al menos un servicio y el número de pasajeros." };
  }

  // BNC (Base No Comisionable) total = "Valor fijo del impuesto" × pax con tiquete.
  let impuestoTotal = 0;
  if (!esServicios) {
    const { data: pqImp } = await sb
      .from("armado_paquetes")
      .select("impuesto_fijo")
      .eq("id", input.paqueteId)
      .maybeSingle();
    impuestoTotal = (Number(pqImp?.impuesto_fijo) || 0) * paxConSilla;
  }

  return {
    ok: true,
    data: { meta, pvpPorAcom, precioVenta, paxConSilla, totalPax, numNinos, numNinos2, lineasHab, serviciosItems, impuestoTotal },
  };
}

export async function reservarDesdeTarifario(input: ReservaInput): Promise<ReservaResult> {
  const sb = await createClient();

  if (!`${input.cliente.nombres ?? ""}${input.cliente.apellidos ?? ""}`.trim()) return { ok: false, error: "El nombre del cliente es obligatorio." };

  const esServicios = input.modulo === "servicios";

  // 1) Cálculo (precios, líneas, pax, impuesto) — fuente única compartida.
  const comp = await computarReserva(sb, input);
  if (!comp.ok) return { ok: false, error: comp.error };
  const { meta, pvpPorAcom, precioVenta, paxConSilla, totalPax, numNinos, numNinos2, lineasHab, serviciosItems, impuestoTotal } = comp.data;

  // 2c) Validar cupos del bloqueo ANTES de crear nada (no sobre-vender sillas).
  if (input.modulo === "bloqueo" && input.bloqueoId && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      const { count } = await admin
        .from("sillas")
        .select("id", { count: "exact", head: true })
        .eq("bloqueo_id", input.bloqueoId)
        .in("estado", ["disponible", "cambio_entrante"]);
      const disponibles = count ?? 0;
      if (disponibles < paxConSilla) {
        return { ok: false, error: `No hay cupos suficientes en este vuelo (disponibles: ${disponibles}, requeridos: ${paxConSilla}).` };
      }
    } catch {
      // Si falla la verificación, dejamos que el paso de sillas (más abajo) controle.
    }
  }

  // 3) Número de contrato
  const { data: numero, error: ne } = await sb.rpc("siguiente_numero_contrato");
  if (ne || !numero) return { ok: false, error: ne?.message ?? "No se pudo generar el número de contrato." };

  const canal = input.tipoAsesor === "interno" ? "B2C" : "B2B";
  // Todo contrato lleva ASESOR INTERNO (quien firma/vende internamente y a quien
  // aplica la escala). La agencia/freelance se guarda aparte (canal B2B).
  const asesorNombre = input.asesorInterno;

  // 4) Venta (cabecera) — nace PENDIENTE
  const { error: ve } = await sb.from("ventas").insert({
    numero_contrato: numero,
    cliente: `${input.cliente.nombres ?? ""} ${input.cliente.apellidos ?? ""}`.trim(),
    cliente_documento: oNull(input.cliente.numeroDoc),
    cliente_telefono: oNull(input.cliente.telefono),
    cliente_email: oNull(input.cliente.email),
    destino: meta.destino_nombre,
    tipo_paquete: input.modulo,
    fecha_salida: meta.fecha_ida,
    fecha_regreso: meta.fecha_regreso,
    pax: totalPax || paxConSilla,
    hotel: esServicios ? null : meta.hotel_nombre,
    precio_venta: precioVenta,
    impuesto: impuestoTotal,
    estado: "pendiente",
    canal,
    tipo_asesor: input.tipoAsesor,
    agencia_nombre: oNull(input.agenciaNombre),
    agencia_asesor: oNull(input.agenciaAsesor),
    freelance_nombre: oNull(input.freelanceNombre),
    plazo: oNull(input.plazo),
    paquete_armado_id: input.paqueteId,
    bloqueo_ref_id: input.bloqueoId,
    asesor_firma_nombre: oNull(asesorNombre),
    asesor: oNull(input.asesorInterno),
    plan_nombre: `${input.categoria} · ${input.regimen}`,
  });
  if (ve) return { ok: false, error: ve.message };

  // Auto-comisión B2B: si la venta es por agencia/freelance, crea la comisión con
  // el % propio del aliado (o el default general de su tipo).
  if (input.tipoAsesor !== "interno" && input.aliadoId) {
    const { data: al } = await sb
      .from("aliados")
      .select("nombre, nit, pct_comision, aplica_retencion, pct_retencion")
      .eq("id", input.aliadoId)
      .maybeSingle();
    if (al) {
      const defParam = input.tipoAsesor === "agencia" ? "COMISION_AGENCIA" : "COMISION_FREELANCE";
      const { data: p } = await sb.from("parametros_tributarios").select("valor").eq("parametro", defParam).maybeSingle();
      const pct = al.pct_comision ?? Number(p?.valor) ?? (input.tipoAsesor === "agencia" ? 0.12 : 0.11);
      await sb.from("aliados_b2b").insert({
        numero_contrato: numero,
        aliado: al.nombre,
        nit: al.nit,
        precio_venta: precioVenta,
        base_comision: precioVenta,
        pct_comision: pct,
        recobro_total: 0,
        pct_recobro_aliado: 0,
        aplica_retencion: al.aplica_retencion,
        pct_retencion: al.pct_retencion,
        estado: "pendiente",
      });
    }
  }

  // 5) Pasajeros
  if (input.pasajeros.length) {
    const { error } = await sb.from("contrato_pasajeros").insert(
      input.pasajeros.map((p, i) => ({
        numero_contrato: numero,
        nombre: `${p.nombres ?? ""} ${p.apellidos ?? ""}`.trim(),
        tipo_id: oNull(p.tipoDoc) ?? "CC",
        identificacion: oNull(p.numeroDoc),
        fecha_nacimiento: oNull(p.fechaNacimiento),
        nacionalidad: oNull(p.nacionalidad),
        es_infante: p.esInfante,
        orden: i,
      }))
    );
    if (error) return { ok: false, error: error.message };
  }

  // 6) Hotel del contrato (no aplica en paquete tipo servicios)
  if (!esServicios) {
    // Detalle legible: "1 hab Doble (2 pax), 2 hab Triple (6 pax), 1 Niño 1".
    const partes = lineasHab.map(
      (l) => `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax)`
    );
    if (numNinos > 0) partes.push(`${numNinos} Niño 1`);
    if (numNinos2 > 0) partes.push(`${numNinos2} Niño 2`);
    if ((Number(input.infantes) || 0) > 0) partes.push(`${Number(input.infantes)} Infante(s)`);
    const resumenAcom = partes.join(", ");
    // Proveedor del hotel (se arrastra al contrato). proveedores es interno, se
    // lee con service-role si está disponible.
    let proveedorHotel: string | null = null;
    if (input.hotelId) {
      const clientH = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : sb;
      const { data: hp } = await clientH.from("hoteles").select("proveedores(nombre)").eq("id", input.hotelId).maybeSingle();
      proveedorHotel = (hp?.proveedores as unknown as { nombre: string } | null)?.nombre ?? null;
    }
    await sb.from("contrato_hoteles").insert({
      numero_contrato: numero,
      nombre: meta.hotel_nombre ?? "",
      categoria: input.categoria,
      proveedor: proveedorHotel,
      ciudad: meta.destino_nombre,
      alimentacion: input.regimen,
      acomodacion: input.categoria,
      detalle_acomodacion: resumenAcom,
      fecha_ingreso: meta.fecha_ida,
      fecha_salida: meta.fecha_regreso,
      orden: 0,
    });
  }

  // 7) Vuelo del contrato (si es bloqueo)
  if (input.modulo === "bloqueo" && input.bloqueoId) {
    const { data: bq } = await sb
      .from("bloqueos_vuelo")
      .select("aerolinea, record, ruta, fecha_ida, fecha_regreso, vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg")
      .eq("id", input.bloqueoId)
      .maybeSingle();
    if (bq) {
      // Origen/Destino desde la ruta ("MDE - CTG - MDE" → origen MDE, destino CTG).
      const r = parseRuta(bq.ruta);
      await sb.from("contrato_vuelos").insert({
        numero_contrato: numero,
        aerolinea: bq.aerolinea,
        record: bq.record,
        origen_codigo: r.origen,
        origen_ciudad: ciudadIata(r.origen),
        destino_codigo: r.destino,
        destino_ciudad: ciudadIata(r.destino),
        vuelo_ida: bq.vuelo_ida,
        vuelo_regreso: bq.vuelo_regreso,
        hora_salida_ida: bq.hora_salida_ida,
        hora_llegada_ida: bq.hora_llegada_ida,
        hora_salida_reg: bq.hora_salida_reg,
        hora_llegada_reg: bq.hora_llegada_reg,
        servicios: bq.ruta,
        fecha_salida: bq.fecha_ida,
        fecha_regreso: bq.fecha_regreso,
        orden: 0,
      });
    }
  }

  // 8) Ítems de valores: una fila por tipo de habitación (adultos = pax que cubre)
  // y una fila por grupo de niños. La tarifa es por persona (PVP del tarifario).
  const items: {
    numero_contrato: string; descripcion: string; adultos: number; ninos: number;
    tarifa_adulto: number; tarifa_nino: number; orden: number;
  }[] = [];
  lineasHab.forEach((l, i) => {
    items.push({
      numero_contrato: numero,
      descripcion: `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax) · ${input.categoria} / ${input.regimen}`,
      adultos: l.pax,
      ninos: 0,
      tarifa_adulto: l.pvp,
      tarifa_nino: 0,
      orden: i,
    });
  });
  if (numNinos > 0 && pvpPorAcom["nino"] != null) {
    items.push({
      numero_contrato: numero,
      descripcion: `Niño 1 · ${input.categoria} / ${input.regimen}`,
      adultos: 0, ninos: numNinos, tarifa_adulto: 0, tarifa_nino: pvpPorAcom["nino"], orden: 50,
    });
  }
  if (numNinos2 > 0 && pvpPorAcom["nino2"] != null) {
    items.push({
      numero_contrato: numero,
      descripcion: `Niño 2 · ${input.categoria} / ${input.regimen}`,
      adultos: 0, ninos: numNinos2, tarifa_adulto: 0, tarifa_nino: pvpPorAcom["nino2"], orden: 51,
    });
  }
  // Servicios add-on como ítems (1 fila por servicio, total del grupo o por pax)
  serviciosItems.forEach((s, i) => {
    items.push({
      numero_contrato: numero,
      descripcion: `Servicio · ${s.nombre}`,
      adultos: 1,
      ninos: 0,
      tarifa_adulto: s.precio,
      tarifa_nino: 0,
      orden: 100 + i,
    });
  });
  if (items.length) await sb.from("contrato_items").insert(items);

  // Cuentas por pagar (CxP) generadas AUTOMÁTICAMENTE porque la venta sale del
  // tarifario: una por proveedor de aéreo, hotel y cada servicio. Se acumulan
  // en los pasos 9/10/11 (que ya leen los costos netos con service-role) y se
  // insertan en el paso 12. El proveedor (con su retención) se jala del catálogo.
  const hoyISO = new Date().toISOString().slice(0, 10);
  const OBS_AUTO = "Generado automáticamente desde el tarifario";
  type ProvFact = { nombre: string | null; aplica_retencion: boolean | null; pct_retencion: number | null } | null;
  type CxPRow = {
    numero_contrato: string; proveedor: string | null; tipo_proveedor: string;
    servicio: string; valor_total: number; fecha_obligacion: string;
    aplica_retencion: boolean; pct_retencion: number; observaciones: string;
  };
  const cxp: CxPRow[] = [];
  const pushCxP = (tipo: string, servicio: string, valor: number, pr: ProvFact, nombreFallback?: string | null) => {
    if (!(valor > 0)) return;
    cxp.push({
      numero_contrato: numero,
      proveedor: pr?.nombre ?? nombreFallback ?? null,
      tipo_proveedor: tipo,
      servicio,
      valor_total: valor,
      fecha_obligacion: hoyISO,
      aplica_retencion: pr?.aplica_retencion ?? false,
      pct_retencion: Number(pr?.pct_retencion) || 0,
      observaciones: OBS_AUTO,
    });
  };

  // 9) Sillas + costo aéreo (admin: oculto al asesor). Requiere service-role.
  if (input.modulo === "bloqueo" && input.bloqueoId && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      const { data: bq } = await admin
        .from("bloqueos_vuelo")
        .select("tarifa_para_empaquetar, aerolinea, proveedores(nombre, aplica_retencion, pct_retencion)")
        .eq("id", input.bloqueoId)
        .maybeSingle();
      if (bq) {
        const costoAereo = (Number(bq.tarifa_para_empaquetar) || 0) * paxConSilla;
        await admin.from("ventas").update({ costo_aereo: costoAereo }).eq("numero_contrato", numero);
        const prA = bq.proveedores as unknown as ProvFact;
        pushCxP("aereo", `Aéreo ${bq.aerolinea ?? ""}`.trim(), costoAereo, prA, bq.aerolinea);
      }
      const { data: libres } = await admin
        .from("sillas")
        .select("id")
        .eq("bloqueo_id", input.bloqueoId)
        .in("estado", ["disponible", "cambio_entrante"])
        .order("numero_silla")
        .limit(paxConSilla);
      if (libres && libres.length) {
        // Copia los datos del pasajero a cada silla (una silla por pasajero con
        // silla; los infantes no ocupan silla).
        const holders = input.pasajeros.filter((p) => !p.esInfante);
        await Promise.all(
          libres.map((s, i) => {
            const p = holders[i];
            return admin.from("sillas").update({
              estado: "en_plazo",
              numero_contrato: numero,
              asesor: oNull(asesorNombre),
              hotel: meta.hotel_nombre,
              acomodacion: input.categoria,
              plazo: oNull(input.plazo),
              pasajero_nombres: oNull(p?.nombres),
              pasajero_apellidos: oNull(p?.apellidos),
              tipo_doc: oNull(p?.tipoDoc),
              numero_doc: oNull(p?.numeroDoc),
              nacimiento: oNull(p?.fechaNacimiento),
            }).eq("id", s.id);
          })
        );
      }
    } catch {
      // No bloquear la reserva si falla el paso administrativo.
    }
  }

  // 10) Costo neto del HOTEL (liquidado noche por noche) — admin, oculto al asesor.
  //     La tarifa neta (tarifa_hotel) es interna; por eso se lee con service-role.
  if (!esServicios && meta.fecha_ida && meta.fecha_regreso && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      const numNoches = noches(meta.fecha_ida, meta.fecha_regreso);
      if (numNoches > 0) {
        const [{ data: temps }, { data: tarRows }, { data: hprov }] = await Promise.all([
          admin.from("hotel_temporadas").select("nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts").eq("hotel_id", input.hotelId),
          admin.from("tarifa_hotel")
            .select("temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2")
            .eq("hotel_id", input.hotelId).eq("tipo_habitacion", input.categoria).eq("alimentacion", input.regimen),
          admin.from("hoteles").select("nombre, proveedores(nombre, aplica_retencion, pct_retencion)").eq("id", input.hotelId).maybeSingle(),
        ]);
        type TarRow = {
          temporada: string | null; neto_sencilla: number | null; neto_doble: number | null;
          neto_triple: number | null; neto_multiple: number | null; neto_nino: number | null; neto_nino2: number | null;
        };
        const rows = (tarRows ?? []) as TarRow[];
        const temporadas = (temps ?? []).map(toTemporadaRango);
        const colDe: Record<string, keyof TarRow> = {
          sencilla: "neto_sencilla", doble: "neto_doble", triple: "neto_triple",
          multiple: "neto_multiple", nino: "neto_nino", nino2: "neto_nino2",
        };
        const netoPersona = (acom: string): number | null => {
          const col = colDe[acom];
          const netoPorTemporada: Record<string, number | null> = {};
          for (const r of rows) if (r.temporada) netoPorTemporada[r.temporada] = r[col] as number | null;
          return liquidarHotelNoches({ fechaIda: meta.fecha_ida!, numNoches, temporadas, netoPorTemporada });
        };
        let costoHotel = 0;
        for (const l of lineasHab) {
          const per = netoPersona(l.acom);
          if (per != null) costoHotel += per * l.pax;
        }
        if (numNinos > 0) { const per = netoPersona("nino"); if (per != null) costoHotel += per * numNinos; }
        if (numNinos2 > 0) { const per = netoPersona("nino2"); if (per != null) costoHotel += per * numNinos2; }
        if (costoHotel > 0) {
          await admin.from("ventas").update({ costo_hotel: costoHotel }).eq("numero_contrato", numero);
          const prH = hprov?.proveedores as unknown as ProvFact;
          pushCxP("hotel", `Hotel ${meta.hotel_nombre ?? hprov?.nombre ?? ""}`.trim(), costoHotel, prH);
        }
      }
    } catch {
      // El costo neto es informativo para rentabilidad; no bloquea la reserva.
    }
  }

  // 11) Costo neto de SERVICIOS (receptivo) — admin, oculto al asesor.
  if (input.servicios?.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      const [{ data: arm }, { data: gruposNet }] = await Promise.all([
        admin.from("armado_servicios")
          .select("servicio_id, modo, servicios_adicionales(precio_persona, categoria, nombre, liquidacion, proveedores(nombre, aplica_retencion, pct_retencion))")
          .eq("paquete_id", input.paqueteId).in("servicio_id", input.servicios),
        admin.from("servicio_tarifa_pax")
          .select("servicio_id, pax_desde, pax_hasta, precio").in("servicio_id", input.servicios),
      ]);
      const gruposPorServ = new Map<number, { pax_desde: number; pax_hasta: number; precio: number }[]>();
      for (const g of gruposNet ?? []) {
        const arr = gruposPorServ.get(g.servicio_id) ?? [];
        arr.push({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: g.precio });
        gruposPorServ.set(g.servicio_id, arr);
      }
      const nochesStay = meta.fecha_ida && meta.fecha_regreso ? noches(meta.fecha_ida, meta.fecha_regreso) : 1;
      let costoReceptivo = 0;
      const tours: string[] = [];
      let hayAsistencia = false;
      for (const s of arm ?? []) {
        const modo = (s.modo as string) === "grupo" ? "grupo" : "persona";
        const srv = s.servicios_adicionales as unknown as { precio_persona: number | null; categoria: string | null; nombre: string; liquidacion: string | null; proveedores: ProvFact } | null;
        const costoServ = precioServicio(modo, srv?.precio_persona ?? null, gruposPorServ.get(s.servicio_id) ?? [], totalPax) * factorLiquidacion(srv?.liquidacion, nochesStay);
        costoReceptivo += costoServ;
        const cat = srv?.categoria ?? "otro";
        if (cat === "asistencia") hayAsistencia = true;
        else if (cat === "tour_traslado" && srv?.nombre) tours.push(srv.nombre);
        // Una CxP por servicio (asistencia médica va a su propio tipo de proveedor).
        pushCxP(cat === "asistencia" ? "asistencia" : "receptivo", srv?.nombre ?? "Servicio", costoServ, srv?.proveedores ?? null);
      }
      const upd: { costo_receptivo?: number; tours_traslados?: string; asistencia_medica?: boolean } = {};
      if (costoReceptivo > 0) upd.costo_receptivo = costoReceptivo;
      if (tours.length) upd.tours_traslados = tours.join(", ");
      if (hayAsistencia) upd.asistencia_medica = true;
      if (Object.keys(upd).length) await admin.from("ventas").update(upd).eq("numero_contrato", numero);
    } catch {
      // Costo neto informativo; no bloquea la reserva.
    }
  }

  // 12) Insertar las cuentas por pagar acumuladas (hotel/aéreo/servicios). Como
  //     la venta proviene del tarifario, los proveedores y costos ya se conocen.
  if (cxp.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      await admin.from("cuentas_por_pagar").insert(cxp);
    } catch {
      // No bloquear la reserva si falla la creación automática de CxP.
    }
  }

  revalidatePath("/dashboard/contratos");
  return { ok: true, numero };
}

// ── COTIZACIONES: presupuesto SIN número de contrato ───────────────────────
// crearCotizacion reusa computarReserva (mismo precio que el contrato) y guarda
// un snapshot listo para el PDF. NO toca inventario ni numera. Al convertir se
// llama a reservarDesdeTarifario (que sí genera número, sillas y CxP).
export type CotizacionResult = { ok: true; id: number } | { ok: false; error: string };

export async function crearCotizacion(input: ReservaInput, opts?: { vigenciaHasta?: string }): Promise<CotizacionResult> {
  const sb = await createClient();
  if (!`${input.cliente.nombres ?? ""}${input.cliente.apellidos ?? ""}`.trim())
    return { ok: false, error: "El nombre del cliente es obligatorio." };

  const esServicios = input.modulo === "servicios";
  const comp = await computarReserva(sb, input);
  if (!comp.ok) return { ok: false, error: comp.error };
  const { meta, pvpPorAcom, precioVenta, paxConSilla, totalPax, numNinos, numNinos2, lineasHab, serviciosItems } = comp.data;

  const hoy = new Date().toISOString().slice(0, 10);
  const asesorNombre = input.asesorInterno;
  const clienteNombre = `${input.cliente.nombres ?? ""} ${input.cliente.apellidos ?? ""}`.trim();
  const planNombre = esServicios ? null : `${input.categoria} · ${input.regimen}`;

  // Snapshot para el documento/PDF (objetos planos tipo contrato_*, sin proveedor).
  const ventaSnap: Record<string, unknown> = {
    numero_contrato: "",
    cliente: clienteNombre,
    cliente_documento: oNull(input.cliente.numeroDoc),
    cliente_telefono: oNull(input.cliente.telefono),
    cliente_direccion: null,
    destino: meta.destino_nombre,
    fecha_emision: hoy,
    fecha_salida: meta.fecha_ida,
    fecha_regreso: meta.fecha_regreso,
    pax: totalPax || paxConSilla,
    estado: "pendiente",
    plan_nombre: planNombre,
    asistencia_medica: false,
    tours_traslados: null,
    asesor_firma_nombre: oNull(asesorNombre),
    asesor_firma_cargo: "Asesor/a",
    asesor_firma_cc: null,
    asesor_firma_tel: null,
    moneda: "COP",
  };

  const pasajerosSnap: Record<string, unknown>[] = input.pasajeros.map((p, i) => ({
    id: i + 1,
    nombre: `${p.nombres ?? ""} ${p.apellidos ?? ""}`.trim(),
    tipo_id: oNull(p.tipoDoc) ?? "CC",
    identificacion: oNull(p.numeroDoc),
    fecha_nacimiento: oNull(p.fechaNacimiento),
    es_infante: p.esInfante,
  }));

  const hotelesSnap: Record<string, unknown>[] = [];
  if (!esServicios) {
    const partes = lineasHab.map((l) => `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax)`);
    if (numNinos > 0) partes.push(`${numNinos} Niño 1`);
    if (numNinos2 > 0) partes.push(`${numNinos2} Niño 2`);
    if ((Number(input.infantes) || 0) > 0) partes.push(`${Number(input.infantes)} Infante(s)`);
    // Foto de portada del hotel (para mostrarla junto al nombre en el documento).
    let fotoUrl: string | null = null;
    if (input.hotelId) {
      const { data: fotos } = await sb.from("hotel_fotos").select("url, es_portada, orden").eq("hotel_id", input.hotelId).order("orden");
      for (const f of fotos ?? []) { if (fotoUrl == null) fotoUrl = f.url; if (f.es_portada) fotoUrl = f.url; }
    }
    hotelesSnap.push({
      id: 1,
      nombre: meta.hotel_nombre ?? "",
      categoria: input.categoria,
      ciudad: meta.destino_nombre,
      proveedor: null,
      alimentacion: input.regimen,
      acomodacion: input.categoria,
      detalle_acomodacion: partes.join(", "),
      fecha_ingreso: meta.fecha_ida,
      fecha_salida: meta.fecha_regreso,
      nota_regimen: null,
      foto_url: fotoUrl,
    });
  }

  const vuelosSnap: Record<string, unknown>[] = [];
  if (input.modulo === "bloqueo" && input.bloqueoId) {
    const { data: bq } = await sb
      .from("bloqueos_vuelo")
      .select("aerolinea, record, ruta, fecha_ida, fecha_regreso, vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg")
      .eq("id", input.bloqueoId).maybeSingle();
    if (bq) {
      const r = parseRuta(bq.ruta);
      vuelosSnap.push({
        id: 1, aerolinea: bq.aerolinea, record: bq.record,
        origen_codigo: r.origen, origen_ciudad: ciudadIata(r.origen),
        destino_codigo: r.destino, destino_ciudad: ciudadIata(r.destino),
        vuelo_ida: bq.vuelo_ida, vuelo_regreso: bq.vuelo_regreso,
        hora_salida_ida: bq.hora_salida_ida, hora_llegada_ida: bq.hora_llegada_ida,
        hora_salida_reg: bq.hora_salida_reg, hora_llegada_reg: bq.hora_llegada_reg,
        servicios: bq.ruta, fecha_salida: bq.fecha_ida, fecha_regreso: bq.fecha_regreso,
      });
    }
  }

  const itemsSnap: Record<string, unknown>[] = [];
  lineasHab.forEach((l, i) => itemsSnap.push({
    id: i + 1,
    descripcion: `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax) · ${input.categoria} / ${input.regimen}`,
    adultos: l.pax, ninos: 0, tarifa_adulto: l.pvp, tarifa_nino: 0,
  }));
  if (numNinos > 0 && pvpPorAcom["nino"] != null)
    itemsSnap.push({ id: 50, descripcion: `Niño 1 · ${input.categoria} / ${input.regimen}`, adultos: 0, ninos: numNinos, tarifa_adulto: 0, tarifa_nino: pvpPorAcom["nino"] });
  if (numNinos2 > 0 && pvpPorAcom["nino2"] != null)
    itemsSnap.push({ id: 51, descripcion: `Niño 2 · ${input.categoria} / ${input.regimen}`, adultos: 0, ninos: numNinos2, tarifa_adulto: 0, tarifa_nino: pvpPorAcom["nino2"] });
  serviciosItems.forEach((s, i) => itemsSnap.push({ id: 100 + i, descripcion: `Servicio · ${s.nombre}`, adultos: 1, ninos: 0, tarifa_adulto: s.precio, tarifa_nino: 0 }));

  const detalle = { venta: ventaSnap, pasajeros: pasajerosSnap, hoteles: hotelesSnap, vuelos: vuelosSnap, items: itemsSnap };

  // Vigencia: la que indique el asesor o, por defecto, 24 horas (hoy + 1 día).
  let vigencia = opts?.vigenciaHasta && /^\d{4}-\d{2}-\d{2}$/.test(opts.vigenciaHasta) ? opts.vigenciaHasta : null;
  if (!vigencia) { const vig = new Date(); vig.setDate(vig.getDate() + 1); vigencia = vig.toISOString().slice(0, 10); }

  const { data: { user } } = await sb.auth.getUser();

  const { data: row, error } = await sb.from("cotizaciones").insert({
    payload: input as unknown as Json,
    detalle: detalle as unknown as Json,
    cliente: clienteNombre,
    cliente_documento: oNull(input.cliente.numeroDoc),
    destino: meta.destino_nombre,
    hotel: esServicios ? null : meta.hotel_nombre,
    modulo: input.modulo,
    plan_nombre: planNombre,
    pax: totalPax || paxConSilla,
    precio_venta: precioVenta,
    moneda: "COP",
    fecha_salida: meta.fecha_ida,
    fecha_regreso: meta.fecha_regreso,
    vigencia_hasta: vigencia,
    paquete_armado_id: input.paqueteId,
    asesor: oNull(asesorNombre),
    creado_por: user?.email ?? null,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/cotizaciones");
  return { ok: true, id: row.id };
}

// Convierte una cotización en CONTRATO: corre el motor de reserva normal (genera
// numero_contrato + sillas + CxP) con el payload guardado, y enlaza la cotización.
export async function convertirCotizacion(id: number, pasajeros?: PasajeroReserva[], override?: boolean, asesorInterno?: string): Promise<ReservaResult> {
  const sb = await createClient();
  const { data: cot, error } = await sb
    .from("cotizaciones")
    .select("estado, payload, numero_contrato")
    .eq("id", id)
    .maybeSingle();
  if (error || !cot) return { ok: false, error: error?.message ?? "Cotización no encontrada." };
  if (cot.estado === "convertida" && cot.numero_contrato) return { ok: true, numero: cot.numero_contrato };
  if (cot.estado === "descartada") return { ok: false, error: "La cotización está descartada; no se puede convertir." };

  const payload = cot.payload as unknown as ReservaInput;
  // Un contrato necesita pasajeros: usa los capturados ahora o los que ya trae la
  // cotización (las internas los traen; las del tarifario B2C no). Sin pasajeros
  // no pasa a contrato, salvo override de superadmin.
  const pax = pasajeros && pasajeros.length ? pasajeros : (payload.pasajeros ?? []);
  if (!pax.length) {
    const { data: { user } } = await sb.auth.getUser();
    const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
    if (!(override && perfil?.rol === "superadmin")) {
      return { ok: false, error: "Captura los datos de los pasajeros antes de generar el contrato." };
    }
  }

  // Si viene del portal B2C, el asesor interno que la gestiona se elige al convertir.
  const asesor = asesorInterno?.trim() || payload.asesorInterno || "";
  const res = await reservarDesdeTarifario({ ...payload, pasajeros: pax, asesorInterno: asesor });
  if (!res.ok) return res;

  await sb.from("cotizaciones").update({ estado: "convertida", numero_contrato: res.numero }).eq("id", id);
  revalidatePath("/dashboard/cotizaciones");
  revalidatePath(`/dashboard/cotizaciones/${id}`);
  revalidatePath("/dashboard/contratos");
  return { ok: true, numero: res.numero };
}

export async function actualizarVigenciaCotizacion(id: number, vigenciaHasta: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenciaHasta)) return { ok: false, error: "Fecha inválida." };
  const sb = await createClient();
  const { error } = await sb.from("cotizaciones").update({ vigencia_hasta: vigenciaHasta }).eq("id", id).eq("estado", "abierta");
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/cotizaciones/${id}`);
  return { ok: true };
}

export async function descartarCotizacion(id: number): Promise<{ ok: boolean; error?: string }> {
  const sb = await createClient();
  const { error } = await sb.from("cotizaciones").update({ estado: "descartada" }).eq("id", id).eq("estado", "abierta");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/cotizaciones");
  revalidatePath(`/dashboard/cotizaciones/${id}`);
  return { ok: true };
}

// ── Confirmar venta: sillas en_plazo -> confirmada ─────────────────────────
export async function confirmarVenta(numeroContrato: string): Promise<{ ok: boolean; error?: string }> {
  const sb = await createClient();
  const { error } = await sb.from("ventas").update({ estado: "confirmado" }).eq("numero_contrato", numeroContrato);
  if (error) return { ok: false, error: error.message };
  // Sillas a confirmada (admin si hay service-role; si no, intento directo)
  const client = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : sb;
  await client.from("sillas").update({ estado: "confirmada" }).eq("numero_contrato", numeroContrato).eq("estado", "en_plazo");
  // Respaldo: si el contrato aún no tiene cuentas por pagar (p. ej. venía de
  // legacy o se creó manual), generarlas desde sus costos al confirmar. No debe
  // tumbar la confirmación si falla.
  try { await asegurarCuentasPorPagar(numeroContrato); } catch { /* no bloquear la confirmación */ }
  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  revalidatePath("/dashboard/contratos");
  return { ok: true };
}

// ── Respaldo de cuentas por pagar ──────────────────────────────────────────
// Si un contrato NO tiene cuentas por pagar, las crea a partir de sus costos
// (hotel/aéreo/receptivo/asistencia/otros). No duplica: si ya hay alguna CxP
// (p. ej. creada al reservar desde el tarifario con su proveedor), no hace nada.
// El proveedor queda sin asignar para que el área contable lo elija en el contrato.
export async function asegurarCuentasPorPagar(numeroContrato: string): Promise<{ ok: boolean; creadas: number }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, creadas: 0 };
  const admin = createAdminClient();

  const { count } = await admin
    .from("cuentas_por_pagar")
    .select("id", { count: "exact", head: true })
    .eq("numero_contrato", numeroContrato);
  if ((count ?? 0) > 0) return { ok: true, creadas: 0 }; // ya tiene CxP

  const { data: v } = await admin
    .from("ventas")
    .select("costo_hotel, costo_aereo, costo_receptivo, costo_asistencia, otros_costos, moneda, hotel, aerolinea, plazo, fecha_salida")
    .eq("numero_contrato", numeroContrato)
    .maybeSingle();
  if (!v) return { ok: false, creadas: 0 };

  const hoy = new Date().toISOString().slice(0, 10);
  const vence = (v.plazo as string | null) ?? (v.fecha_salida as string | null) ?? null;
  const moneda = (v.moneda as string | null) ?? "COP";

  const defs: { costo: number; tipo: string; servicio: string }[] = [
    { costo: Number(v.costo_hotel) || 0, tipo: "hotel", servicio: `Hotel ${v.hotel ?? ""}`.trim() },
    { costo: Number(v.costo_aereo) || 0, tipo: "aereo", servicio: `Aéreo ${v.aerolinea ?? ""}`.trim() },
    { costo: Number(v.costo_receptivo) || 0, tipo: "receptivo", servicio: "Servicios receptivos" },
    { costo: Number(v.costo_asistencia) || 0, tipo: "asistencia", servicio: "Asistencia médica" },
    { costo: Number(v.otros_costos) || 0, tipo: "otro", servicio: "Otros costos" },
  ];
  const rows = defs
    .filter((d) => d.costo > 0)
    .map((d) => ({
      numero_contrato: numeroContrato,
      proveedor: null,
      tipo_proveedor: d.tipo,
      servicio: d.servicio,
      valor_total: d.costo,
      moneda,
      fecha_obligacion: hoy,
      fecha_vencimiento: vence,
    }));
  if (!rows.length) return { ok: true, creadas: 0 };

  const { error } = await admin.from("cuentas_por_pagar").insert(rows);
  if (error) return { ok: false, creadas: 0 };
  revalidatePath("/dashboard/pagos");
  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  return { ok: true, creadas: rows.length };
}

// ── Liberar reservas vencidas (plazo pasado y sin confirmar) ───────────────
export async function liberarVencidas(): Promise<{ ok: boolean; liberadas: number }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, liberadas: 0 };
  const admin = createAdminClient();
  const hoy = new Date().toISOString().slice(0, 10);
  const { data: vencidas } = await admin
    .from("ventas")
    .select("numero_contrato")
    .eq("estado", "pendiente")
    .lt("plazo", hoy);
  const nums = (vencidas ?? []).map((v) => v.numero_contrato);
  if (!nums.length) return { ok: true, liberadas: 0 };
  // Liberar sillas en_plazo de esos contratos
  await admin
    .from("sillas")
    .update({ estado: "disponible", numero_contrato: null, asesor: null, hotel: null, acomodacion: null, plazo: null })
    .in("numero_contrato", nums)
    .eq("estado", "en_plazo");
  await admin.from("ventas").update({ estado: "cancelado" }).in("numero_contrato", nums);
  revalidatePath("/dashboard/contratos");
  return { ok: true, liberadas: nums.length };
}

// ── Reservar un PROGRAMA (circuito de proveedor, en su moneda) ──────────────
// Flujo dedicado: el precio se calcula desde la matriz del programa (neto +
// markup), autoritativo en el servidor. Crea venta (con moneda), pasajeros,
// ítems, hoteles por ciudad y la cuenta por pagar al proveedor (en su moneda).
export type ReservaProgramaInput = {
  programaId: number;
  categoriaId: number;
  fechaIda: string;
  paxPorAcom: Record<string, number>; // CANTIDAD DE HABITACIONES por acomodación (sencilla/doble/triple/…). Pax = hab × pax_tarifa.
  ninos: number;
  cliente: { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; telefono: string; email: string };
  tipoAsesor: "interno" | "agencia" | "freelance";
  asesorInterno: string;
  agenciaNombre: string;
  agenciaAsesor: string;
  freelanceNombre: string;
  plazo: string;
  pasajeros: PasajeroReserva[];
};

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export async function reservarPrograma(input: ReservaProgramaInput): Promise<ReservaResult> {
  const sb = await createClient();
  if (!`${input.cliente.nombres ?? ""}${input.cliente.apellidos ?? ""}`.trim())
    return { ok: false, error: "El nombre del cliente es obligatorio." };
  if (!input.fechaIda) return { ok: false, error: "Elige la fecha de salida." };

  // 1) Programa + precios (autoritativo). proveedores/neto se leen aquí.
  const { data: prog } = await sb
    .from("programas")
    .select("id, nombre, subtitulo, moneda, pct_mk, dias, noches, proveedor_id, vigencia_desde, vigencia_hasta, proveedores(nombre, aplica_retencion, pct_retencion)")
    .eq("id", input.programaId)
    .maybeSingle();
  if (!prog) return { ok: false, error: "Programa no encontrado." };

  // Vigencia
  if (prog.vigencia_desde && input.fechaIda < prog.vigencia_desde)
    return { ok: false, error: "La fecha de salida es anterior a la vigencia del programa." };
  if (prog.vigencia_hasta && input.fechaIda > prog.vigencia_hasta)
    return { ok: false, error: "La fecha de salida supera la vigencia del programa." };

  // Blackouts
  const { data: bos } = await sb
    .from("programa_blackouts")
    .select("fecha_inicio, fecha_fin, motivo")
    .eq("programa_id", input.programaId);
  for (const b of bos ?? []) {
    if (b.fecha_inicio && b.fecha_fin && input.fechaIda >= b.fecha_inicio && input.fechaIda <= b.fecha_fin)
      return { ok: false, error: `La fecha cae en un blackout${b.motivo ? ` (${b.motivo})` : ""}.` };
  }

  // 2) Precios de la categoría elegida
  const { data: precios } = await sb
    .from("programa_precios")
    .select("acomodacion, neto, bajo_solicitud")
    .eq("categoria_id", input.categoriaId);
  if (!precios?.length) return { ok: false, error: "La categoría no tiene precios cargados." };
  const netoDe: Record<string, { neto: number | null; bs: boolean }> = {};
  for (const p of precios) netoDe[p.acomodacion] = { neto: p.neto, bs: p.bajo_solicitud };

  const mk = Number(prog.pct_mk) || 0;
  const pvp = (neto: number) => (mk > 0 && mk < 1 ? Math.round(neto / (1 - mk)) : Math.round(neto));

  // 3) Liquidación por HABITACIONES (igual que hoteles): pax = hab × pax_tarifa
  //    (Doble ⇒ 2 pax, Triple ⇒ 3, Sencilla ⇒ 1). El precio de la matriz es por
  //    persona, así que 1 habitación = pax_tarifa × precio/persona. Niños aparte.
  const habs = Object.entries(input.paxPorAcom).filter(([, n]) => (Number(n) || 0) > 0);
  if (!habs.length && (input.ninos || 0) <= 0)
    return { ok: false, error: "Indica cuántas habitaciones reservas en cada acomodación." };

  let precioVenta = 0;
  let costoNeto = 0;
  let totalPax = 0;
  const items: { numero_contrato: string; descripcion: string; adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number; orden: number }[] = [];
  const catNombre = (await sb.from("programa_categorias").select("nombre").eq("id", input.categoriaId).maybeSingle()).data?.nombre ?? null;

  let orden = 0;
  for (const [acom, habRaw] of habs) {
    const nHab = Number(habRaw) || 0;
    const info = netoDe[acom];
    if (!info || info.neto == null || info.bs)
      return { ok: false, error: `La acomodación ${acom} no tiene precio (o es "a solicitud") en esta categoría.` };
    const paxTarifa = PAX_TARIFA_DEFAULT[acom as AcomRoom] ?? 1; // pax por habitación
    const nPax = nHab * paxTarifa;
    const precioPax = pvp(info.neto);
    const label = ACOM_ROOM_LABEL[acom as AcomRoom] ?? acom;
    precioVenta += precioPax * nPax;
    costoNeto += info.neto * nPax;
    totalPax += nPax;
    items.push({
      numero_contrato: "",
      descripcion: `${nHab} hab ${label} (${nPax} pax)${catNombre ? ` · ${catNombre}` : ""}`,
      adultos: nPax,
      ninos: 0,
      tarifa_adulto: precioPax,
      tarifa_nino: 0,
      orden: orden++,
    });
  }
  // Niños (por cantidad, no por habitación)
  if ((input.ninos || 0) > 0) {
    const info = netoDe["nino"];
    if (!info || info.neto == null || info.bs)
      return { ok: false, error: `Esta categoría no tiene precio de niño (o es "a solicitud").` };
    const n = Number(input.ninos) || 0;
    const precioPax = pvp(info.neto);
    precioVenta += precioPax * n;
    costoNeto += info.neto * n;
    totalPax += n;
    items.push({
      numero_contrato: "",
      descripcion: `${n} niño(s)${catNombre ? ` · ${catNombre}` : ""}`,
      adultos: 0,
      ninos: n,
      tarifa_adulto: 0,
      tarifa_nino: precioPax,
      orden: orden++,
    });
  }
  if (totalPax <= 0) return { ok: false, error: "Debe haber al menos un pasajero." };

  // 4) Número de contrato
  const { data: numero, error: ne } = await sb.rpc("siguiente_numero_contrato");
  if (ne || !numero) return { ok: false, error: ne?.message ?? "No se pudo generar el número de contrato." };

  const canal = input.tipoAsesor === "interno" ? "B2C" : "B2B";
  // Todo contrato lleva ASESOR INTERNO (quien firma/vende internamente y a quien
  // aplica la escala). La agencia/freelance se guarda aparte (canal B2B).
  const asesorNombre = input.asesorInterno;
  const fechaRegreso = prog.dias ? sumarDias(input.fechaIda, Math.max(0, prog.dias - 1)) : null;

  // 5) Venta (cabecera) — nace PENDIENTE, en la moneda del programa
  const { error: ve } = await sb.from("ventas").insert({
    numero_contrato: numero,
    cliente: `${input.cliente.nombres ?? ""} ${input.cliente.apellidos ?? ""}`.trim(),
    cliente_documento: oNull(input.cliente.numeroDoc),
    cliente_telefono: oNull(input.cliente.telefono),
    cliente_email: oNull(input.cliente.email),
    destino: prog.subtitulo ?? prog.nombre,
    tipo_paquete: "programa",
    moneda: prog.moneda,
    fecha_salida: input.fechaIda,
    fecha_regreso: fechaRegreso,
    pax: totalPax,
    hotel: prog.nombre,
    precio_venta: precioVenta,
    estado: "pendiente",
    canal,
    tipo_asesor: input.tipoAsesor,
    agencia_nombre: oNull(input.agenciaNombre),
    agencia_asesor: oNull(input.agenciaAsesor),
    freelance_nombre: oNull(input.freelanceNombre),
    plazo: oNull(input.plazo),
    asesor_firma_nombre: oNull(asesorNombre),
    plan_nombre: catNombre ?? prog.nombre,
  });
  if (ve) return { ok: false, error: ve.message };

  // 6) Pasajeros
  if (input.pasajeros.length) {
    const { error } = await sb.from("contrato_pasajeros").insert(
      input.pasajeros.map((p, i) => ({
        numero_contrato: numero,
        nombre: `${p.nombres ?? ""} ${p.apellidos ?? ""}`.trim(),
        tipo_id: oNull(p.tipoDoc) ?? "CC",
        identificacion: oNull(p.numeroDoc),
        fecha_nacimiento: oNull(p.fechaNacimiento),
        nacionalidad: oNull(p.nacionalidad),
        es_infante: p.esInfante,
        orden: i,
      }))
    );
    if (error) return { ok: false, error: error.message };
  }

  // 7) Ítems (líneas por acomodación)
  for (const it of items) it.numero_contrato = numero;
  if (items.length) await sb.from("contrato_items").insert(items);

  // 8) Hoteles por ciudad (de la categoría elegida) — informativo en el contrato
  const { data: hotelesCat } = await sb
    .from("programa_categoria_hoteles")
    .select("ciudad, hotel, orden")
    .eq("categoria_id", input.categoriaId)
    .order("orden");
  const provNombre = (prog.proveedores as unknown as { nombre: string } | null)?.nombre ?? null;
  if (hotelesCat?.length) {
    await sb.from("contrato_hoteles").insert(
      hotelesCat.map((h, i) => ({
        numero_contrato: numero,
        nombre: h.hotel ?? "",
        categoria: catNombre,
        proveedor: provNombre,
        ciudad: h.ciudad,
        detalle_acomodacion: `${totalPax} pax`,
        orden: i,
      }))
    );
  }

  // 9) Cuenta por pagar al proveedor del programa (neto, en la moneda del programa).
  if (costoNeto > 0 && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      const pr = prog.proveedores as unknown as { nombre: string | null; aplica_retencion: boolean | null; pct_retencion: number | null } | null;
      await admin.from("ventas").update({ costo_receptivo: costoNeto }).eq("numero_contrato", numero);
      await admin.from("cuentas_por_pagar").insert({
        numero_contrato: numero,
        proveedor: pr?.nombre ?? null,
        tipo_proveedor: "programa",
        servicio: prog.nombre,
        valor_total: costoNeto,
        moneda: prog.moneda,
        fecha_obligacion: new Date().toISOString().slice(0, 10),
        aplica_retencion: pr?.aplica_retencion ?? false,
        pct_retencion: Number(pr?.pct_retencion) || 0,
        observaciones: "Generado automáticamente desde el tarifario (programa)",
      });
    } catch {
      // No bloquear la reserva si falla el paso administrativo.
    }
  }

  revalidatePath("/dashboard/contratos");
  return { ok: true, numero };
}
