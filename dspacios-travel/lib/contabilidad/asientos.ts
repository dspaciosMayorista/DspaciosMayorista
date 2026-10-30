import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant.server";
import { resolverImporteContable63, MENSAJE_LECTURA_CXP_63, type FilaCxP63 } from "@/lib/reservar/importeObligacion63";

// ─────────────────────────────────────────────────────────────────────────
// Posteo automático a Libro diario desde el resto de la app (cuentas por
// pagar, pagos a proveedores, retenciones…). La FACTURA y el asiento de un
// ABONO no pasan por aquí: son RPC atómicas de la migración 208 (al final).
// Todo es BEST-EFFORT: la acción de negocio (registrar un abono, un pago…)
// nunca debe fallar por un problema de contabilidad — si falta una cuenta o
// algo no cuadra, se devuelve un error/aviso que el módulo que llama decide
// mostrar, pero el registro de negocio ya se hizo.
//
// Usa el cliente service-role para leer/escribir (igual criterio que sillas/
// costos al reservar): estos posteos los dispara gente sin permiso contable
// directo (ej. un asesor reservando o registrando un abono), así que no
// pueden depender de que su rol pase la RLS de `puc_cuentas`/`asientos_
// contables`. Si no hay service-role configurado, cae al cliente normal
// (funciona igual para roles contables; para los demás, el posteo falla
// silencioso — best-effort, nunca bloquea la acción de negocio).
// ─────────────────────────────────────────────────────────────────────────

export type LineaPosteo = { cuentaCodigo: string; tercero?: string | null; descripcion?: string | null; debe: number; haber: number };
// `tenant` es OPCIONAL: por defecto se deriva de getTenant() (contexto del
// actor que dispara el posteo — abonos, pagos, retenciones, todos disparados
// por un usuario operando en SU propia agencia). Cuando el posteo nace de
// convertir una COTIZACIÓN (reservarDesdeTarifario, convertirCotizacionManual-
// AContrato, convertirCotizacionCarrito), el tenant correcto es el de la
// cotización ya validada — que puede NO coincidir con el de la cookie de
// "agencia activa" del actor (ej. superadmin convirtiendo una cotización de
// la otra agencia) — por eso esas rutas deben pasarlo explícito.
type PosteoInput = { fecha: string; descripcion: string; origen: string; referencia: string; lineas: LineaPosteo[]; tenant?: string };
type PResult = { ok: true; id?: number } | { ok: false; error: string };
const TOL = 1;

async function db() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : await createClient();
}

// ── Cuentas del PUC usadas por los posteos automáticos (códigos estándar
// sembrados en la migración 126/127). Si el dueño las renombra/borra, el
// posteo falla con aviso — no se inventan cuentas nuevas solas.
export const CUENTA = {
  CAJA: "110505",
  BANCOS_COP: "111005",
  BANCOS_USD: "111010",
  CLIENTES: "130505",
  ANTICIPOS_CLIENTES: "280505",
  ANTICIPOS_SIN_IDENTIFICAR: "280510",
  INGRESOS_PROPIOS: "413505",
  IVA_GENERADO: "240802",
  IRT: "281510",
} as const;

// tipo_proveedor (cuentas_por_pagar.tipo_proveedor) → subcuenta de Proveedores/Costo.
const PROVEEDOR_CUENTA: Record<string, { proveedor: string; costo: string }> = {
  hotel:      { proveedor: "220505", costo: "613505" },
  aereo:      { proveedor: "220510", costo: "613510" },
  receptivo:  { proveedor: "220515", costo: "613515" },
  asistencia: { proveedor: "220520", costo: "613520" },
};
const PROVEEDOR_CUENTA_DEFAULT = { proveedor: "220595", costo: "613595" };
export function cuentasProveedor(tipoProveedor: string | null | undefined) {
  return PROVEEDOR_CUENTA[(tipoProveedor ?? "").trim().toLowerCase()] ?? PROVEEDOR_CUENTA_DEFAULT;
}

// Cuenta de caja/bancos según la forma de pago (efectivo → Caja; lo demás →
// Bancos) y la moneda (USD tiene su propia subcuenta de bancos).
export function cuentaDisponible(formaPago: string | null | undefined, moneda: string): string {
  const esEfectivo = /efectivo/i.test(formaPago ?? "");
  if (esEfectivo) return CUENTA.CAJA;
  return (moneda ?? "COP").toUpperCase() === "USD" ? CUENTA.BANCOS_USD : CUENTA.BANCOS_COP;
}

