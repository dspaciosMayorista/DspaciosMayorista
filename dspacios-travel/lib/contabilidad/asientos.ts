import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant.server";

// ─────────────────────────────────────────────────────────────────────────
// Posteo automático a Libro diario desde el resto de la app (abonos,
// facturación, cuentas por pagar, pagos a proveedores, retenciones…).
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
type PosteoInput = { fecha: string; descripcion: string; origen: string; referencia: string; lineas: LineaPosteo[] };
type PResult = { ok: true } | { ok: false; error: string };
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
  const tenant = await getTenant();

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
  return { ok: true };
}

// REEMPLAZAR: borra cualquier asiento con ese origen+referencia (no ligado a
// una presentación externa, ej. DIAN) y postea el nuevo si se da uno.
export async function reemplazarAsiento(origen: string, referencia: string, nuevo: Omit<PosteoInput, "origen" | "referencia"> | null): Promise<PResult> {
  const sb = await db();
  const tenant = await getTenant();
  await sb.from("asientos_contables").delete().eq("tenant", tenant).eq("origen", origen).eq("referencia", referencia);
  if (!nuevo) return { ok: true };
  return postearAsiento({ ...nuevo, origen, referencia });
}

// Devengo de una cuenta por pagar recién creada: Debe Costo de ventas (según
// tipo_proveedor) / Haber Proveedores. Se llama justo después de insertar la
// fila en `cuentas_por_pagar`.
export async function postearAsientoCxP(input: {
  cuentaId: number; numeroContrato: string; tipoProveedor: string | null; proveedor: string | null; servicio: string | null;
  valorTotal: number; fecha: string;
}): Promise<PResult> {
  const referencia = `cxp:${input.cuentaId}`;
  if (input.valorTotal <= 0) return reemplazarAsiento("cxp", referencia, null);
  const cuentas = cuentasProveedor(input.tipoProveedor);
  // REEMPLAZAR: si ya existía un asiento para esta CxP (se está editando), se
  // borra y se postea de nuevo con los valores actuales — no está ligado a
  // ninguna presentación externa.
  return reemplazarAsiento("cxp", referencia, {
    fecha: input.fecha,
    descripcion: `${input.servicio ?? "Costo"} — ${input.proveedor ?? "Sin especificar"} (${input.numeroContrato})`,
    lineas: [
      { cuentaCodigo: cuentas.costo, tercero: input.numeroContrato, descripcion: input.servicio, debe: input.valorTotal, haber: 0 },
      { cuentaCodigo: cuentas.proveedor, tercero: input.proveedor, descripcion: input.servicio, debe: 0, haber: input.valorTotal },
    ],
  });
}

export async function eliminarAsientoCxP(cuentaId: number): Promise<PResult> {
  return reemplazarAsiento("cxp", `cxp:${cuentaId}`, null);
}

// Pago a un proveedor (reduce el pasivo): Debe Proveedores / Haber Caja/Bancos.
export async function postearAsientoPago(input: {
  cuentaId: number; slot: 1 | 2 | 3; numeroContrato: string | null; tipoProveedor: string | null; proveedor: string | null;
  valor: number; formaPago: string | null; moneda: string; fecha: string;
}): Promise<PResult> {
  const referencia = `pago:${input.cuentaId}:${input.slot}`;
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

export async function eliminarAsientoPago(cuentaId: number, slot: 1 | 2 | 3): Promise<PResult> {
  return reemplazarAsiento("pago_proveedor", `pago:${cuentaId}:${slot}`, null);
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

// REVERSAR: para asientos que ya pudieron usarse en una presentación externa
// (ej. la factura ante la DIAN) — no se borran, se reversa el activo más
// reciente (líneas con débito/crédito invertidos, mismo origen+referencia,
// marcado `${origen}_reversion`) y se postea el nuevo encima. Así el rastro
// de la corrección queda en el libro diario.
export async function reversarYRegistrar(origen: string, referencia: string, nuevo: Omit<PosteoInput, "origen" | "referencia"> | null): Promise<PResult> {
  const sb = await db();
  const tenant = await getTenant();

  const { data: activo } = await sb
    .from("asientos_contables")
    .select("id, descripcion")
    .eq("tenant", tenant).eq("origen", origen).eq("referencia", referencia)
    .order("numero", { ascending: false }).limit(1).maybeSingle();

  if (activo) {
    const { data: lineasActivas } = await sb.from("asiento_lineas").select("cuenta_id, tercero, descripcion, debe, haber").eq("asiento_id", activo.id);
    if (lineasActivas?.length) {
      const numero = await siguienteNumero(sb, tenant);
      const usuarioEmail = await usuarioActual();
      const { data: rev } = await sb.from("asientos_contables").insert({
        tenant, numero, fecha: nuevo?.fecha ?? new Date().toISOString().slice(0, 10),
        descripcion: `Reversión — ${activo.descripcion}`, origen: `${origen}_reversion`, referencia, usuario_email: usuarioEmail,
      }).select("id").single();
      if (rev) {
        await sb.from("asiento_lineas").insert(
          lineasActivas.map((l) => ({ tenant, asiento_id: rev.id, cuenta_id: l.cuenta_id, tercero: l.tercero, descripcion: l.descripcion, debe: l.haber, haber: l.debe }))
        );
      }
    }
  }
  if (!nuevo) return { ok: true };
  return postearAsiento({ ...nuevo, origen, referencia });
}

// Anticipo NETO acumulado de un contrato (para el asiento de facturación).
export async function anticipoNetoDeContrato(numeroContrato: string): Promise<number> {
  const sb = await db();
  const tenant = await getTenant();
  const { data: cAnticipos } = await sb.from("puc_cuentas").select("id").eq("tenant", tenant).eq("codigo", CUENTA.ANTICIPOS_CLIENTES).maybeSingle();
  if (!cAnticipos) return 0;
  const { data: lineas } = await sb.from("asiento_lineas").select("debe, haber").eq("tenant", tenant).eq("cuenta_id", cAnticipos.id).eq("tercero", numeroContrato);
  return Math.max(0, (lineas ?? []).reduce((s, l) => s + (Number(l.haber) || 0) - (Number(l.debe) || 0), 0));
}
