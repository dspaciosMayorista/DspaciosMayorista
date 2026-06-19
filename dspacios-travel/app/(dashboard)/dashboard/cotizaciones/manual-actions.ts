"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { marcar } from "@/lib/calc/paquetes";
import { sugerirIncluye } from "@/lib/cotizacion/incluye";

// Tipo de servicio de la cotización dinámica → tipo de proveedor de la CxP.
const TIPO_PROVEEDOR: Record<string, string> = {
  aereo: "aereo", hotel: "hotel", traslado: "receptivo", asistencia: "asistencia", otro: "otro",
};

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
  cliente: { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; telefono: string; email: string; nacimiento?: string };
  destino: string;
  fechaIda: string;
  fechaRegreso: string;
  pax: number;           // adultos
  ninos?: number;        // cantidad de niños
  tarifaNino?: number;   // valor por niño (suma al total)
  recobro?: number;      // mayor valor cobrado, oculto al cliente
  recobroAliado?: number;// parte del recobro para el aliado (B2B)
  moneda: string;        // COP / USD
  tipoAsesor: "interno" | "agencia" | "freelance";
  asesorInterno: string;
  agenciaNombre: string;
  freelanceNombre: string;
  plazo: string;
  vigenciaHasta: string;
  observaciones: string;
  incluye?: string;      // qué incluye (texto libre, una línea por ítem)
  noIncluye?: string;    // qué no incluye (texto libre)
  servicios: ServicioManual[];
};

const TIPO_LABEL: Record<string, string> = {
  aereo: "Aéreo", hotel: "Hotel", traslado: "Traslado", asistencia: "Asistencia médica", otro: "Otro",
};

// Fecha YYYY-MM-DD → DD/MM/YYYY (para el nombre del ítem de paquete).
function fmtDMY(iso?: string | null): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || "—");
}

// Nombre del ÍTEM ÚNICO agrupado que ve el cliente (cotización dinámica).
// No revela hoteles ni proveedores: ese detalle va a los vouchers.
function nombrePaqueteItem(destino?: string | null, ida?: string | null, regreso?: string | null): string {
  const d = (destino || "").trim().toUpperCase() || "DESTINO";
  return `PAQUETE TURÍSTICO A ${d} DEL ${fmtDMY(ida)} AL ${fmtDMY(regreso)}`;
}

// Niños + recobro de la cotización dinámica.
//  · Niños: cantidad × tarifa por niño (suma al total).
//  · Recobro: cliente final (interno) → 100% empresa; agencia/freelance → se
//    reparte (lo que va al aliado se acota a [0, recobro]).
function calcularRecobroNinos(input: {
  pax: number; ninos?: number; tarifaNino?: number; recobro?: number; recobroAliado?: number;
  tipoAsesor: "interno" | "agencia" | "freelance";
}) {
  const nNinos = Math.max(Math.trunc(Number(input.ninos) || 0), 0);
  const valorNino = Math.max(Number(input.tarifaNino) || 0, 0);
  const totalNinos = nNinos * valorNino;
  const recobroN = Math.max(Number(input.recobro) || 0, 0);
  const esB2B = input.tipoAsesor !== "interno";
  const recobroAliadoN = esB2B ? Math.min(Math.max(Number(input.recobroAliado) || 0, 0), recobroN) : 0;
  const recobroEmpresaN = recobroN - recobroAliadoN;
  return { nNinos, valorNino, totalNinos, recobroN, recobroAliadoN, recobroEmpresaN, esB2B };
}