async function siguienteNumero(sb: Awaited<ReturnType<typeof db>>, tenant: string): Promise<number> {
  const { data } = await sb.from("asientos_contables").select("numero").eq("tenant", tenant).order("numero", { ascending: false }).limit(1).maybeSingle();
  return (data?.numero ?? 0) + 1;
}

function validar(lineas: LineaPosteo[]): string | null {
  if (lineas.length < 2) return "Un asiento necesita al menos 2 líneas.";
  let totalDebe = 0, totalHaber = 0;
  for (const l of lineas) {
    const debe = Number(l.debe) || 0, haber = Number(l.haber) || 0;
    if (debe > 0 && haber > 0) return "Una línea no puede tener débito y crédito a la vez.";
    if (debe <= 0 && haber <= 0) return "Cada línea necesita un valor en débito o en crédito.";
    totalDebe += debe; totalHaber += haber;
  }
  if (Math.abs(totalDebe - totalHaber) > TOL) return `El asiento no cuadra: débito ${Math.round(totalDebe)} vs crédito ${Math.round(totalHaber)}.`;
  return null;
}

// Quién dispara el posteo (para el rastro) — usa el cliente normal (cookies);
// si no hay sesión (ej. cron/service), queda null.
async function usuarioActual(): Promise<string | null> {
  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    return user?.email ?? null;
  } catch {
    return null;
  }
}

// Crea el asiento + líneas. Resuelve cada `cuentaCodigo` a su id (por tenant);
// si falta alguna cuenta, no crea nada y devuelve el error.
export async function postearAsiento(input: PosteoInput): Promise<PResult> {
  const activas = input.lineas.filter((l) => (Number(l.debe) || 0) + (Number(l.haber) || 0) > 0.5);
  const err = validar(activas);
  if (err) return { ok: false, error: err };

  const sb = await db();
  const tenant = input.tenant ?? await getTenant();

  const codigos = [...new Set(activas.map((l) => l.cuentaCodigo))];
  const { data: cuentas } = await sb.from("puc_cuentas").select("id, codigo").eq("tenant", tenant).in("codigo", codigos);
  const idPorCodigo = new Map((cuentas ?? []).map((c) => [c.codigo, c.id]));
  const faltante = codigos.find((c) => !idPorCodigo.has(c));
  if (faltante) return { ok: false, error: `Falta la cuenta ${faltante} en el Plan de cuentas para generar este asiento.` };

  const numero = await siguienteNumero(sb, tenant);
  const usuarioEmail = await usuarioActual();
  const { data: asiento, error: e1 } = await sb.from("asientos_contables").insert({
    tenant, numero, fecha: input.fecha, descripcion: input.descripcion,
    origen: input.origen, referencia: input.referencia, usuario_email: usuarioEmail,
  }).select("id").single();
  if (e1 || !asiento) return { ok: false, error: e1?.message ?? "No se pudo crear el asiento." };

  const { error: e2 } = await sb.from("asiento_lineas").insert(
    activas.map((l) => ({
      tenant, asiento_id: asiento.id, cuenta_id: idPorCodigo.get(l.cuentaCodigo)!,
      tercero: l.tercero?.trim() || null, descripcion: l.descripcion?.trim() || null,
      debe: Number(l.debe) || 0, haber: Number(l.haber) || 0,
    }))
  );
  if (e2) { await sb.from("asientos_contables").delete().eq("id", asiento.id); return { ok: false, error: e2.message }; }
  return { ok: true, id: asiento.id };
}

// REEMPLAZAR: borra cualquier asiento con ese origen+referencia (no ligado a
// una presentación externa, ej. DIAN) y postea el nuevo si se da uno.
// `tenant` (#30): la agencia del documento cuando se borra sin asiento nuevo;
// si no se da, la de la sesión (comportamiento de siempre).
export async function reemplazarAsiento(
  origen: string, referencia: string, nuevo: Omit<PosteoInput, "origen" | "referencia"> | null, tenantDoc?: string,
): Promise<PResult> {
  const sb = await db();
  const tenant = nuevo?.tenant ?? tenantDoc ?? await getTenant();
  const { error } = await sb.from("asientos_contables").delete().eq("tenant", tenant).eq("origen", origen).eq("referencia", referencia);
  if (error) return { ok: false, error: error.message };
  if (!nuevo) return { ok: true };
  return postearAsiento({ ...nuevo, tenant, origen, referencia });
}

