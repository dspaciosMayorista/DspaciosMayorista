"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { marcar } from "@/lib/calc/paquetes";

export type ServicioManual = {
  tipo: string;          // aereo / hotel / traslado / asistencia / otro
  plataforma: string;    // por dónde se cotizó
  nombre: string;        // nombre del servicio
  proveedor: string;     // proveedor (texto libre)
  costoNeto: number;     // costo neto
  modo: "mk" | "ta";     // mk = markup (margen) · ta = valor fijo (solo aéreo)
  pctMarkup: number;     // markup en % (25 = 25%); margen: costo/(1-mk)
  ta: number;            // valor fijo a sumar (TA) cuando modo='ta'
};

export type CotizacionManualInput = {
  cliente: { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; telefono: string; email: string };
  destino: string;
  fechaIda: string;
  fechaRegreso: string;
  pax: number;
  moneda: string;        // COP / USD
  tipoAsesor: "interno" | "agencia" | "freelance";
  asesorInterno: string;
  agenciaNombre: string;
  freelanceNombre: string;
  plazo: string;
  vigenciaHasta: string;
  observaciones: string;
  servicios: ServicioManual[];
};

const TIPO_LABEL: Record<string, string> = {
  aereo: "Aéreo", hotel: "Hotel", traslado: "Traslado", asistencia: "Asistencia médica", otro: "Otro",
};

// Descripción del servicio para documentos al CLIENTE (cotización/contrato).
// NO incluye la plataforma: es info interna (dónde se cotizó), no va al cliente.
function descripcionServicioCliente(tipo: string, nombre?: string | null, proveedor?: string | null): string {
  const t = TIPO_LABEL[tipo] ?? tipo;
  const n = (nombre || "").trim() || "—";
  const p = (proveedor || "").trim();
  return `${t}: ${n}${p ? ` (${p})` : ""}`;
}

// Valor de venta de un servicio:
//   modo 'mk' → costo / (1 − markup)   (margen)
//   modo 'ta' → costo + TA             (valor fijo, p. ej. aéreo)
function valorServicio(costo: number, modo: "mk" | "ta", pctMarkup: number, ta: number): number {
  const c = Number(costo) || 0;
  if (modo === "ta") return Math.round(Math.max(0, c) + (Number(ta) || 0));
  const mk = (Number(pctMarkup) || 0) / 100;
  if (c <= 0 || mk >= 1) return 0;
  return Math.round(marcar(c, mk));
}

export async function crearCotizacionManual(
  input: CotizacionManualInput
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const sb = await createClient();

  if (!`${input.cliente.nombres ?? ""}${input.cliente.apellidos ?? ""}`.trim())
    return { ok: false, error: "El nombre del cliente es obligatorio." };
  const servicios = (input.servicios ?? []).filter((s) => (Number(s.costoNeto) || 0) > 0 || (s.nombre ?? "").trim() || (s.plataforma ?? "").trim());
  if (!servicios.length) return { ok: false, error: "Agrega al menos un servicio con su costo." };

  const { data: { user } } = await sb.auth.getUser();

  const moneda = (input.moneda || "COP").toUpperCase();
  const asesor =
    input.tipoAsesor === "interno" ? input.asesorInterno
      : input.tipoAsesor === "agencia" ? input.agenciaNombre
        : input.freelanceNombre;
  const canal = input.tipoAsesor === "interno" ? "B2C" : "B2B";
  const clienteNombre = `${input.cliente.nombres ?? ""} ${input.cliente.apellidos ?? ""}`.trim();

  // Liquidación de cada servicio.
  const filas = servicios.map((s, i) => {
    // Solo el aéreo permite TA; el resto siempre markup.
    const modo: "mk" | "ta" = s.tipo === "aereo" && s.modo === "ta" ? "ta" : "mk";
    const valor = valorServicio(s.costoNeto, modo, s.pctMarkup, s.ta);
    return {
      orden: i,
      tipo_servicio: s.tipo || "otro",
      plataforma: (s.plataforma || "").trim() || null,
      nombre_servicio: (s.nombre || "").trim() || null,
      proveedor: (s.proveedor || "").trim() || null,
      costo_neto: Number(s.costoNeto) || 0,
      modo,
      pct_markup: modo === "mk" ? (Number(s.pctMarkup) || 0) / 100 : 0,
      ta: modo === "ta" ? (Number(s.ta) || 0) : 0,
      valor,
    };
  });
  const precioVenta = filas.reduce((acc, f) => acc + f.valor, 0);

  // Snapshot para el documento/PDF (mismo formato que las cotizaciones del
  // tarifario: venta + items). Cada servicio es un ítem (cantidad 1 × valor).
  const detalle = {
    venta: {
      numero_contrato: "",
      cliente: clienteNombre,
      destino: input.destino || null,
      fecha_salida: input.fechaIda || null,
      fecha_regreso: input.fechaRegreso || null,
      pax: Number(input.pax) || 0,
      precio_venta: precioVenta,
      moneda,
      asesor: asesor || null,
      canal,
      tipo_cliente: input.tipoAsesor,
      hotel: filas.find((f) => f.tipo_servicio === "hotel")?.nombre_servicio ?? null,
      aerolinea: filas.find((f) => f.tipo_servicio === "aereo")?.nombre_servicio ?? null,
      observaciones: input.observaciones || null,
      estado: "cotizacion",
    },
    pasajeros: [],
    hoteles: [],
    vuelos: [],
    items: filas.map((f) => ({
      numero_contrato: "",
      descripcion: descripcionServicioCliente(f.tipo_servicio, f.nombre_servicio, f.proveedor),
      adultos: 1,
      ninos: 0,
      tarifa_adulto: f.valor,
      tarifa_nino: 0,
      orden: f.orden,
    })),
  };

  const { data: cot, error } = await sb
    .from("cotizaciones")
    .insert({
      tipo: "manual",
      estado: "abierta",
      payload: JSON.parse(JSON.stringify(input)),
      detalle,
      cliente: clienteNombre,
      cliente_documento: input.cliente.numeroDoc || null,
      destino: input.destino || null,
      hotel: detalle.venta.hotel,
      modulo: "manual",
      plan_nombre: "Cotización dinámica",
      pax: Number(input.pax) || 0,
      precio_venta: precioVenta,
      moneda,
      fecha_salida: input.fechaIda || null,
      fecha_regreso: input.fechaRegreso || null,
      vigencia_hasta: input.vigenciaHasta || null,
      asesor: asesor || null,
      creado_por: user?.email ?? null,
    })
    .select("id")
    .single();
  if (error || !cot) return { ok: false, error: error?.message ?? "No se pudo crear la cotización." };

  const rows = filas.map((f) => ({ cotizacion_id: cot.id, ...f }));
  const { error: e2 } = await sb.from("cotizacion_servicios").insert(rows);
  if (e2) return { ok: false, error: e2.message };

  revalidatePath("/dashboard/cotizaciones");
  return { ok: true, id: cot.id };
}

