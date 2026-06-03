"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { precioServicio, noches, liquidarHotelNoches, marcar, componerTarifa, type TemporadaRango } from "@/lib/calc/paquetes";
import { ACOM_ROOMS, ACOM_ROOM_LABEL, PAX_TARIFA_DEFAULT, clasificarPorEdad, validarReservaHabitaciones, type AcomRoom, type AcomConfig } from "@/lib/acomodaciones";
import { parseRuta, ciudadIata } from "@/lib/iata";
import { calcularEdad } from "@/lib/utils";

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

  const [{ data: hsel }, { data: temps }, { data: tarifas }, { data: servSel }] = await Promise.all([
    admin.from("armado_hoteles").select("categorias, regimenes, hoteles(nombre)").eq("paquete_id", paqueteId).eq("hotel_id", hotelId).maybeSingle(),
    admin.from("hotel_temporadas").select("nombre, fecha_inicio, fecha_fin").eq("hotel_id", hotelId),
    admin.from("tarifa_hotel").select("*").eq("hotel_id", hotelId),
    admin.from("armado_servicios").select("incluido, servicios_adicionales(precio_persona)").eq("paquete_id", paqueteId),
  ]);
  const filtroCat = (hsel?.categorias as string[] | null) ?? null;
  const filtroReg = (hsel?.regimenes as string[] | null) ?? null;
  const hotelNombre = (hsel?.hoteles as unknown as { nombre: string } | null)?.nombre ?? null;
  const temporadas: TemporadaRango[] = (temps ?? []).map((t) => ({ nombre: t.nombre, fecha_inicio: t.fecha_inicio, fecha_fin: t.fecha_fin }));

  // Servicios INCLUIDOS se hornean por persona (igual que el generador).
  let aporteServ = 0;
  for (const s of servSel ?? []) {
    if (!(s.incluido as boolean)) continue;
    const srv = s.servicios_adicionales as unknown as { precio_persona: number | null } | null;
    if (srv?.precio_persona == null) continue;
    aporteServ += marcar(Number(srv.precio_persona) || 0, pctMk);
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
      if (costoHotel == null) continue;
      const t = componerTarifa({ aporteHotel: marcar(costoHotel, pctMk), aporteServicios: aporteServ, aporteVuelo: 0, impuesto });
      precios[acom] = t.pvp;
    }
    if (Object.keys(precios).length) combos.push({ categoria, regimen, precios });
  }
  return { combos, destinoNombre, hotelNombre };
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
  if (!res || !res.combos.length) return { ok: false, error: "No hay tarifa para esas fechas (revisa temporadas del hotel)." };
  return { ok: true, combos: res.combos, noches: numNoches };
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
  plazo: string;
  pasajeros: PasajeroReserva[];
  servicios?: number[];   // ids de servicios add-on seleccionados
};

export type ReservaResult = { ok: true; numero: string } | { ok: false; error: string };