// Importe contable de una CxP (#63): lo decide `resolverImporteContable63` sobre la fila REAL de la obligación. Una obligación de
// siempre se devenga por su `valorTotal`; una aceptada, por su equivalente en COP congelado (`valor_cop_63`). Un error de lectura
// NUNCA cae al nominal (un USD 210 no se registra como $210) ni se interpreta como "no es #63": se devuelve el error y la
// reconciliación (`listarCxpSinAsiento`) lo reintenta. #90 I (migración 236): una CxP en USD del carrito se devenga por su equivalente a la TRM de costos
// (`valor_cop_costo`), validado contra su valor y moneda; la reconciliación llega aquí por la misma lectura. Sin hueco para la columna ausente: la 227 va ANTES del código.
async function importeCopCxP(input: { cuentaId: number; numeroContrato: string; tenant?: string; valorTotal: number }): Promise<{ ok: true; importe: number } | { ok: false; error: string }> {
  const sb = await db();
  const { data, error } = await sb
    .from("cuentas_por_pagar")
    .select("numero_contrato, tenant, aceptacion_63_id, obligacion_63, valor_cop_63, trm_63, moneda, valor_cop_costo, trm_costo")
    .eq("id", input.cuentaId)
    .maybeSingle();
  if (error) return { ok: false, error: MENSAJE_LECTURA_CXP_63 };
  return resolverImporteContable63(data as FilaCxP63 | null, { numeroContrato: input.numeroContrato, tenant: input.tenant, valorTotal: input.valorTotal });
}

// Devengo de una cuenta por pagar recién creada: Debe Costo de ventas (según
// tipo_proveedor) / Haber Proveedores. Se llama justo después de insertar la
// fila en `cuentas_por_pagar`.
export async function postearAsientoCxP(input: {
  cuentaId: number; numeroContrato: string; tipoProveedor: string | null; proveedor: string | null; servicio: string | null;
  valorTotal: number; fecha: string; tenant?: string;
}): Promise<PResult> {
  const referencia = `cxp:${input.cuentaId}`;
  // #63: una obligación del modo COP con TRM (hotel/servicios en USD) lleva su equivalente en COP congelado a la TRM del
  // paquete (`valor_cop_63`, migración 227). El asiento se devenga por ESE importe: nunca por el nominal en dólares. Una
  // CxP de siempre no lo tiene y se devenga por `valorTotal`, como antes.
  const eq = await importeCopCxP({ cuentaId: input.cuentaId, numeroContrato: input.numeroContrato, tenant: input.tenant, valorTotal: input.valorTotal });
  if (!eq.ok) return eq;
  const importe = eq.importe;
  if (importe <= 0) return reemplazarAsiento("cxp", referencia, null);
  const cuentas = cuentasProveedor(input.tipoProveedor);
  // REEMPLAZAR: si ya existía un asiento para esta CxP (se está editando), se
  // borra y se postea de nuevo con los valores actuales — no está ligado a
  // ninguna presentación externa.
  return reemplazarAsiento("cxp", referencia, {
    fecha: input.fecha,
    descripcion: `${input.servicio ?? "Costo"} — ${input.proveedor ?? "Sin especificar"} (${input.numeroContrato})`,
    tenant: input.tenant,
    lineas: [
      { cuentaCodigo: cuentas.costo, tercero: input.numeroContrato, descripcion: input.servicio, debe: importe, haber: 0 },
      { cuentaCodigo: cuentas.proveedor, tercero: input.proveedor, descripcion: input.servicio, debe: 0, haber: importe },
    ],
  });
}

export async function eliminarAsientoCxP(cuentaId: number): Promise<PResult> {
  return reemplazarAsiento("cxp", `cxp:${cuentaId}`, null);
}

// Pago a un proveedor (reduce el pasivo): Debe Proveedores / Haber Caja/Bancos.
// `pagoId` = id de la fila en `cxp_pagos` (único por pago, nunca se reutiliza
// — a diferencia del viejo `slot` 1|2|3, que sí podía repetirse tras deshacer).
export async function postearAsientoPago(input: {
  cuentaId: number; pagoId: number; numeroContrato: string | null; tipoProveedor: string | null; proveedor: string | null;
  valor: number; formaPago: string | null; moneda: string; fecha: string;
}): Promise<PResult> {
  const referencia = `pago:${input.cuentaId}:${input.pagoId}`;
  if (input.valor <= 0) return reemplazarAsiento("pago_proveedor", referencia, null);
  const cuentas = cuentasProveedor(input.tipoProveedor);
  return reemplazarAsiento("pago_proveedor", referencia, {
    fecha: input.fecha,
    descripcion: `Pago a ${input.proveedor ?? "proveedor"}${input.numeroContrato ? ` (${input.numeroContrato})` : ""}`,
    lineas: [
      { cuentaCodigo: cuentas.proveedor, tercero: input.proveedor, descripcion: "Pago a proveedor", debe: input.valor, haber: 0 },
      { cuentaCodigo: cuentaDisponible(input.formaPago, input.moneda), tercero: input.proveedor, descripcion: "Pago a proveedor", debe: 0, haber: input.valor },
    ],
  });
}

