"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { precioServicio } from "@/lib/calc/paquetes";

const oNull = (s: string | null | undefined) => (s && s.trim() !== "" ? s.trim() : null);

const ACOM_NINO = ["nino", "nino2"];
const ACOM_LABEL: Record<string, string> = {
  sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple", nino: "Niño 1", nino2: "Niño 2",
};

export type PasajeroReserva = {
  nombre: string;
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
  categoria: string;
  regimen: string;
  cantidades: Record<string, number>;   // personas por acomodación
  infantes: number;
  cliente: { nombre: string; tipoDoc: string; numeroDoc: string; telefono: string; email: string };
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

  if (!input.cliente.nombre.trim()) return { ok: false, error: "El nombre del cliente es obligatorio." };

  const esServicios = input.modulo === "servicios";

  // 1) Precios desde el tarifario (fuente de verdad; el asesor no los cambia)
  const pvpPorAcom: Record<string, number> = {};
  let precioVenta = 0;
  let paxConSilla = 0;
  let meta: { hotel_nombre: string | null; destino_nombre: string | null; fecha_ida: string | null; fecha_regreso: string | null };

  if (!esServicios) {
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
    for (const [acom, cant] of Object.entries(input.cantidades)) {
      const n = Number(cant) || 0;
      if (n <= 0) continue;
      precioVenta += n * (pvpPorAcom[acom] ?? 0);
      paxConSilla += n;
    }
    if (paxConSilla <= 0) return { ok: false, error: "Indica al menos un pasajero (cantidad por acomodación)." };
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
    cliente: input.cliente.nombre.trim(),
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
        nombre: p.nombre.trim(),
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
    const resumenAcom = Object.entries(input.cantidades)
      .filter(([, n]) => Number(n) > 0)
      .map(([a, n]) => `${n} ${ACOM_LABEL[a] ?? a}`)
      .join(", ");
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
      await sb.from("contrato_vuelos").insert({
        numero_contrato: numero,
        aerolinea: bq.aerolinea,
        servicios: bq.ruta,
        fecha_salida: bq.fecha_ida,
        orden: 0,
      });
    }
  }

  // 8) Ítems de valores (uno por acomodación con cantidad)
  const items = Object.entries(input.cantidades)
    .filter(([, n]) => Number(n) > 0)
    .map(([acom, n], i) => {
      const esNino = ACOM_NINO.includes(acom);
      return {
        numero_contrato: numero,
        descripcion: `${ACOM_LABEL[acom] ?? acom} · ${input.categoria} / ${input.regimen}`,
        adultos: esNino ? 0 : Number(n),
        ninos: esNino ? Number(n) : 0,
        tarifa_adulto: esNino ? 0 : (pvpPorAcom[acom] ?? 0),
        tarifa_nino: esNino ? (pvpPorAcom[acom] ?? 0) : 0,
        orden: i,
      };
    });
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
        await admin
          .from("sillas")
          .update({
            estado: "en_plazo",
            numero_contrato: numero,
            asesor: oNull(asesorNombre),
            hotel: meta.hotel_nombre,
            acomodacion: input.categoria,
            plazo: oNull(input.plazo),
          })
          .in("id", libres.map((s) => s.id));
      }
    } catch {
      // No bloquear la reserva si falla el paso administrativo.
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