export async function reservarDesdeTarifario(input: ReservaInput): Promise<ReservaResult> {
  const sb = await createClient();

  if (!`${input.cliente.nombres ?? ""}${input.cliente.apellidos ?? ""}`.trim()) return { ok: false, error: "El nombre del cliente es obligatorio." };

  const esServicios = input.modulo === "servicios";

  // 1) Precios desde el tarifario (fuente de verdad; el asesor no los cambia)
  const pvpPorAcom: Record<string, number> = {};
  let precioVenta = 0;
  let paxConSilla = 0;
  // Reserva por habitaciones: una línea por tipo de habitación con cantidad de
  // habitaciones, pax que cubren (rooms × pax_tarifa) y PVP por persona.
  const lineasHab: { acom: AcomRoom; habitaciones: number; pax: number; pvp: number }[] = [];
  const numNinos = Math.max(0, Math.trunc(Number(input.ninos) || 0));
  const numNinos2 = Math.max(0, Math.trunc(Number(input.ninos2) || 0));
  let meta: { hotel_nombre: string | null; destino_nombre: string | null; fecha_ida: string | null; fecha_regreso: string | null };

  // Motor por fechas: porción/dinámico con fechas elegidas → re-liquidar en vivo
  // (autoritativo, no se confía en el cliente). Bloqueo usa el tarifario fijo.
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

    // Config de acomodaciones del hotel (defaults si no está configurada).
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
    const habNumF: Record<string, number> = {};
    for (const a of ACOM_ROOMS) { const n = Math.max(0, Math.trunc(Number(input.habitaciones?.[a]) || 0)); if (n > 0) habNumF[a] = n; }
    const valF = validarReservaHabitaciones({
      habitaciones: habNumF, reglas: reglasF, ninosDeclarados: numNinos + numNinos2,
      infantesDeclarados: Math.max(0, Math.trunc(Number(input.infantes) || 0)),
      paxMinHotel: hotelRowF?.pax_min ?? null, paxMaxHotel: hotelRowF?.pax_max ?? null, real: realF,
    });
    if (valF.errores.length) return { ok: false, error: valF.errores.join(" ") };
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

    // Config de acomodaciones del hotel (defaults si no está configurada).
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

    // Validación pasajeros ↔ acomodación (punto 4): edades reales vs declaradas.
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

  // 2b) Servicios (en tipo servicios es el total; en hotel son add-ons).
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
  const asesorNombre =
    input.tipoAsesor === "agencia" ? input.agenciaAsesor :
    input.tipoAsesor === "freelance" ? input.freelanceNombre :
    input.asesorInterno;

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
    plan_nombre: `${input.categoria} · ${input.regimen}`,
  });
  if (ve) return { ok: false, error: ve.message };

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
    await sb.from("contrato_hoteles").insert({
      numero_contrato: numero,
      nombre: meta.hotel_nombre ?? "",
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
      .select("aerolinea, ruta, fecha_ida")
      .eq("id", input.bloqueoId)
      .maybeSingle();
    if (bq) {
      // Origen/Destino desde la ruta ("MDE - CTG - MDE" → origen MDE, destino CTG).
      const r = parseRuta(bq.ruta);
      await sb.from("contrato_vuelos").insert({
        numero_contrato: numero,
        aerolinea: bq.aerolinea,
        origen_codigo: r.origen,
        origen_ciudad: ciudadIata(r.origen),
        destino_codigo: r.destino,
        destino_ciudad: ciudadIata(r.destino),
        servicios: bq.ruta,
        fecha_salida: bq.fecha_ida,
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

  // 9) Sillas + costo aéreo (admin: oculto al asesor). Requiere service-role.
  if (input.modulo === "bloqueo" && input.bloqueoId && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      const { data: bq } = await admin
        .from("bloqueos_vuelo")
        .select("tarifa_para_empaquetar")
        .eq("id", input.bloqueoId)
        .maybeSingle();
      if (bq) {
        await admin.from("ventas").update({ costo_aereo: (Number(bq.tarifa_para_empaquetar) || 0) * paxConSilla }).eq("numero_contrato", numero);
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
        const [{ data: temps }, { data: tarRows }] = await Promise.all([
          admin.from("hotel_temporadas").select("nombre, fecha_inicio, fecha_fin").eq("hotel_id", input.hotelId),
          admin.from("tarifa_hotel")
            .select("temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2")
            .eq("hotel_id", input.hotelId).eq("tipo_habitacion", input.categoria).eq("alimentacion", input.regimen),
        ]);
        type TarRow = {
          temporada: string | null; neto_sencilla: number | null; neto_doble: number | null;
          neto_triple: number | null; neto_multiple: number | null; neto_nino: number | null; neto_nino2: number | null;
        };
        const rows = (tarRows ?? []) as TarRow[];
        const temporadas = (temps ?? []).map((t) => ({ nombre: t.nombre, fecha_inicio: t.fecha_inicio, fecha_fin: t.fecha_fin }));
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
        if (costoHotel > 0) await admin.from("ventas").update({ costo_hotel: costoHotel }).eq("numero_contrato", numero);
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
          .select("servicio_id, modo, servicios_adicionales(precio_persona, categoria, nombre)")
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
      let costoReceptivo = 0;
      const tours: string[] = [];
      let hayAsistencia = false;
      for (const s of arm ?? []) {
        const modo = (s.modo as string) === "grupo" ? "grupo" : "persona";
        const srv = s.servicios_adicionales as unknown as { precio_persona: number | null; categoria: string | null; nombre: string } | null;
        costoReceptivo += precioServicio(modo, srv?.precio_persona ?? null, gruposPorServ.get(s.servicio_id) ?? [], totalPax);
        const cat = srv?.categoria ?? "otro";
        if (cat === "asistencia") hayAsistencia = true;
        else if (cat === "tour_traslado" && srv?.nombre) tours.push(srv.nombre);
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

  revalidatePath("/dashboard/contratos");
  return { ok: true, numero };
}

// ── Confirmar venta: sillas en_plazo -> confirmada ─────────────────────────
export async function confirmarVenta(numeroContrato: string): Promise<{ ok: boolean; error?: string }> {
  const sb = await createClient();
  const { error } = await sb.from("ventas").update({ estado: "confirmado" }).eq("numero_contrato", numeroContrato);
  if (error) return { ok: false, error: error.message };
  // Sillas a confirmada (admin si hay service-role; si no, intento directo)
  const client = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : sb;
  await client.from("sillas").update({ estado: "confirmada" }).eq("numero_contrato", numeroContrato).eq("estado", "en_plazo");
  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  revalidatePath("/dashboard/contratos");
  return { ok: true };
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