export async function eliminarAsientoPago(cuentaId: number, pagoId: number): Promise<PResult> {
  return reemplazarAsiento("pago_proveedor", `pago:${cuentaId}:${pagoId}`, null);
}

// Retención practicada a un proveedor (reduce el pasivo vía retefuente, no
// vía caja/banco — simplificación: honorarios va a 236570, todo lo demás a
// 236540 "servicios").
export async function postearAsientoRetencion(input: {
  retencionId: number; tipoProveedor: string | null; proveedor: string | null; valor: number; fecha: string;
}): Promise<PResult> {
  if (input.valor <= 0) return { ok: true };
  const cuentas = cuentasProveedor(input.tipoProveedor);
  const cuentaRet = /honorari/i.test(input.tipoProveedor ?? "") ? "236570" : "236540";
  return postearAsiento({
    fecha: input.fecha,
    descripcion: `Retención practicada — ${input.proveedor ?? "proveedor"}`,
    origen: "retencion",
    referencia: `retencion:${input.retencionId}`,
    lineas: [
      { cuentaCodigo: cuentas.proveedor, tercero: input.proveedor, descripcion: "Retención en la fuente", debe: input.valor, haber: 0 },
      { cuentaCodigo: cuentaRet, tercero: input.proveedor, descripcion: "Retención practicada", debe: 0, haber: input.valor },
    ],
  });
}

// ── 208 · operaciones atómicas en PostgreSQL ─────────────────────────────
// La factura (emitir, quitar, marcar DIAN) y el asiento de un abono ya no se
// escriben con varias llamadas sueltas (RACE-1 / COMP-1): cada operación es UNA
// RPC transaccional de la migración 208, ejecutable solo con service_role. La
// Server Action deriva el actor de la sesión y la RPC lo revalida contra
// `usuarios` (activo, rol y agencia). Las guardas de la base rechazan cualquier
// escritura directa de asientos de factura o de abono (F4440 / F4421).

export type ErrorFinanciero = { ok: false; error: string; code?: string };

const MANTENIMIENTO = "La facturación está en mantenimiento: no se emitió, cambió ni retiró nada. Intenta más tarde.";
const MENSAJES_POR_CODIGO: Record<string, string> = {
  PGRST202: MANTENIMIENTO, // RPC retirada (retirada parcial de la 208)
  "42883": MANTENIMIENTO,
  "55P03": "Otra operación sobre este contrato está en curso; espera unos segundos y vuelve a intentar. No se cambió nada.",
  "42501": "No autorizado para esta operación.",
};

// error.code de PostgREST → mensaje para la pantalla. Los F44xx traen su
// propio texto ('FIN_CODIGO: …'); se muestra sin el prefijo técnico.
export function mensajeFinanciero(e: { code?: string | null; message?: string | null }): ErrorFinanciero {
  const code = e.code ?? "";
  if (/^F44\d\d$/.test(code)) return { ok: false, code, error: (e.message ?? "").replace(/^FIN_[A-Z_]+:\s*/, "") };
  if (MENSAJES_POR_CODIGO[code]) return { ok: false, code, error: MENSAJES_POR_CODIGO[code] };
  return { ok: false, ...(code ? { code } : {}), error: e.message || "Error desconocido de la base de datos." };
}

type ClienteRpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };

export async function rpcFinanciero<T>(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | ErrorFinanciero> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: "Falta la configuración del servidor (service role) para la operación contable; no se cambió nada." };
  }
  try {
    const { data, error } = await (createAdminClient() as unknown as ClienteRpc).rpc(fn, args);
    if (error) return mensajeFinanciero(error);
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// M1: el asiento de un abono lo escribe la RPC con el abono y la venta
// bloqueados — si el abono se borró mientras tanto, no queda asiento huérfano.
// La cuenta acreedora (Anticipos o Clientes) la decide la base con la factura
// vigente a la vista, y se conserva al re-postear.
export async function postearAsientoAbonoAtomico(abonoId: number, tenant: string, actor: string): Promise<{ ok: true } | ErrorFinanciero> {
  const r = await rpcFinanciero<{ estado: string }>("postear_asiento_abono", { p_abono_id: abonoId, p_tenant: tenant, p_actor: actor });
  return r.ok ? { ok: true } : r;
}
