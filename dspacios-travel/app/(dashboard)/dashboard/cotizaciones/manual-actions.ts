"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { marcar } from "@/lib/calc/paquetes";
import { sugerirIncluye } from "@/lib/cotizacion/incluye";
import { contextoCotizacion, autorizaTenant } from "@/lib/cotizacion/acceso";
import { ROLES_CONTRATO_COMPLETO } from "@/lib/roles";

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

  // Acción INTERNA (clasificación explícita, ver revisión de PR #267): único
  // caller es `CotizacionManualForm.tsx` bajo `/dashboard/cotizaciones/nueva`
  // (ruta protegida por `proxy.ts`), pero al ser una Server Action exportada
  // es igual de alcanzable directo por red — así que exige sesión aquí
  // también. `getTenant()` a secas cae en silencio a "mayorista" sin sesión
  // (ver lib/tenant.server.ts); `contextoCotizacion()` falla cerrado si no
  // hay perfil o `activo !== true`, y solo entonces resuelve el tenant real.
  const ctx = await contextoCotizacion();
  if (!ctx.ok) return { ok: false, error: "No autorizado." };
  const tenantCotizacion = ctx.tenant;

  const { data: cot, error } = await sb
    .from("cotizaciones")
    .insert({
      tenant: tenantCotizacion,
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
    .select("payload, detalle, estado, tipo, tenant")
    .eq("id", cotizacionId)
    .maybeSingle();
  if (!cot) return { ok: false, error: "Cotización no encontrada." };
  const ctx = await contextoCotizacion();
  if (!autorizaTenant(ctx, cot.tenant)) return { ok: false, error: "No tienes acceso a esta cotización." };
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
    .select("detalle, payload, estado, tipo, tenant")
    .eq("id", cotizacionId)
    .maybeSingle();
  if (!cot) return { ok: false, error: "Cotización no encontrada." };
  const ctx = await contextoCotizacion();
  if (!autorizaTenant(ctx, cot.tenant)) return { ok: false, error: "No tienes acceso a esta cotización." };
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
    .select("payload, detalle, estado, tipo, pax, destino, fecha_salida, fecha_regreso, tenant")
    .eq("id", cotizacionId)
    .maybeSingle();
  if (!cot) return { ok: false, error: "Cotización no encontrada." };
  const ctx = await contextoCotizacion();
  if (!autorizaTenant(ctx, cot.tenant)) return { ok: false, error: "No tienes acceso a esta cotización." };
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

// La misma lista que `_autorizado_pago_previo` en la migración 164 (Commit 5):
// la conversión a contrato es una operación de dinero — solo roles que firman
// contrato completo.
const ROLES_CONVERSION = new Set<string>(ROLES_CONTRATO_COMPLETO as string[]);

/** Sesión de un rol autorizado y activo (o null si no autorizado). */
async function sesionConversionAutorizada(): Promise<{ userId: string; rol: string } | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await sb
    .from("usuarios")
    .select("rol, activo")
    .eq("id", user.id)
    .maybeSingle();
  // El RPC vuelve a validar rol + activo de forma autoritativa; este cheque solo
  // da un mensaje amable antes de delegar (defensa en profundidad, no la frontera).
  if (!perfil || !perfil.rol || perfil.activo === false) return null;
  if (!ROLES_CONVERSION.has(perfil.rol)) return null;
  return { userId: user.id, rol: perfil.rol };
}

/**
 * Mensajes de error "seguros" para el navegador: nunca fugan detalles internos
 * de PostgreSQL. Los `raise exception` de la migración 164 son frases en español
 * limpias y pasan tal cual; solo se enmascara lo que parezca error crudo de la BD.
 */
function mensajeSeguro(msg: string): string {
  const m = String(msg ?? "").trim();
  if (!m) return "No se pudo convertir la cotización a contrato. Inténtalo de nuevo.";
  if (/(duplicate key|violates (foreign key|not-null|check) constraint|constraint "|relation "|pg_|sqlstate|serialization failure|contradice la política|new row violates)/i.test(m)) {
    return "No se pudo convertir por un conflicto de datos. Reintenta; si persiste, revisa que los pagos previos y las condiciones estén correctos.";
  }
  return m;
}

// ── Convertir cotización dinámica (manual) a contrato ────────────────────────
// Commit 5: la conversión es ATÓMICA en la BD. El RPC `convertir_cotizacion_a_contrato`
// (migración 164, INVOKER solo service_role) valida rol/activo/tenant/estado/
// congelado/mínimo, genera el número con la función real del tenant, crea la venta
// y sus hijas (items, pasajero, aliados_b2b), copia las condiciones congeladas a
// `contrato_condiciones`, transfiere cada pago previo a abono, reclasifica
// 280510→280505, crea la CxP de proveedor + sus asientos de costo/proveedor, enlaza
// `ventas.cotizacion_id` y marca la cotización 'convertida' — o revierte TODO en un
// solo rollback. Idempotente: un replay o una conversión concurrente devuelve la
// misma venta sin duplicar nada ni consumir otro consecutivo de la numeración.
// Esta Server Action solo autentica al actor (rol autorizado + activo) y delega;
// no hay secuencias REST parciales ni builders duplicados (una sola ruta).
export async function convertirCotizacionManualAContrato(
  cotizacionId: number
): Promise<{ ok: true; numero: string } | { ok: false; error: string }> {
  if (!(Number(cotizacionId) > 0)) return { ok: false, error: "Cotización inválida." };
  const sesion = await sesionConversionAutorizada();
  if (!sesion) {
    return { ok: false, error: "No autorizado: convertir a contrato requiere superadmin, administración, gerencia u operaciones." };
  }

  const admin = createAdminClient();
  const rpc = await admin.rpc("convertir_cotizacion_a_contrato", {
    p_cotizacion_id: cotizacionId,
    p_usuario_id: sesion.userId,
  });
  if (rpc.error) return { ok: false, error: mensajeSeguro(rpc.error.message) };

  const numero = String(rpc.data ?? "").trim();
  if (!numero || numero.toUpperCase().startsWith("ERROR")) {
    return { ok: false, error: numero || "No se pudo convertir la cotización a contrato." };
  }

  revalidatePath("/dashboard/cotizaciones");
  revalidatePath(`/dashboard/cotizaciones/${cotizacionId}`);
  revalidatePath(`/cotizacion/${cotizacionId}`);
  revalidatePath("/dashboard/pagos");
  revalidatePath("/dashboard/flujo-caja");

  return { ok: true, numero };
}