// ── Convertir cotización dinámica a contrato ───────────────────────────────
// Genera numero_contrato, crea la venta y los contrato_items. La cotización
// queda en estado 'convertida' enlazada al nuevo contrato.
export async function convertirCotizacionManualAContrato(
  cotizacionId: number
): Promise<{ ok: true; numero: string } | { ok: false; error: string }> {
  const sb = await createClient();

  const { data: cot } = await sb
    .from("cotizaciones")
    .select("*")
    .eq("id", cotizacionId)
    .eq("tipo", "manual")
    .eq("estado", "abierta")
    .maybeSingle();
  if (!cot) return { ok: false, error: "Cotización no encontrada o ya fue procesada." };

  const { data: servicios } = await sb
    .from("cotizacion_servicios")
    .select("*")
    .eq("cotizacion_id", cotizacionId)
    .order("orden");

  const payload = (cot.payload ?? {}) as CotizacionManualInput;
  const detalle = (cot.detalle ?? {}) as Record<string, unknown>;

  // Número de contrato (secuencia BD)
  const { data: numero, error: ne } = await sb.rpc("siguiente_numero_contrato");
  if (ne || !numero) return { ok: false, error: ne?.message ?? "No se pudo generar el número de contrato." };

  // Costos netos agregados por tipo (para la venta)
  const ss = servicios ?? [];
  const costoAereo   = ss.filter(s => s.tipo_servicio === "aereo").reduce((a, s) => a + (s.costo_neto ?? 0), 0);
  const costoHotel   = ss.filter(s => s.tipo_servicio === "hotel").reduce((a, s) => a + (s.costo_neto ?? 0), 0);
  const costoOtros   = ss.filter(s => !["aereo","hotel"].includes(s.tipo_servicio)).reduce((a, s) => a + (s.costo_neto ?? 0), 0);

  const canal = payload.tipoAsesor === "interno" ? "B2C" : "B2B";
  const ventaSnap = (detalle.venta ?? {}) as Record<string, unknown>;

  const { error: ve } = await sb.from("ventas").insert({
    numero_contrato: numero,
    cliente: cot.cliente ?? "",
    cliente_documento: cot.cliente_documento ?? undefined,
    cliente_telefono: payload.cliente?.telefono || undefined,
    destino: cot.destino ?? undefined,
    tipo_paquete: "dinamico",
    fecha_salida: cot.fecha_salida ?? undefined,
    fecha_regreso: cot.fecha_regreso ?? undefined,
    pax: cot.pax ?? undefined,
    precio_venta: cot.precio_venta ?? undefined,
    moneda: cot.moneda ?? "COP",
    asesor: cot.asesor ?? undefined,
    canal,
    tipo_cliente: payload.tipoAsesor ?? undefined,
    hotel: typeof ventaSnap.hotel === "string" ? ventaSnap.hotel : undefined,
    aerolinea: typeof ventaSnap.aerolinea === "string" ? ventaSnap.aerolinea : undefined,
    costo_aereo: costoAereo,
    costo_hotel: costoHotel,
    otros_costos: costoOtros,
    estado: "pendiente",
    observaciones: payload.observaciones || undefined,
  });
  if (ve) return { ok: false, error: ve.message };

  // Ítems del contrato (uno por servicio)
  if (ss.length) {
    const items = ss.map(s => ({
      numero_contrato: numero,
      descripcion: descripcionServicioCliente(s.tipo_servicio, s.nombre_servicio, s.proveedor),
      adultos: 1,
      ninos: 0,
      tarifa_adulto: s.valor ?? 0,
      tarifa_nino: 0,
      orden: s.orden,
    }));
    const { error: ie } = await sb.from("contrato_items").insert(items);
    if (ie) return { ok: false, error: ie.message };
  }

  // Actualiza cotización: estado convertida + numero_contrato en el detalle
  const detalleActualizado = {
    ...detalle,
    venta: { ...ventaSnap, numero_contrato: numero },
  };
  await sb
    .from("cotizaciones")
    .update({ estado: "convertida", numero_contrato: numero, detalle: detalleActualizado })
    .eq("id", cotizacionId);

  revalidatePath("/dashboard/cotizaciones");
  revalidatePath(`/dashboard/cotizaciones/${cotizacionId}`);
  revalidatePath(`/cotizacion/${cotizacionId}`);

  return { ok: true, numero };
}
