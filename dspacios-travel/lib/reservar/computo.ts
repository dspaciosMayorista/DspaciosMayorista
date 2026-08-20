// ─────────────────────────────────────────────────────────────────────────
// Cálculo de una reserva (SIN efectos): precios, líneas, pax, impuesto.
// Extraído de app/(dashboard)/dashboard/reservar/actions.ts (paso 2 de la
// separación de ese archivo). Bloque de solo-lectura compartido por
// reservarDesdeTarifario (que luego inserta contrato/sillas/CxP) y por
// crearCotizacion (que solo guarda el snapshot). Tener una única fuente del
// precio evita que cotización y contrato diverjan.
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  precioServicio,
  noches,
  liquidarHotelNoches,
  temporadaVigenteParaFecha,
  toTemporadaRango,
  marcar,
  type TemporadaRango,
} from "@/lib/calc/paquetes";
import {
  ACOM_ROOMS,
  PAX_TARIFA_DEFAULT,
  clasificarPorEdad,
  validarReservaHabitaciones,
  type AcomRoom,
  type AcomConfig,
} from "@/lib/acomodaciones";
import { calcularEdad } from "@/lib/utils";
import { liquidarHotelPaquete } from "@/lib/reservar/cotizar";
import { resolverOrigenVuelo, empaquetadoVigente, hoyBogota, type OrigenVuelo } from "@/lib/reservar/origen";

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
  empaquetadoId?: number | null;  // vuelo de SISTEMA (tabla empaquetados, migración 156) — mutuamente excluyente con bloqueoId
  salidaId?: number | null;   // salida dinámica (modulo 'dinamico')
  modulo: "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";
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
  mascotas?: number;                      // cantidad de mascotas (pet friendly)
  cliente: { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; telefono: string; email: string };
  tipoAsesor: "interno" | "agencia" | "freelance";
  asesorInterno: string;
  agenciaNombre: string;
  agenciaAsesor: string;
  freelanceNombre: string;
  aliadoId?: number | null;   // id del catálogo de agencias/freelance (B2B)
  modoCompra?: "neta" | "comisionable";  // B2B: cómo compra el aliado
  plazo: string;
  pasajeros: PasajeroReserva[];
  servicios?: number[];   // ids de servicios add-on seleccionados
};

export type ComputoReserva = {
  origen: OrigenVuelo;
  meta: { hotel_nombre: string | null; destino_nombre: string | null; fecha_ida: string | null; fecha_regreso: string | null };
  pvpPorAcom: Record<string, number>;
  netoPorAcom: Record<string, number>; // costo neto/persona por acomodación (autoritativo)
  precioVenta: number;
  paxConSilla: number;
  totalPax: number;
  numNinos: number;
  numNinos2: number;
  lineasHab: { acom: AcomRoom; habitaciones: number; pax: number; pvp: number }[];
  serviciosItems: { nombre: string; precio: number }[];
  impuestoTotal: number;
  monedaReserva: string;
  notaNino: string | null;     // anotación informativa (ej. "debe pagar seguro hotelero obligatorio")
  cargoMascota: { total: number; descripcion: string | null } | null; // cargo de mascota (0 = gratis), ya incluido en precioVenta
  notaMascota: string | null;  // anotación informativa (ej. "máximo 1 mascota por habitación")
};

