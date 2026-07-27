"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { precioServicio, noches, temporadaVigenteParaFecha, toTemporadaRango, factorLiquidacion, type TemporadaRango } from "@/lib/calc/paquetes";
import { ACOM_ROOM_LABEL, paxDeAcomodacion, clasificarPorEdad, type AcomRoom } from "@/lib/acomodaciones";
import { parseRuta, ciudadIata } from "@/lib/iata";
import { calcularEdad } from "@/lib/utils";
import { pvpPrograma } from "@/lib/programas";
import { postearAsientoCxP } from "@/lib/contabilidad/asientos";
import type { Json } from "@/types/database";
import {
  cotizarPorFechas as cotizarPorFechasImpl,
  buscarHoteles as buscarHotelesImpl,
  type CotizarResult,
  type BusquedaInput,
  type BusquedaResultado,
} from "@/lib/reservar/cotizar";
import {
  computarReserva,
  type ReservaInput,
  type PasajeroReserva,
} from "@/lib/reservar/computo";

const oNull = (s: string | null | undefined) => (s && s.trim() !== "" ? s.trim() : null);

/** Cotiza un hotel para las fechas que elige el asesor (porción/dinámico). */
export async function cotizarPorFechas(input: {
  paqueteId: number; hotelId: number; fechaIda: string; fechaRegreso: string;
}): Promise<CotizarResult> {
  return cotizarPorFechasImpl(input);
}

export async function buscarHoteles(input: BusquedaInput): Promise<{ ok: true; resultados: BusquedaResultado[] } | { ok: false; error: string }> {
  return buscarHotelesImpl(input);
}

export type ReservaResult = { ok: true; numero: string } | { ok: false; error: string };