// Recuadros "Hoteles y Servicios" del contrato, según los servicios elegidos:
// hotel → Servicio/Plan, traslado → Tours y traslados, asistencia → Sí.
function cajasDesdeServicios(servs: { tipo_servicio: string; nombre_servicio: string | null }[]) {
  const nombres = (t: string) => servs.filter((s) => s.tipo_servicio === t).map((s) => (s.nombre_servicio || "").trim()).filter(Boolean);
  return {
    asistencia_medica: servs.some((s) => s.tipo_servicio === "asistencia"),
    plan_nombre: nombres("hotel").join(", ") || null,
    tours_traslados: nombres("traslado").join(", ") || null,
  };
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
  const totalServicios = filas.reduce((acc, f) => acc + f.valor, 0);

  // Niños y recobro (ver helper). adultSubtotal "esconde" el recobro dentro de
  // la tarifa de adulto: el cliente nunca ve el recobro como línea aparte.
  const rec = calcularRecobroNinos(input);
  const adultos = Math.max(Number(input.pax) || 1, 1);
  const adultSubtotal = totalServicios + rec.recobroN;        // servicios + recobro
  const tarifaAdultoUnit = Math.round(adultSubtotal / adultos);
  const precioVenta = adultSubtotal + rec.totalNinos;         // total que paga el cliente

  // Filas visibles para el cliente: una de adultos y otra de niños (si hay).
  const itemsDoc: { descripcion: string; cantidad: number; tarifa_unit: number; valor: number; orden: number }[] = [
    { descripcion: nombrePaqueteItem(input.destino, input.fechaIda, input.fechaRegreso), cantidad: adultos, tarifa_unit: tarifaAdultoUnit, valor: adultSubtotal, orden: 0 },
  ];
  if (rec.nNinos > 0) {
    itemsDoc.push({ descripcion: "Tarifa por niño", cantidad: rec.nNinos, tarifa_unit: rec.valorNino, valor: rec.totalNinos, orden: 1 });
  }

  // Snapshot para el documento/PDF (venta + items).
  const detalle = {
    venta: {
      numero_contrato: "",
      cliente: clienteNombre,
      destino: input.destino || null,
      fecha_salida: input.fechaIda || null,
      fecha_regreso: input.fechaRegreso || null,
      pax: adultos,
      ninos: rec.nNinos,
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
    // Qué incluye / no incluye (texto libre editable). Si el asesor no escribió
    // el "incluye", se sugiere a partir de los servicios elegidos.
    incluye: (input.incluye || "").trim() || sugerirIncluye(input.servicios.map((s) => ({ tipo: s.tipo, nombre: s.nombre }))),
    noIncluye: (input.noIncluye || "").trim(),
    // Recobro (INTERNO, nunca se muestra al cliente).
    recobro: { total: rec.recobroN, empresa: rec.recobroEmpresaN, aliado: rec.recobroAliadoN },
    items: itemsDoc,
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

// ── Editar los datos del titular de una cotización dinámica ─────────────────
// Permite completar/corregir el titular (incl. fecha de nacimiento) antes de
// generar el contrato. Solo en estado 'abierta'.
export type TitularInput = { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; nacimiento: string; telefono: string; email: string };

export async function actualizarTitularCotizacionManual(
  cotizacionId: number,
  titular: TitularInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: cot } = await sb
    .from("cotizaciones")
    .select("payload, detalle, estado, tipo")
    .eq("id", cotizacionId)
    .maybeSingle();
  if (!cot) return { ok: false, error: "Cotización no encontrada." };
  if (cot.tipo !== "manual" || cot.estado !== "abierta")
    return { ok: false, error: "Solo se puede editar el titular de una cotización dinámica abierta." };
  if (!`${titular.nombres ?? ""}${titular.apellidos ?? ""}`.trim())
    return { ok: false, error: "El nombre del titular es obligatorio." };

  const nombre = `${titular.nombres ?? ""} ${titular.apellidos ?? ""}`.trim();
  const payload = { ...((cot.payload ?? {}) as Record<string, unknown>) };
  payload.cliente = {
    nombres: (titular.nombres || "").trim(),
    apellidos: (titular.apellidos || "").trim(),
    tipoDoc: (titular.tipoDoc || "CC").trim(),
    numeroDoc: (titular.numeroDoc || "").trim(),
    nacimiento: (titular.nacimiento || "").trim(),
    telefono: (titular.telefono || "").trim(),
    email: (titular.email || "").trim(),
  };
  const detalle = { ...((cot.detalle ?? {}) as Record<string, unknown>) };
  const ventaSnap = { ...((detalle.venta ?? {}) as Record<string, unknown>), cliente: nombre };
  detalle.venta = ventaSnap;

  const { error } = await sb
    .from("cotizaciones")
    .update({
      payload: JSON.parse(JSON.stringify(payload)),
      detalle: JSON.parse(JSON.stringify(detalle)),
      cliente: nombre,
      cliente_documento: (titular.numeroDoc || "").trim() || null,
    })
    .eq("id", cotizacionId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/cotizaciones/${cotizacionId}`);
  revalidatePath(`/cotizacion/${cotizacionId}`);
  return { ok: true };
}

// ── Editar "Incluye / No incluye" de una cotización dinámica ───────────────
export async function actualizarIncluyeCotizacionManual(
  cotizacionId: number,
  incluye: string,
  noIncluye: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: cot } = await sb
    .from("cotizaciones")
    .select("detalle, payload, estado, tipo")
    .eq("id", cotizacionId)
    .maybeSingle();
  if (!cot) return { ok: false, error: "Cotización no encontrada." };
  if (cot.tipo !== "manual" || cot.estado !== "abierta")
    return { ok: false, error: "Solo se puede editar una cotización dinámica abierta." };

  const detalle = { ...((cot.detalle ?? {}) as Record<string, unknown>), incluye: (incluye || "").trim(), noIncluye: (noIncluye || "").trim() };
  const payload = { ...((cot.payload ?? {}) as Record<string, unknown>), incluye: (incluye || "").trim(), noIncluye: (noIncluye || "").trim() };

  const { error } = await sb
    .from("cotizaciones")
    .update({ detalle: JSON.parse(JSON.stringify(detalle)), payload: JSON.parse(JSON.stringify(payload)) })
    .eq("id", cotizacionId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/cotizaciones/${cotizacionId}`);
  revalidatePath(`/cotizacion/${cotizacionId}`);
  return { ok: true };
}

// ── Editar niños y recobro de una cotización dinámica ──────────────────────
// Permite ajustar la cantidad/tarifa de niños y el recobro (oculto al cliente)
// después de creada la cotización. Recalcula la tarifa de adulto (que esconde
// el recobro), el subtotal de niños y el total. Solo en estado 'abierta'.
export type RecobroNinosInput = { ninos: number; tarifaNino: number; recobro: number; recobroAliado: number };

export async function actualizarRecobroNinosCotizacionManual(
  cotizacionId: number,
  input: RecobroNinosInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: cot } = await sb
    .from("cotizaciones")
    .select("payload, detalle, estado, tipo, pax, destino, fecha_salida, fecha_regreso")
    .eq("id", cotizacionId)
    .maybeSingle();
  if (!cot) return { ok: false, error: "Cotización no encontrada." };
  if (cot.tipo !== "manual" || cot.estado !== "abierta")
    return { ok: false, error: "Solo se puede editar una cotización dinámica abierta." };

  const payload = { ...((cot.payload ?? {}) as CotizacionManualInput) };
  const tipoAsesor = (payload.tipoAsesor ?? "interno") as "interno" | "agencia" | "freelance";
  const adultos = Math.max(Number(payload.pax ?? cot.pax) || 1, 1);

  // Subtotal de servicios ya liquidados (columna valor); no se re-liquida.
  const { data: servs } = await sb.from("cotizacion_servicios").select("valor").eq("cotizacion_id", cotizacionId);
  const totalServicios = (servs ?? []).reduce((a, s) => a + (Number(s.valor) || 0), 0);

  // Niños y recobro con la MISMA lógica que la creación.
  const rec = calcularRecobroNinos({
    pax: adultos, ninos: input.ninos, tarifaNino: input.tarifaNino,
    recobro: input.recobro, recobroAliado: input.recobroAliado, tipoAsesor,
  });
  const adultSubtotal = totalServicios + rec.recobroN;          // servicios + recobro (oculto)
  const tarifaAdultoUnit = Math.round(adultSubtotal / adultos);
  const precioVenta = adultSubtotal + rec.totalNinos;

  // Filas visibles para el cliente (adultos + niños si hay).
  const itemsDoc: { descripcion: string; cantidad: number; tarifa_unit: number; valor: number; orden: number }[] = [
    { descripcion: nombrePaqueteItem(cot.destino, cot.fecha_salida, cot.fecha_regreso), cantidad: adultos, tarifa_unit: tarifaAdultoUnit, valor: adultSubtotal, orden: 0 },
  ];
  if (rec.nNinos > 0) {
    itemsDoc.push({ descripcion: "Tarifa por niño", cantidad: rec.nNinos, tarifa_unit: rec.valorNino, valor: rec.totalNinos, orden: 1 });
  }

  payload.ninos = rec.nNinos;
  payload.tarifaNino = rec.valorNino;
  payload.recobro = rec.recobroN;
  payload.recobroAliado = rec.recobroAliadoN;

  const detalle = { ...((cot.detalle ?? {}) as Record<string, unknown>) };
  const ventaSnap = { ...((detalle.venta ?? {}) as Record<string, unknown>), pax: adultos, ninos: rec.nNinos, precio_venta: precioVenta };
  detalle.venta = ventaSnap;
  detalle.recobro = { total: rec.recobroN, empresa: rec.recobroEmpresaN, aliado: rec.recobroAliadoN };
  detalle.items = itemsDoc;

  const { error } = await sb
    .from("cotizaciones")
    .update({
      payload: JSON.parse(JSON.stringify(payload)),
      detalle: JSON.parse(JSON.stringify(detalle)),
      precio_venta: precioVenta,
    })
    .eq("id", cotizacionId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/cotizaciones/${cotizacionId}`);
  revalidatePath(`/cotizacion/${cotizacionId}`);
  return { ok: true };
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

  // Datos del titular OBLIGATORIOS para pasar de cotización a contrato.
  const cl = payload.cliente ?? ({} as CotizacionManualInput["cliente"]);
  const faltan: string[] = [];
  if (!`${cl.nombres ?? ""}${cl.apellidos ?? ""}`.trim()) faltan.push("nombre");
  if (!(cl.tipoDoc ?? "").trim()) faltan.push("tipo de documento");
  if (!(cl.numeroDoc ?? "").trim()) faltan.push("número de documento");
  if (!(cl.nacimiento ?? "").trim()) faltan.push("fecha de nacimiento");
  if (faltan.length) return { ok: false, error: `Completa los datos del titular antes de generar el contrato: ${faltan.join(", ")}.` };

  const ss = servicios ?? [];

  // Número de contrato (secuencia BD)
  const { data: numero, error: ne } = await sb.rpc("siguiente_numero_contrato");
  if (ne || !numero) return { ok: false, error: ne?.message ?? "No se pudo generar el número de contrato." };

  // Costos netos por tipo, cada uno EN SU LUGAR (rentabilidad / flujo de caja):
  // aéreo, hotel, receptivo (traslados), asistencia y otros.
  const sumTipo = (pred: (t: string) => boolean) => ss.filter((s) => pred(s.tipo_servicio)).reduce((a, s) => a + (s.costo_neto ?? 0), 0);
  const costoAereo      = sumTipo((t) => t === "aereo");
  const costoHotel      = sumTipo((t) => t === "hotel");
  const costoReceptivo  = sumTipo((t) => t === "traslado");
  const costoAsistencia = sumTipo((t) => t === "asistencia");
  const costoOtros      = sumTipo((t) => t === "otro");
  const cajas = cajasDesdeServicios(ss);

  const canal = payload.tipoAsesor === "interno" ? "B2C" : "B2B";
  const ventaSnap = (detalle.venta ?? {}) as Record<string, unknown>;

  // Niños y recobro (mismo cálculo que en la creación; el recobro va oculto
  // dentro de la tarifa de adulto). El total ya está en cot.precio_venta.
  const rec = calcularRecobroNinos({
    pax: Number(cot.pax) || 1, ninos: payload.ninos, tarifaNino: payload.tarifaNino,
    recobro: payload.recobro, recobroAliado: payload.recobroAliado, tipoAsesor: payload.tipoAsesor,
  });

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
    hotel: cajas.plan_nombre ?? (typeof ventaSnap.hotel === "string" ? ventaSnap.hotel : undefined),
    aerolinea: typeof ventaSnap.aerolinea === "string" ? ventaSnap.aerolinea : undefined,
    // Recuadros "Hoteles y Servicios" del contrato según la selección.
    plan_nombre: cajas.plan_nombre ?? undefined,
    tours_traslados: cajas.tours_traslados ?? undefined,
    asistencia_medica: cajas.asistencia_medica,
    costo_aereo: costoAereo,
    costo_hotel: costoHotel,
    costo_receptivo: costoReceptivo,
    costo_asistencia: costoAsistencia,
    otros_costos: costoOtros,
    // Recobro (oculto al cliente): total + reparto empresa/aliado.
    recobro_total: rec.recobroN,
    recobro_empresa: rec.recobroEmpresaN,
    recobro_aliado: rec.recobroAliadoN,
    comision_b2b: rec.recobroAliadoN > 0 ? rec.recobroAliadoN : undefined,
    comision_estado: rec.recobroAliadoN > 0 ? "pendiente" : undefined,
    estado: "pendiente",
    observaciones: payload.observaciones || undefined,
  });
  if (ve) return { ok: false, error: ve.message };

  // Ítem del paquete: adultos + niños. tarifa_adulto incluye el recobro (oculto);
  // tarifa_nino = valor por niño. El doc multiplica cantidad × tarifa.
  {
    const pax = Math.max(Number(cot.pax) || 1, 1);
    const total = Number(cot.precio_venta) || 0;
    const adultSubtotal = total - rec.totalNinos;           // servicios + recobro
    const { error: ie } = await sb.from("contrato_items").insert([{
      numero_contrato: numero,
      descripcion: nombrePaqueteItem(cot.destino, cot.fecha_salida, cot.fecha_regreso),
      adultos: pax,
      ninos: rec.nNinos,
      tarifa_adulto: Math.round(adultSubtotal / pax),
      tarifa_nino: rec.valorNino,
      orden: 0,
    }]);
    if (ie) return { ok: false, error: ie.message };
  }

  // Comisión del aliado B2B por el recobro (entra al módulo de comisiones).
  if (rec.esB2B && rec.recobroAliadoN > 0) {
    const aliado = (payload.tipoAsesor === "agencia" ? payload.agenciaNombre : payload.freelanceNombre) || cot.asesor || "Aliado";
    await sb.from("aliados_b2b").insert({
      numero_contrato: numero,
      aliado,
      tipo_aliado: payload.tipoAsesor,
      precio_venta: Number(cot.precio_venta) || 0,
      base_comision: rec.recobroAliadoN,
      recobro_total: rec.recobroN,
      pct_recobro_aliado: rec.recobroN > 0 ? rec.recobroAliadoN / rec.recobroN : 0,
      estado: "pendiente",
    });
  }

  // Titular como pasajero del contrato (datos validados arriba).
  await sb.from("contrato_pasajeros").insert({
    numero_contrato: numero,
    nombre: `${cl.nombres ?? ""} ${cl.apellidos ?? ""}`.trim(),
    tipo_id: cl.tipoDoc || "CC",
    identificacion: cl.numeroDoc || null,
    fecha_nacimiento: cl.nacimiento || null,
    es_infante: false,
    orden: 0,
  });

  // Cuentas por pagar (CxP) de la cotización DINÁMICA. A diferencia del tarifario
  // (proveedor negociado del catálogo), aquí el servicio se cotizó en una
  // plataforma (JetSMART, agregadores, OTAs…). Por eso el proveedor de la CxP es,
  // por defecto, el nombre de la PLATAFORMA (o el proveedor si el asesor lo
  // escribió). Así la compra queda registrada y se ve en flujo de caja y costos.
  if (ss.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      const { data: provs } = await admin.from("proveedores").select("nombre, aplica_retencion, pct_retencion");
      const retDe = (nombre: string | null) => {
        const p = (provs ?? []).find((x) => x.nombre && nombre && x.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());
        return { aplica_retencion: p?.aplica_retencion ?? false, pct_retencion: Number(p?.pct_retencion) || 0 };
      };
      const hoyISO = new Date().toISOString().slice(0, 10);
      const moneda = (cot.moneda as string | null) ?? "COP";
      const vence = (cot.fecha_salida as string | null) ?? null;
      const cxp = ss
        .filter((s) => (Number(s.costo_neto) || 0) > 0)
        .map((s) => {
          // Proveedor por defecto = plataforma; si el asesor escribió un proveedor, ese manda.
          const proveedor = (s.proveedor || "").trim() || (s.plataforma || "").trim() || null;
          const r = retDe(proveedor);
          const tipo = TIPO_PROVEEDOR[s.tipo_servicio] ?? "otro";
          const etiqueta = TIPO_LABEL[s.tipo_servicio] ?? "Servicio";
          return {
            numero_contrato: numero,
            proveedor,
            tipo_proveedor: tipo,
            servicio: `${etiqueta}${s.nombre_servicio ? ` ${s.nombre_servicio}` : ""}`.trim(),
            valor_total: Math.max(0, Number(s.costo_neto) || 0),
            moneda,
            fecha_obligacion: hoyISO,
            fecha_vencimiento: vence,
            aplica_retencion: r.aplica_retencion,
            pct_retencion: r.pct_retencion,
            observaciones: "Generado automáticamente desde cotización dinámica",
          };
        });
      if (cxp.length) await admin.from("cuentas_por_pagar").insert(cxp);
    } catch {
      // No bloquear la conversión si falla la creación automática de CxP.
    }
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
  revalidatePath("/dashboard/pagos");
  revalidatePath("/dashboard/flujo-caja");

  return { ok: true, numero };
}
