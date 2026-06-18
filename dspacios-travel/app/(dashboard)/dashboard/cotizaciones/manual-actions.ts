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
  pctMarkup: number;     // markup en % (25 = 25%); margen: costo/(1-mk)
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

// Valor de venta de un servicio = costo / (1 − markup). Redondeo a entero.
function valorServicio(costo: number, pctMarkup: number): number {
  const c = Number(costo) || 0;
  const mk = (Number(pctMarkup) || 0) / 100;
  if (c <= 0) return 0;
  if (mk >= 1) return 0;
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
    const valor = valorServicio(s.costoNeto, s.pctMarkup);
    return {
      orden: i,
      tipo_servicio: s.tipo || "otro",
      plataforma: (s.plataforma || "").trim() || null,
      nombre_servicio: (s.nombre || "").trim() || null,
      proveedor: (s.proveedor || "").trim() || null,
      costo_neto: Number(s.costoNeto) || 0,
      pct_markup: (Number(s.pctMarkup) || 0) / 100,
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
      descripcion: `${TIPO_LABEL[f.tipo_servicio] ?? f.tipo_servicio}: ${f.nombre_servicio ?? "—"}`
        + (f.plataforma ? ` · ${f.plataforma}` : "")
        + (f.proveedor ? ` (${f.proveedor})` : ""),
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