export async function computarReserva(
  sb: Awaited<ReturnType<typeof createClient>>,
  input: ReservaInput
): Promise<{ ok: true; data: ComputoReserva } | { ok: false; error: string }> {
  // Origen del vuelo — discriminante único y validado ANTES de cualquier
  // consulta. `computarReserva` es el primer paso, compartido, de TODO flujo
  // de reserva/cotización (`crearCotizacion`, `reservarDesdeTarifarioInterno`
  // vía `convertirCotizacion`) — un origen ambiguo o inválido nunca llega a
  // generar precio, contrato_vuelos, sillas ni CxP (ver `lib/reservar/origen.ts`).
  const resOrigen = resolverOrigenVuelo(input);
  if (!resOrigen.ok) return { ok: false, error: resOrigen.error };
  const origen = resOrigen.origen;

  // Vigencia y activo del Empaquetado — revalidados en el momento exacto de
  // resolver la reserva (no solo al generar el tarifario): un empaquetado
  // puede desactivarse o vencer DESPUÉS de que el tarifario ya quedó
  // publicado, y `tarifario_resultado` es una caché, no la fuente de verdad.
  if (origen.tipo === "empaquetado") {
    const { data: eq, error: eqErr } = await sb
      .from("empaquetados")
      .select("activo, compra_inicio, compra_fin")
      .eq("id", origen.id)
      .maybeSingle();
    if (eqErr) return { ok: false, error: `No se pudo validar el empaquetado: ${eqErr.message}` };
    if (!eq) return { ok: false, error: "El empaquetado seleccionado ya no existe." };
    if (!eq.activo) return { ok: false, error: "Este empaquetado fue desactivado y ya no se puede reservar." };
    if (!empaquetadoVigente(eq.compra_inicio, eq.compra_fin, hoyBogota(new Date())))
      return { ok: false, error: "Este empaquetado está fuera de su vigencia de compra." };
  }

  const esServicios = input.modulo === "servicios";

  const pvpPorAcom: Record<string, number> = {};
  const netoPorAcom: Record<string, number> = {};
  let precioVenta = 0;
  let paxConSilla = 0;
  const lineasHab: { acom: AcomRoom; habitaciones: number; pax: number; pvp: number }[] = [];
  const numNinos = Math.max(0, Math.trunc(Number(input.ninos) || 0));
  const numNinos2 = Math.max(0, Math.trunc(Number(input.ninos2) || 0));
  const numInfantes = Math.max(0, Math.trunc(Number(input.infantes) || 0));
  const numMascotas = Math.max(0, Math.trunc(Number(input.mascotas) || 0));
  let meta: { hotel_nombre: string | null; destino_nombre: string | null; fecha_ida: string | null; fecha_regreso: string | null };
  let monedaReserva = "COP";  // moneda del paquete (USD si los hoteles son internacionales)
  // Nota especial de niño del hotel — se lee junto con el resto de datos del
  // hotel en cada rama. La tarifa/nota de INFANTE ya no vive aquí: vive en
  // tarifa_hotel (neto_infante/nota_infante), igual que niño 1/niño 2 — ver
  // el manejo de pvpPorAcom["infante"] más abajo.
  let ninoNotaTxt: string | null = null;
  let petCostoNeto = 0;
  let petCostoDesc: string | null = null;
  let petNotaTxt: string | null = null;

  const usarFechas =
    input.modulo !== "bloqueo" && input.modulo !== "dinamico" && !!input.fechaIda && !!input.fechaRegreso && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Adults Only: el hotel no acepta niños ni infantes bajo ninguna circunstancia.
  // Pet friendly: el hotel debe aceptar mascotas para poder declararlas.
  if (!esServicios && (numNinos > 0 || numNinos2 > 0 || numInfantes > 0 || numMascotas > 0)) {
    const { data: hotelFlags } = await sb.from("hoteles").select("adults_only, pet_friendly").eq("id", input.hotelId).maybeSingle();
    if ((numNinos > 0 || numNinos2 > 0 || numInfantes > 0) && hotelFlags?.adults_only)
      return { ok: false, error: "Este hotel es Adults Only: no acepta niños ni infantes." };
    if (numMascotas > 0 && !hotelFlags?.pet_friendly)
      return { ok: false, error: "Este hotel no acepta mascotas." };
  }

  // % de markup del paquete: el cargo de infante se configura a nivel NETO y
  // lleva el mismo margen que el resto de costos del hotel/servicios.
  let pctMk = 0;
  if (!esServicios) {
    const { data: pqMk } = await sb.from("armado_paquetes").select("pct_mk").eq("id", input.paqueteId).maybeSingle();
    pctMk = Number(pqMk?.pct_mk) || 0;
  }

  if (!esServicios && usarFechas) {
    const numNoches = noches(input.fechaIda!, input.fechaRegreso!);
    if (numNoches <= 0) return { ok: false, error: "El regreso debe ser posterior a la ida." };
    const admin = createAdminClient();
    const res = await liquidarHotelPaquete(admin, input.paqueteId, input.hotelId, input.fechaIda!, numNoches);
    const combo = res?.combos.find((c) => c.categoria === input.categoria && c.regimen === input.regimen);
    if (!combo) return { ok: false, error: "No hay tarifa para esas fechas / categoría / régimen." };
    for (const [acom, p] of Object.entries(combo.precios)) pvpPorAcom[acom] = p;
    if (combo.netos) for (const [acom, n] of Object.entries(combo.netos)) netoPorAcom[acom] = n;
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
    // Infante: igual que niño (0 = gratis), pero no ocupa silla/habitación.
    // Si el hotel no configuró tarifa de infante para este combo, pvpPorAcom["infante"]
    // simplemente no existe → gratis, sin bloquear la reserva (a diferencia de niño).
    if (numInfantes > 0 && pvpPorAcom["infante"] != null) { precioVenta += numInfantes * pvpPorAcom["infante"]; }
    if (paxConSilla <= 0) return { ok: false, error: "Indica al menos una habitación (cantidad por tipo)." };

    const { data: hotelRowF } = await sb
      .from("hoteles").select("edad_infante_max, edad_nino_max, pax_min, pax_max, moneda, nino_nota, pet_costo_neto, pet_costo_desc, pet_nota").eq("id", input.hotelId).maybeSingle();
    monedaReserva = ((hotelRowF as { moneda?: string | null } | null)?.moneda) ?? "COP";
    ninoNotaTxt = hotelRowF?.nino_nota ?? null;
    petCostoNeto = Number(hotelRowF?.pet_costo_neto) || 0;
    petCostoDesc = hotelRowF?.pet_costo_desc ?? null;
    petNotaTxt = hotelRowF?.pet_nota ?? null;
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
      .select("acomodacion, precio_pvp, hotel_nombre, destino_nombre, fecha_ida, fecha_regreso, moneda")
      .eq("paquete_id", input.paqueteId)
      .eq("hotel_id", input.hotelId)
      .eq("categoria", input.categoria)
      .eq("regimen", input.regimen);
    // El filtro sale ÚNICAMENTE del origen ya validado y discriminado por
    // `resolverOrigenVuelo` (nunca de los campos crudos `input.bloqueoId`/
    // `empaquetadoId`/`salidaId` por separado) — así la fila de tarifario
    // que se usa para el precio es exactamente la que pertenece al origen
    // resuelto, para este paquete/hotel/categoría/régimen, o no hay fila.
    if (origen.tipo === "salida") q = q.eq("salida_id", origen.id);
    else if (origen.tipo === "empaquetado") q = q.eq("empaquetado_id", origen.id);
    else if (origen.tipo === "bloqueo") q = q.eq("bloqueo_id", origen.id);
    else q = q.is("bloqueo_id", null).is("empaquetado_id", null).is("salida_id", null);
    const { data: filas, error: fe } = await q;
    if (fe) return { ok: false, error: fe.message };
    if (!filas || !filas.length) return { ok: false, error: "No se encontró la tarifa seleccionada en el tarifario." };
    for (const f of filas) if (f.acomodacion) pvpPorAcom[f.acomodacion] = f.precio_pvp;
    meta = filas[0];
    monedaReserva = (filas[0] as { moneda?: string | null }).moneda ?? "COP";

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
    if (numInfantes > 0 && pvpPorAcom["infante"] != null) { precioVenta += numInfantes * pvpPorAcom["infante"]; }

    if (paxConSilla <= 0) return { ok: false, error: "Indica al menos una habitación (cantidad por tipo)." };

    // Costo neto del hotel + control de VIGENCIA DE COMPRA. El PVP del tarifario
    // está congelado, pero la tarifa neta se liquida con la vigencia de HOY: si
    // la vigencia de compra del hotel ya venció (o ya no hay tarifa), NO se vende
    // —antes se creaba la venta con costo 0 (rentabilidad inflada y sin CxP de
    // hotel). Decisión del negocio: no dejar vender lo vencido. (Bloqueo: fechas
    // fijas del record.) Requiere service-role: la tarifa neta es interna.
    if (process.env.SUPABASE_SERVICE_ROLE_KEY && meta.fecha_ida && meta.fecha_regreso) {
      const admin = createAdminClient();
      const numNoches = noches(meta.fecha_ida, meta.fecha_regreso);
      const [{ data: temps }, { data: tarRows }] = await Promise.all([
        admin.from("hotel_temporadas").select("nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts, min_noches, regimen_restringido").eq("hotel_id", input.hotelId),
        admin.from("tarifa_hotel").select("temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante").eq("hotel_id", input.hotelId).eq("tipo_habitacion", input.categoria).eq("alimentacion", input.regimen),
      ]);
      type TarRow = { temporada: string | null; neto_sencilla: number | null; neto_doble: number | null; neto_triple: number | null; neto_multiple: number | null; neto_nino: number | null; neto_nino2: number | null; neto_infante: number | null };
      const rows = (tarRows ?? []) as TarRow[];
      const temporadas = (temps ?? []).map(toTemporadaRango);
      const colDe: Record<string, keyof TarRow> = { sencilla: "neto_sencilla", doble: "neto_doble", triple: "neto_triple", multiple: "neto_multiple", nino: "neto_nino", nino2: "neto_nino2", infante: "neto_infante" };
      const netoDe = (acom: string): number | null => {
        const col = colDe[acom]; if (!col) return null;
        const netoPorTemporada: Record<string, number | null> = {};
        for (const r of rows) if (r.temporada) netoPorTemporada[r.temporada] = r[col] as number | null;
        return liquidarHotelNoches({ fechaIda: meta.fecha_ida!, numNoches, temporadas, netoPorTemporada, regimen: input.regimen });
      };
      const TARIFA_VENCIDA = "Esta tarifa ya no está vigente para compra (la vigencia del hotel venció). Pide regenerar el tarifario con vigencias vigentes antes de reservar.";
      for (const l of lineasHab) {
        const per = netoDe(l.acom);
        if (per == null) return { ok: false, error: TARIFA_VENCIDA };
        netoPorAcom[l.acom] = per;
      }
      if (numNinos > 0) { const per = netoDe("nino"); if (per == null) return { ok: false, error: TARIFA_VENCIDA }; netoPorAcom["nino"] = per; }
      if (numNinos2 > 0) { const per = netoDe("nino2"); if (per == null) return { ok: false, error: TARIFA_VENCIDA }; netoPorAcom["nino2"] = per; }
      // Infante: a diferencia de niño, si no está configurado NO bloquea la
      // reserva (queda gratis) — evita romper reservas de hoteles que todavía
      // no han cargado su tarifa de infante en tarifa_hotel.
      if (numInfantes > 0) { netoPorAcom["infante"] = netoDe("infante") ?? 0; }
    }

    const { data: hotelRow } = await sb
      .from("hoteles")
      .select("edad_infante_max, edad_nino_max, pax_min, pax_max, nino_nota, pet_costo_neto, pet_costo_desc, pet_nota")
      .eq("id", input.hotelId)
      .maybeSingle();
    ninoNotaTxt = hotelRow?.nino_nota ?? null;
    petCostoNeto = Number(hotelRow?.pet_costo_neto) || 0;
    petCostoDesc = hotelRow?.pet_costo_desc ?? null;
    petNotaTxt = hotelRow?.pet_nota ?? null;
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

  // Cargo de mascota (pet friendly), igual mecánica que el de infante: costo
  // neto configurado por hotel × noches × mascotas, con el mismo markup del
  // paquete. 0 = gratis (no genera ítem, pero la reserva con mascota sí queda permitida).
  let cargoMascota: { total: number; descripcion: string | null } | null = null;
  if (!esServicios && numMascotas > 0 && petCostoNeto > 0 && meta.fecha_ida && meta.fecha_regreso) {
    const nochesMascota = noches(meta.fecha_ida, meta.fecha_regreso) || 1;
    const totalMascota = Math.round(numMascotas * nochesMascota * marcar(petCostoNeto, pctMk));
    if (totalMascota > 0) {
      precioVenta += totalMascota;
      cargoMascota = { total: totalMascota, descripcion: petCostoDesc };
    }
  }

  // Servicios (en tipo servicios es el total; en hotel son add-ons).
  const totalPax = esServicios ? (Number(input.paxServicios) || 0) : paxConSilla + (Number(input.infantes) || 0);
  const serviciosItems: { nombre: string; precio: number }[] = [];
  if (input.servicios?.length) {
    const { data: srvRows } = await sb
      .from("tarifario_resultado")
      .select("servicio_id, servicio_nombre, tipo_tarifa, pax_desde, pax_hasta, precio_pvp, recargo_individual")
      .eq("paquete_id", input.paqueteId)
      .eq("modulo", "servicios")
      .in("servicio_id", input.servicios);
    const byServ = new Map<number, { nombre: string; modo: "persona" | "grupo"; personaPvp: number | null; recargoIndividual: number; grupos: { pax_desde: number; pax_hasta: number; precio: number }[] }>();
    for (const r of srvRows ?? []) {
      if (r.servicio_id == null) continue;
      let s = byServ.get(r.servicio_id);
      if (!s) {
        s = { nombre: r.servicio_nombre ?? "Servicio", modo: r.tipo_tarifa === "grupo" ? "grupo" : "persona", personaPvp: null, recargoIndividual: 0, grupos: [] };
        byServ.set(r.servicio_id, s);
      }
      if (s.modo === "grupo") s.grupos.push({ pax_desde: r.pax_desde ?? 1, pax_hasta: r.pax_hasta ?? 1, precio: r.precio_pvp });
      else { s.personaPvp = r.precio_pvp; s.recargoIndividual = Math.max(Number(r.recargo_individual) || 0, 0); }
    }

    // Tarifa por TEMPORADA del servicio: si la fecha del viaje cae en una temporada
    // vigente, se escala el PVP del snapshot por la razón neto_temporada/neto_general
    // (conserva markup, liquidación y redondeo del GENERAL proporcionalmente). Una
    // temporada es una tarifa COMPLETA: persona + recargo individual + rangos por grupo.
    const fechaViaje = meta.fecha_ida;
    if (fechaViaje && byServ.size) {
      const ids = [...byServ.keys()];
      const [{ data: baseSrv }, { data: temps }, { data: tarifaPax }] = await Promise.all([
        sb.from("servicios_adicionales").select("id, precio_persona").in("id", ids),
        sb.from("servicio_temporadas").select("servicio_id, nombre, fecha_inicio, fecha_fin, compra_inicio, compra_fin, prioridad, precio_persona, recargo_individual").in("servicio_id", ids),
        sb.from("servicio_tarifa_pax").select("servicio_id, pax_desde, pax_hasta, precio, temporada").in("servicio_id", ids),
      ]);
      const netoGen = new Map((baseSrv ?? []).map((b) => [b.id, Number(b.precio_persona) || 0]));
      const tempsByServ = new Map<number, TemporadaRango[]>();
      const netoTemp = new Map<string, number>();   // servId|nombre -> neto persona
      const recTemp = new Map<string, number>();    // servId|nombre -> recargo neto
      for (const t of temps ?? []) {
        const arr = tempsByServ.get(t.servicio_id) ?? [];
        arr.push(toTemporadaRango(t));
        tempsByServ.set(t.servicio_id, arr);
        if (t.precio_persona != null) netoTemp.set(`${t.servicio_id}|${t.nombre}`, Number(t.precio_persona));
        if (t.recargo_individual != null) recTemp.set(`${t.servicio_id}|${t.nombre}`, Number(t.recargo_individual));
      }
      // Netos por GRUPO por temporada (incl. GENERAL): para rescatar por rango de pax.
      const grpRanges = new Map<string, { d: number; h: number; p: number }[]>();
      for (const g of tarifaPax ?? []) {
        const k = `${g.servicio_id}|${g.temporada ?? "GENERAL"}`;
        const list = grpRanges.get(k) ?? [];
        list.push({ d: g.pax_desde, h: g.pax_hasta, p: Number(g.precio) || 0 });
        grpRanges.set(k, list);
      }
      const netoGrupo = (servId: number, temp: string, pax: number): number | undefined =>
        grpRanges.get(`${servId}|${temp}`)?.find((x) => pax >= x.d && pax <= x.h)?.p;

      const d = new Date(`${fechaViaje}T00:00:00`);
      for (const [id, s] of byServ) {
        const tt = tempsByServ.get(id);
        if (!tt?.length) continue;
        const nombre = temporadaVigenteParaFecha(d, tt);
        if (!nombre) continue;
        if (s.modo === "persona" && s.personaPvp != null) {
          const ng = netoGen.get(id) || 0;
          const mkf = ng > 0 ? s.personaPvp / ng : null;   // factor de markup del snapshot
          const nt = netoTemp.get(`${id}|${nombre}`);
          if (nt != null && ng > 0) s.personaPvp = Math.round(s.personaPvp * (nt / ng));
          const rt = recTemp.get(`${id}|${nombre}`);        // recargo NETO de la temporada
          if (rt != null && mkf != null) s.recargoIndividual = Math.round(rt * mkf);
        } else if (s.modo === "grupo") {
          for (const g of s.grupos) {
            const ngG = netoGrupo(id, "GENERAL", g.pax_desde) ?? netoGrupo(id, "GENERAL", g.pax_hasta);
            const ntG = netoGrupo(id, nombre, g.pax_desde) ?? netoGrupo(id, nombre, g.pax_hasta);
            if (ntG != null && ngG != null && ngG > 0) g.precio = Math.round(g.precio * (ntG / ngG));
          }
        }
      }
    }

    for (const s of byServ.values()) {
      let p = precioServicio(s.modo, s.personaPvp, s.grupos, totalPax);
      // Recargo individual: si el servicio va a 1 solo pax (cobro por persona),
      // se suma el suplemento a la tarifa.
      if (s.modo === "persona" && totalPax === 1 && s.recargoIndividual > 0) p += s.recargoIndividual;
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
    data: { origen, meta, pvpPorAcom, netoPorAcom, precioVenta, paxConSilla, totalPax, numNinos, numNinos2, lineasHab, serviciosItems, impuestoTotal, monedaReserva, notaNino: ninoNotaTxt, cargoMascota, notaMascota: petNotaTxt },
  };
}