export async function reservarDesdeTarifario(input: ReservaInput): Promise<ReservaResult> {
  const sb = await createClient();

  if (!`${input.cliente.nombres ?? ""}${input.cliente.apellidos ?? ""}`.trim()) return { ok: false, error: "El nombre del cliente es obligatorio." };

  const esServicios = input.modulo === "servicios";

  // 1) Cálculo (precios, líneas, pax, impuesto) — fuente única compartida.
  const comp = await computarReserva(sb, input);
  if (!comp.ok) return { ok: false, error: comp.error };
  const { meta, pvpPorAcom, netoPorAcom, precioVenta, paxConSilla, totalPax, numNinos, numNinos2, lineasHab, serviciosItems, impuestoTotal, monedaReserva, cargoMascota } = comp.data;

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

  // 4-bis) Modo de compra B2B (neta vs comisionable).
  //   base comisionable = PVP − impuesto (BNC) · comisión = base × % del aliado.
  //   · neta         → el aliado paga PVP − comisión (se descuenta).
  //   · comisionable → paga el PVP; la comisión se liquida aparte.
  let precioFinal = precioVenta;
  let baseComisB2B = 0;
  let pctComB2B = 0;
  let comisionB2B: number | null = null;
  let modoCompra: string | null = null;
  let comisionEstado: string | null = null;
  let b2bUsuarioId: string | null = null;
  if (input.tipoAsesor !== "interno" && input.modoCompra) {
    baseComisB2B = Math.max(0, precioVenta - impuestoTotal);
    let pct: number | null = null;
    if (input.aliadoId) {
      const { data: al } = await sb.from("aliados").select("pct_comision").eq("id", input.aliadoId).maybeSingle();
      pct = al?.pct_comision ?? null;
    }
    if (pct == null) {
      const defParam = input.tipoAsesor === "agencia" ? "COMISION_AGENCIA" : "COMISION_FREELANCE";
      const { data: p } = await sb.from("parametros_tributarios").select("valor").eq("parametro", defParam).maybeSingle();
      pct = Number(p?.valor) || (input.tipoAsesor === "agencia" ? 0.12 : 0.11);
    }
    pctComB2B = pct;
    const comision = Math.round(baseComisB2B * pct);
    modoCompra = input.modoCompra;
    comisionB2B = comision;
    if (modoCompra === "neta") { precioFinal = Math.max(0, precioVenta - comision); comisionEstado = "descontada"; }
    else { comisionEstado = "pendiente"; }
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).maybeSingle();
      if (perfil?.rol === "agencia" || perfil?.rol === "freelance") b2bUsuarioId = user.id;
    }
  }

  // 4) Venta (cabecera) — nace PENDIENTE
  const { error: ve } = await sb.from("ventas").insert({
    numero_contrato: numero,
    cliente: `${input.cliente.nombres ?? ""} ${input.cliente.apellidos ?? ""}`.trim(),
    cliente_documento: oNull(input.cliente.numeroDoc),
    cliente_telefono: oNull(input.cliente.telefono),
    cliente_email: oNull(input.cliente.email),
    destino: meta.destino_nombre,
    tipo_paquete: input.modulo,
    moneda: monedaReserva,
    fecha_salida: meta.fecha_ida,
    fecha_regreso: meta.fecha_regreso,
    pax: totalPax || paxConSilla,
    hotel: esServicios ? null : meta.hotel_nombre,
    precio_venta: precioFinal,
    impuesto: impuestoTotal,
    estado: "pendiente",
    canal,
    tipo_asesor: input.tipoAsesor,
    modo_compra: modoCompra,
    comision_b2b: comisionB2B,
    comision_estado: comisionEstado,
    b2b_usuario_id: b2bUsuarioId,
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
      const pct = pctComB2B || al.pct_comision || Number(p?.valor) || (input.tipoAsesor === "agencia" ? 0.12 : 0.11);
      await sb.from("aliados_b2b").insert({
        numero_contrato: numero,
        aliado: al.nombre,
        nit: al.nit,
        precio_venta: precioVenta,
        base_comision: baseComisB2B || precioVenta,
        pct_comision: pct,
        recobro_total: 0,
        pct_recobro_aliado: 0,
        aplica_retencion: al.aplica_retencion,
        pct_retencion: al.pct_retencion,
        estado: comisionEstado === "descontada" ? "pagada" : "pendiente",
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
    if ((Number(input.mascotas) || 0) > 0) partes.push(`${Number(input.mascotas)} Mascota(s)`);
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
  // Infante: mismo tratamiento que Niño 1/2 (tarifa por temporada, 0 = gratis
  // sí se itemiza). Si el hotel no configuró tarifa de infante, pvpPorAcom["infante"]
  // no existe y simplemente no se cobra (no bloquea la reserva).
  const numInfantesItem = Number(input.infantes) || 0;
  if (numInfantesItem > 0 && pvpPorAcom["infante"] != null) {
    items.push({
      numero_contrato: numero,
      descripcion: `Infante · ${input.categoria} / ${input.regimen}`,
      adultos: 0, ninos: numInfantesItem, tarifa_adulto: 0, tarifa_nino: pvpPorAcom["infante"], orden: 52,
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
  // Cargo de mascota (pet friendly), itemizado aparte igual que el de infante.
  if (cargoMascota) {
    items.push({
      numero_contrato: numero,
      descripcion: cargoMascota.descripcion ? `Mascota · ${cargoMascota.descripcion}` : "Cargo de mascota",
      adultos: 0, ninos: 0, tarifa_adulto: cargoMascota.total, tarifa_nino: 0,
      orden: 201,
    });
  }
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
  const pushCxP = (tipo: string, servicio: string, valor: number, pr: ProvFact, nombreFallback?: string | null, opts?: { permitirCero?: boolean }) => {
    if (!(valor > 0) && !opts?.permitirCero) return;
    cxp.push({
      numero_contrato: numero,
      proveedor: pr?.nombre ?? nombreFallback ?? null,
      tipo_proveedor: tipo,
      servicio,
      valor_total: Math.max(0, valor),
      fecha_obligacion: hoyISO,
      aplica_retencion: pr?.aplica_retencion ?? false,
      pct_retencion: Number(pr?.pct_retencion) || 0,
      observaciones: valor > 0 ? OBS_AUTO : `${OBS_AUTO} · costo neto pendiente`,
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

  // 9-bis) Costo aéreo de la SALIDA DINÁMICA (vuelo por sistema, SIN sillas).
  // Adultos (2+) y niños pagan valor_tiquete; infantes pagan fee_infante.
  if (input.modulo === "dinamico" && input.salidaId && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      const { data: sal } = await admin
        .from("salidas_dinamicas")
        .select("valor_tiquete, fee_infante, aerolinea")
        .eq("id", input.salidaId)
        .maybeSingle();
      if (sal) {
        const infs = Math.max(0, Math.trunc(Number(input.infantes) || 0));
        const costoAereo = (Number(sal.valor_tiquete) || 0) * paxConSilla + (Number(sal.fee_infante) || 0) * infs;
        await admin.from("ventas").update({ costo_aereo: costoAereo, aerolinea: sal.aerolinea }).eq("numero_contrato", numero);
        pushCxP("aereo", `Aéreo ${sal.aerolinea ?? ""}`.trim(), costoAereo, null, sal.aerolinea);
      }
    } catch { /* no bloquear */ }
  }

  // 10) Costo neto del HOTEL y su cuenta por pagar. El neto YA se calculó en
  //     computarReserva (netoPorAcom), con la vigencia de compra: si hubiera
  //     vencido, la venta ni siquiera se habría creado (se bloquea allá). Aquí
  //     solo se suma por pax y se crea la CxP con el proveedor del hotel. Una
  //     sola fuente del costo evita la divergencia que generaba costo 0.
  if (!esServicios && Object.keys(netoPorAcom).length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      let costoHotel = 0;
      for (const l of lineasHab) { const per = netoPorAcom[l.acom]; if (per != null) costoHotel += per * l.pax; }
      if (numNinos > 0 && netoPorAcom["nino"] != null) costoHotel += netoPorAcom["nino"] * numNinos;
      if (numNinos2 > 0 && netoPorAcom["nino2"] != null) costoHotel += netoPorAcom["nino2"] * numNinos2;
      const { data: hprov } = await admin
        .from("hoteles").select("nombre, proveedores(nombre, aplica_retencion, pct_retencion)").eq("id", input.hotelId).maybeSingle();
      if (costoHotel > 0) {
        await admin.from("ventas").update({ costo_hotel: costoHotel }).eq("numero_contrato", numero);
        const prH = hprov?.proveedores as unknown as ProvFact;
        pushCxP("hotel", `Hotel ${meta.hotel_nombre ?? hprov?.nombre ?? ""}`.trim(), costoHotel, prH);
      }
    } catch {
      // El costo neto es informativo para rentabilidad; no bloquea la reserva.
    }
  }

  // 11) Costo neto de SERVICIOS (receptivo) — admin, oculto al asesor.
  if (input.servicios?.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      const [{ data: arm }, { data: gruposNet }, { data: tempsNet }] = await Promise.all([
        admin.from("armado_servicios")
          .select("servicio_id, modo, servicios_adicionales(precio_persona, recargo_individual, categoria, nombre, liquidacion, proveedores(nombre, aplica_retencion, pct_retencion))")
          .eq("paquete_id", input.paqueteId).in("servicio_id", input.servicios),
        admin.from("servicio_tarifa_pax")
          .select("servicio_id, pax_desde, pax_hasta, precio, temporada").in("servicio_id", input.servicios),
        admin.from("servicio_temporadas")
          .select("servicio_id, nombre, fecha_inicio, fecha_fin, compra_inicio, compra_fin, prioridad, precio_persona, recargo_individual").in("servicio_id", input.servicios),
      ]);
      // Rangos por grupo (NETO) por servicio y temporada (incl. GENERAL).
      const gruposPorServ = new Map<string, { pax_desde: number; pax_hasta: number; precio: number }[]>();
      for (const g of gruposNet ?? []) {
        const k = `${g.servicio_id}|${g.temporada ?? "GENERAL"}`;
        const arr = gruposPorServ.get(k) ?? [];
        arr.push({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: g.precio });
        gruposPorServ.set(k, arr);
      }
      // Temporadas por servicio: el NETO del costo cambia según la fecha del viaje.
      const tempsPorServ = new Map<number, TemporadaRango[]>();
      const netoTempServ = new Map<string, number>();   // servId|nombre -> neto persona
      const recTempServ = new Map<string, number>();    // servId|nombre -> recargo neto
      for (const t of tempsNet ?? []) {
        const arr = tempsPorServ.get(t.servicio_id) ?? [];
        arr.push(toTemporadaRango(t));
        tempsPorServ.set(t.servicio_id, arr);
        if (t.precio_persona != null) netoTempServ.set(`${t.servicio_id}|${t.nombre}`, Number(t.precio_persona));
        if (t.recargo_individual != null) recTempServ.set(`${t.servicio_id}|${t.nombre}`, Number(t.recargo_individual));
      }
      const fechaViajeCosto = meta.fecha_ida ? new Date(`${meta.fecha_ida}T00:00:00`) : null;
      // Temporada vigente del servicio para la fecha del viaje (o null = GENERAL).
      const tempVigente = (servId: number): string | null => {
        if (!fechaViajeCosto) return null;
        const tt = tempsPorServ.get(servId);
        if (!tt?.length) return null;
        return temporadaVigenteParaFecha(fechaViajeCosto, tt);
      };
      const nochesStay = meta.fecha_ida && meta.fecha_regreso ? noches(meta.fecha_ida, meta.fecha_regreso) : 1;
      let costoReceptivo = 0;
      const tours: string[] = [];
      let hayAsistencia = false;
      for (const s of arm ?? []) {
        const modo = (s.modo as string) === "grupo" ? "grupo" : "persona";
        const srv = s.servicios_adicionales as unknown as { precio_persona: number | null; recargo_individual: number | null; categoria: string | null; nombre: string; liquidacion: string | null; proveedores: ProvFact } | null;
        const nombreTemp = tempVigente(s.servicio_id);
        // Neto por persona: el de la temporada vigente, o el base.
        const netoPersona = (nombreTemp ? netoTempServ.get(`${s.servicio_id}|${nombreTemp}`) : undefined) ?? srv?.precio_persona ?? null;
        // Rangos por grupo: los de la temporada vigente si existen, si no GENERAL.
        const gruposTemp = nombreTemp ? gruposPorServ.get(`${s.servicio_id}|${nombreTemp}`) : undefined;
        const grupos = gruposTemp?.length ? gruposTemp : (gruposPorServ.get(`${s.servicio_id}|GENERAL`) ?? []);
        let costoServ = precioServicio(modo, netoPersona, grupos, totalPax) * factorLiquidacion(srv?.liquidacion, nochesStay);
        // Recargo individual: suplemento NETO del proveedor cuando va 1 pax (cobro
        // por persona). El de la temporada vigente si lo define, si no el base.
        if (modo === "persona" && totalPax === 1) {
          const recTemp = nombreTemp ? recTempServ.get(`${s.servicio_id}|${nombreTemp}`) : undefined;
          costoServ += Math.max(recTemp ?? (Number(srv?.recargo_individual) || 0), 0);
        }
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
      const { data: creadas } = await admin.from("cuentas_por_pagar").insert(cxp).select("id, tipo_proveedor, proveedor, servicio, valor_total");
      for (const c of creadas ?? []) {
        await postearAsientoCxP({
          cuentaId: c.id, numeroContrato: numero, tipoProveedor: c.tipo_proveedor, proveedor: c.proveedor,
          servicio: c.servicio, valorTotal: Number(c.valor_total) || 0, fecha: hoyISO,
        });
      }
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
  const { meta, pvpPorAcom, precioVenta, paxConSilla, totalPax, numNinos, numNinos2, lineasHab, serviciosItems, monedaReserva, cargoMascota } = comp.data;

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
    moneda: monedaReserva,
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
    if ((Number(input.mascotas) || 0) > 0) partes.push(`${Number(input.mascotas)} Mascota(s)`);
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
  } else if (input.modulo === "dinamico" && input.salidaId) {
    const { data: sal } = await sb
      .from("salidas_dinamicas")
      .select("aerolinea, ruta, fecha_ida, fecha_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg")
      .eq("id", input.salidaId).maybeSingle();
    if (sal) {
      const r = parseRuta(sal.ruta);
      vuelosSnap.push({
        id: 1, aerolinea: sal.aerolinea, record: null,
        origen_codigo: r.origen, origen_ciudad: ciudadIata(r.origen),
        destino_codigo: r.destino, destino_ciudad: ciudadIata(r.destino),
        vuelo_ida: null, vuelo_regreso: null,
        hora_salida_ida: sal.hora_salida_ida, hora_llegada_ida: sal.hora_llegada_ida,
        hora_salida_reg: sal.hora_salida_reg, hora_llegada_reg: sal.hora_llegada_reg,
        servicios: sal.ruta, fecha_salida: sal.fecha_ida, fecha_regreso: sal.fecha_regreso,
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
  { const numInfantesSnap = Number(input.infantes) || 0;
    if (numInfantesSnap > 0 && pvpPorAcom["infante"] != null)
      itemsSnap.push({ id: 52, descripcion: `Infante · ${input.categoria} / ${input.regimen}`, adultos: 0, ninos: numInfantesSnap, tarifa_adulto: 0, tarifa_nino: pvpPorAcom["infante"] }); }
  serviciosItems.forEach((s, i) => itemsSnap.push({ id: 100 + i, descripcion: `Servicio · ${s.nombre}`, adultos: 1, ninos: 0, tarifa_adulto: s.precio, tarifa_nino: 0 }));
  if (cargoMascota) {
    itemsSnap.push({
      id: 201,
      descripcion: cargoMascota.descripcion ? `Mascota · ${cargoMascota.descripcion}` : "Cargo de mascota",
      adultos: 0, ninos: 0, tarifa_adulto: cargoMascota.total, tarifa_nino: 0,
    });
  }

  const detalle = { venta: ventaSnap, pasajeros: pasajerosSnap, hoteles: hotelesSnap, vuelos: vuelosSnap, items: itemsSnap };

  // Vigencia: la que indique el asesor o, por defecto, 24 horas (hoy + 1 día).
  let vigencia = opts?.vigenciaHasta && /^\d{4}-\d{2}-\d{2}$/.test(opts.vigenciaHasta) ? opts.vigenciaHasta : null;
  if (!vigencia) { const vig = new Date(); vig.setDate(vig.getDate() + 1); vigencia = vig.toISOString().slice(0, 10); }

  const { data: { user } } = await sb.auth.getUser();

  // El precio se calcula en el servidor (autoritativo) y el checkout debe servir
  // tanto a aliados B2B como a usuarios públicos. La RLS de `cotizaciones` es solo
  // para roles internos, así que el insert va por service-role cuando está
  // disponible (si no, cae al cliente con sesión = sólo internos).
  const sbCot = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : sb;

  const { data: row, error } = await sbCot.from("cotizaciones").insert({
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
    moneda: monedaReserva,
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
// Crea las cuentas por pagar que FALTEN para un contrato a partir de sus costos
// (hotel/aéreo/receptivo/asistencia/otros). NO duplica: solo agrega los tipos de
// proveedor que aún no tengan CxP. Útil cuando al reservar solo se generó parte
// (p. ej. "solo el aéreo" porque el costo neto del hotel salió 0). El proveedor
// del hotel/aéreo se jala del contrato; los demás quedan para que contabilidad
// los asigne. El hotel se crea aunque el costo sea 0 (queda pendiente de valor).
export async function asegurarCuentasPorPagar(numeroContrato: string): Promise<{ ok: boolean; creadas: number; error?: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, creadas: 0 };
  const admin = createAdminClient();

  const [{ data: existentes }, { data: v }, { data: ch }, { data: cv }, { data: provs }] = await Promise.all([
    admin.from("cuentas_por_pagar").select("tipo_proveedor").eq("numero_contrato", numeroContrato),
    admin.from("ventas").select("tenant, costo_hotel, costo_aereo, costo_receptivo, costo_asistencia, otros_costos, moneda, hotel, aerolinea, plazo, fecha_salida").eq("numero_contrato", numeroContrato).maybeSingle(),
    admin.from("contrato_hoteles").select("nombre, proveedor").eq("numero_contrato", numeroContrato).order("orden").limit(1),
    admin.from("contrato_vuelos").select("aerolinea").eq("numero_contrato", numeroContrato).order("orden").limit(1),
    admin.from("proveedores").select("nombre, aplica_retencion, pct_retencion"),
  ]);
  if (!v) return { ok: false, creadas: 0 };
  const tenant = (v.tenant as string | null) ?? "mayorista";

  const yaTiene = new Set(((existentes ?? []).map((r) => r.tipo_proveedor).filter(Boolean)) as string[]);
  const hoy = new Date().toISOString().slice(0, 10);
  const vence = (v.plazo as string | null) ?? (v.fecha_salida as string | null) ?? null;
  const moneda = (v.moneda as string | null) ?? "COP";
  const hotelRow = (ch ?? [])[0] as { nombre: string | null; proveedor: string | null } | undefined;
  const vueloRow = (cv ?? [])[0] as { aerolinea: string | null } | undefined;

  // Retención del catálogo de proveedores por nombre (case-insensitive).
  const retDe = (nombre: string | null) => {
    const p = (provs ?? []).find((x) => x.nombre && nombre && x.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());
    return { aplica_retencion: p?.aplica_retencion ?? false, pct_retencion: Number(p?.pct_retencion) || 0 };
  };

  type Row = {
    numero_contrato: string; tenant: string; proveedor: string | null; tipo_proveedor: string; servicio: string;
    valor_total: number; moneda: string; fecha_obligacion: string; fecha_vencimiento: string | null;
    aplica_retencion: boolean; pct_retencion: number; observaciones: string;
  };
  const rows: Row[] = [];
  const OBS = "Completado automáticamente (faltaba el proveedor)";
  const SIN_ESPECIFICAR = "Sin especificar";
  const add = (tipo: string, servicio: string, valor: number, proveedor: string | null) => {
    const nombre = proveedor?.trim() || SIN_ESPECIFICAR;
    const r = retDe(proveedor);
    rows.push({
      numero_contrato: numeroContrato, tenant, proveedor: nombre, tipo_proveedor: tipo, servicio,
      valor_total: Math.max(0, valor), moneda, fecha_obligacion: hoy, fecha_vencimiento: vence,
      aplica_retencion: r.aplica_retencion, pct_retencion: r.pct_retencion, observaciones: OBS,
    });
  };

  // Crea solo los tipos de proveedor que falten y tengan costo real (> 0). El
  // proveedor del hotel/aéreo se jala del contrato si existe; si no, queda
  // "Sin especificar" (editable luego desde la pestaña Proveedores).
  if (!yaTiene.has("hotel") && (Number(v.costo_hotel) || 0) > 0)
    add("hotel", `Hotel ${hotelRow?.nombre ?? v.hotel ?? ""}`.trim(), Number(v.costo_hotel) || 0, hotelRow?.proveedor ?? null);
  if (!yaTiene.has("aereo") && (Number(v.costo_aereo) || 0) > 0)
    add("aereo", `Aéreo ${vueloRow?.aerolinea ?? v.aerolinea ?? ""}`.trim(), Number(v.costo_aereo) || 0, vueloRow?.aerolinea ?? (v.aerolinea as string | null));
  if (!yaTiene.has("receptivo") && (Number(v.costo_receptivo) || 0) > 0)
    add("receptivo", "Servicios receptivos", Number(v.costo_receptivo) || 0, null);
  if (!yaTiene.has("asistencia") && (Number(v.costo_asistencia) || 0) > 0)
    add("asistencia", "Asistencia médica", Number(v.costo_asistencia) || 0, null);
  if (!yaTiene.has("otro") && (Number(v.otros_costos) || 0) > 0)
    add("otro", "Otros costos", Number(v.otros_costos) || 0, null);

  if (!rows.length) return { ok: true, creadas: 0 };

  const { data: creadas, error } = await admin.from("cuentas_por_pagar").insert(rows).select("id, tipo_proveedor, proveedor, servicio, valor_total");
  if (error) return { ok: false, creadas: 0, error: error.message };
  for (const c of creadas ?? []) {
    await postearAsientoCxP({
      cuentaId: c.id, numeroContrato, tipoProveedor: c.tipo_proveedor, proveedor: c.proveedor,
      servicio: c.servicio, valorTotal: Number(c.valor_total) || 0, fecha: hoy,
    });
  }
  revalidatePath("/dashboard/pagos");
  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  revalidatePath("/dashboard/contabilidad/libro-diario");
  revalidatePath("/dashboard/contabilidad/libro-auxiliar");
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
  salidaId?: number; // cuando el programa tarifa por salida (modo_precio='salida')
  fechaIda: string;
  paxPorAcom: Record<string, number>; // CANTIDAD DE HABITACIONES por acomodación (sencilla/doble/triple/…). Pax = hab × pax_tarifa.
  ninos: number;
  infantes?: number; // cantidad de infantes (pasajeros adicionales, sin silla)
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
    .select("id, nombre, subtitulo, moneda, pct_mk, pct_fee_tarjeta, asistencia_medica_dia, modo_precio, dias, noches, proveedor_id, vigencia_desde, vigencia_hasta, edad_nino_min, edad_nino_max, edad_infante_max, proveedores(nombre, aplica_retencion, pct_retencion)")
    .eq("id", input.programaId)
    .maybeSingle();
  if (!prog) return { ok: false, error: "Programa no encontrado." };
  const modoSalida = prog.modo_precio === "salida";

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

  // 2) Precios — por categoría (matriz) o por salida (fecha × precio).
  const netoDe: Record<string, { neto: number | null; bs: boolean }> = {};
  let nochesViaje = prog.dias != null ? Math.max(0, prog.dias - 1) : null; // noches del viaje
  let etiquetaOpcion: string | null = null; // nombre de la opción elegida (categoría o salida)
  let hotelSalida: string | null = null;

  if (modoSalida) {
    if (!input.salidaId) return { ok: false, error: "Elige una salida." };
    const { data: sal } = await sb
      .from("programa_salidas")
      .select("etiqueta, columna, noches, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, bajo_solicitud")
      .eq("id", input.salidaId)
      .eq("programa_id", input.programaId)
      .maybeSingle();
    if (!sal) return { ok: false, error: "Salida no encontrada." };
    const bs = sal.bajo_solicitud;
    netoDe["sencilla"] = { neto: sal.neto_sencilla, bs };
    netoDe["doble"] = { neto: sal.neto_doble, bs };
    netoDe["triple"] = { neto: sal.neto_triple, bs };
    netoDe["multiple"] = { neto: sal.neto_multiple, bs };
    netoDe["nino"] = { neto: sal.neto_nino, bs };
    if (sal.noches != null) nochesViaje = sal.noches;
    etiquetaOpcion = sal.etiqueta ?? null;
    hotelSalida = sal.columna ?? null;
  } else {
    const { data: precios } = await sb
      .from("programa_precios")
      .select("acomodacion, neto, bajo_solicitud")
      .eq("categoria_id", input.categoriaId);
    if (!precios?.length) return { ok: false, error: "La categoría no tiene precios cargados." };
    for (const p of precios) netoDe[p.acomodacion] = { neto: p.neto, bs: p.bajo_solicitud };
  }

  // PVP de venta: neto → +markup → +asistencia médica/día → +fee bancario.
  // En modo salida la asistencia médica usa las noches de la salida.
  const diasPvp = modoSalida && nochesViaje != null ? nochesViaje : prog.dias;
  const pvp = (neto: number) =>
    pvpPrograma(neto, {
      pctMk: prog.pct_mk,
      asistenciaDia: prog.asistencia_medica_dia,
      dias: diasPvp,
      pctFee: prog.pct_fee_tarjeta,
    });

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
  const catNombre = modoSalida
    ? etiquetaOpcion
    : (await sb.from("programa_categorias").select("nombre").eq("id", input.categoriaId).maybeSingle()).data?.nombre ?? null;

  let orden = 0;
  for (const [acom, habRaw] of habs) {
    const nHab = Number(habRaw) || 0;
    const info = netoDe[acom];
    if (!info || info.neto == null || info.bs)
      return { ok: false, error: `La acomodación ${acom} no tiene precio (o es "a solicitud") en esta categoría.` };
    const paxTarifa = paxDeAcomodacion(acom); // pax por habitación (cuadruple = 4)
    const nPax = nHab * paxTarifa;
    const precioPax = pvp(info.neto);
    const label = ACOM_ROOM_LABEL[acom as AcomRoom] ?? (acom === "cuadruple" ? "Cuádruple" : acom);
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
  // Los infantes son pasajeros adicionales (sin silla), por cantidad.
  const numInfantes = Math.max(0, Math.trunc(Number(input.infantes) || 0));
  totalPax += numInfantes;
  if (totalPax <= 0) return { ok: false, error: "Debe haber al menos un pasajero." };

  // 3.b) Validación de pasajeros por edad (umbrales del programa, según el
  //      proveedor). Si hay fechas de nacimiento, la clasificación real debe
  //      cuadrar con los niños/infantes declarados; si faltan, no se bloquea.
  {
    const numNinos = Math.max(0, Math.trunc(Number(input.ninos) || 0));
    const infanteMax = prog.edad_infante_max ?? 1;
    const ninoMax = prog.edad_nino_max ?? 11;
    const real = clasificarPorEdad(
      input.pasajeros.map((p) => calcularEdad(p.fechaNacimiento, input.fechaIda)),
      infanteMax,
      ninoMax
    );
    if (input.pasajeros.length && real.sinFecha === 0) {
      const adultosEsperados = totalPax - numNinos - numInfantes;
      const errores: string[] = [];
      if (real.infantes > numInfantes)
        errores.push(`Por fecha de nacimiento hay ${real.infantes} infante(s), pero declaraste ${numInfantes}.`);
      if (real.ninos > numNinos)
        errores.push(`Por fecha de nacimiento hay ${real.ninos} niño(s), pero declaraste ${numNinos}.`);
      if (real.adultos > adultosEsperados)
        errores.push(`Por fecha de nacimiento hay ${real.adultos} adulto(s), pero la reserva es para ${adultosEsperados}.`);
      if (errores.length) return { ok: false, error: errores.join(" ") };
    }
  }

  // 4) Número de contrato
  const { data: numero, error: ne } = await sb.rpc("siguiente_numero_contrato");
  if (ne || !numero) return { ok: false, error: ne?.message ?? "No se pudo generar el número de contrato." };

  const canal = input.tipoAsesor === "interno" ? "B2C" : "B2B";
  // Todo contrato lleva ASESOR INTERNO (quien firma/vende internamente y a quien
  // aplica la escala). La agencia/freelance se guarda aparte (canal B2B).
  const asesorNombre = input.asesorInterno;
  const fechaRegreso = nochesViaje != null ? sumarDias(input.fechaIda, nochesViaje) : prog.dias ? sumarDias(input.fechaIda, Math.max(0, prog.dias - 1)) : null;

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

  // 8) Hoteles por ciudad (de la categoría elegida) — informativo en el contrato.
  //    En modo salida no hay matriz de hoteles; se usa el hotel de la columna si lo hay.
  const provNombre = (prog.proveedores as unknown as { nombre: string } | null)?.nombre ?? null;
  const { data: hotelesCat } = modoSalida
    ? { data: hotelSalida ? [{ ciudad: prog.subtitulo ?? prog.nombre, hotel: hotelSalida, orden: 0 }] : [] }
    : await sb
        .from("programa_categoria_hoteles")
        .select("ciudad, hotel, orden")
        .eq("categoria_id", input.categoriaId)
        .order("orden");
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
      const fechaProg = new Date().toISOString().slice(0, 10);
      const { data: cProg } = await admin.from("cuentas_por_pagar").insert({
        numero_contrato: numero,
        proveedor: pr?.nombre ?? null,
        tipo_proveedor: "programa",
        servicio: prog.nombre,
        valor_total: costoNeto,
        moneda: prog.moneda,
        fecha_obligacion: fechaProg,
        aplica_retencion: pr?.aplica_retencion ?? false,
        pct_retencion: Number(pr?.pct_retencion) || 0,
        observaciones: "Generado automáticamente desde el tarifario (programa)",
      }).select("id").single();
      if (cProg) {
        await postearAsientoCxP({
          cuentaId: cProg.id, numeroContrato: numero, tipoProveedor: "programa", proveedor: pr?.nombre ?? null,
          servicio: prog.nombre, valorTotal: costoNeto, fecha: fechaProg,
        });
      }
    } catch {
      // No bloquear la reserva si falla el paso administrativo.
    }
  }

  revalidatePath("/dashboard/contratos");
  return { ok: true, numero };
}
