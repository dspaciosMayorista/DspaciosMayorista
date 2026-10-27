// Se ejecuta con npm run test:react (loader TSX/esbuild), no con test:unit.
// 248 · Server Actions REALES `registrarAbono` (revalidación del pago adicional en el servidor) y `anularAbono`
// (actor de la sesión, agencia del contrato, motivo y mensajes específicos). Solo se simulan las fronteras:
// Supabase (una BD mínima en memoria), next/cache, el tenant y los módulos que no participan.
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = {
  "server-only": "export {}",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const src = MODULOS_MINIMOS[specifier];
    if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";

type Fila = Record<string, unknown>;
const db: { venta: Fila | null; abonos: Fila[]; rpcs: Array<{ fn: string; args: Record<string, unknown> }>; sesion: boolean; rpcAnular: { data: unknown; error: { code?: string; message?: string } | null }; rpcRegistro: { data: unknown; error: { code?: string; message?: string } | null } } = {
  venta: null, abonos: [], rpcs: [], sesion: true, rpcAnular: { data: { estado: "anulado" }, error: null }, rpcRegistro: { data: { estado: "registrado", abono_id: 1 }, error: null },
};
function venta(extra: Fila = {}): Fila {
  return { numero_contrato: "00-0451", estado: "activo", precio_venta: 1_800_000, tipo_paquete: "dinamico", moneda: "COP", tenant: "mayorista",
    financiero_estado: "completo", moneda_cobro: null, trm_cobro: null, total_cobro: null, ...extra };
}
let seq = 100;
function tabla(nombre: string) {
  const filtros: Array<[string, unknown]> = [];
  const filas = (): Fila[] => {
    const base = nombre === "abonos" ? db.abonos : nombre === "ventas" ? (db.venta ? [db.venta] : []) : [];
    return base.filter((r) => filtros.every(([c, v]) => r[c] === v));
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { filtros.push([c, v]); return b; },
    maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve({ data: filas(), error: null }).then(ok, ko),
    insert: (obj: Fila) => ({
      select: () => ({ single: async () => { const fila = { id: ++seq, ...obj }; db.abonos.push(fila); return { data: { id: fila.id }, error: null }; } }),
    }),
    update: () => ({ eq: async () => ({ error: null }) }),
  };
  return b;
}
const sb = {
  from: (n: string) => tabla(n),
  auth: { getUser: async () => ({ data: { user: db.sesion ? { id: "u-1", email: "caja@dspacios.test" } : null }, error: null }) },
  rpc: async (fn: string, args: Record<string, unknown>) => {
    db.rpcs.push({ fn, args });
    if (fn === "anular_abono") return db.rpcAnular;
    if (fn === "registrar_abono") return db.rpcRegistro;
    return { data: { estado: "contabilizado" }, error: null };
  },
};
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => sb } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => sb } });
mock.module("@/lib/tenant.server", { namedExports: { getTenant: async () => "mayorista", agenciaDe: async () => null } });
mock.module("@/lib/contrato/numeracion", { namedExports: { siguienteNumeroContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/reservar/asegurarCuentasPorPagar", { namedExports: { asegurarCuentasPorPagar: async () => {} } });

const acciones = await import("../app/(dashboard)/dashboard/contratos/actions.ts");
const { registrarAbono, anularAbono } = acciones;
const abonoDe = (valor: number, extra: Fila = {}): Fila => ({ id: ++seq, numero_contrato: "00-0451", valor_abono: valor, monto_cop: valor, ...extra });

beforeEach(() => {
  db.venta = venta();
  db.abonos = [];
  db.rpcs = [];
  db.sesion = true;
  db.rpcAnular = { data: { estado: "anulado" }, error: null };
  db.rpcRegistro = { data: { estado: "registrado", abono_id: 1 }, error: null };
});

// ── Registro: la decisión (¿ya pagado? ¿confirmado? ¿misma operación?) la toma la RPC de la base bajo el bloqueo de la venta.
// Aquí solo se comprueba que la Server Action valida, manda lo correcto e interpreta cada respuesta; la atomicidad y las
// carreras se prueban contra Postgres real en supabase/scripts/test_248_anular_abono.sql y test_248_carrera.sh.
const OP = "00000000-0000-4000-8000-0000000a0001";
const ultimaRpc = () => db.rpcs.filter((x) => x.fn === "registrar_abono").at(-1)!;

test("contrato con saldo: una RPC, sin confirmación pedida, con la operación y los datos normalizados", async () => {
  const r = await registrarAbono("00-0451", 100_000, "Transferencia", "R-1", undefined, "2026-09-30", undefined, OP);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(ultimaRpc().args, {
    p_numero: "00-0451", p_tenant: "mayorista", p_actor: "u-1", p_monto_cop: 100_000, p_trm: null,
    p_forma: "Transferencia", p_ref: "R-1", p_fecha: "2026-09-30", p_confirmar: false, p_operacion: OP,
  });
  assert.equal(db.abonos.length, 0, "la Server Action ya NO inserta: lo hace la RPC en su transacción");
});

test("la base responde requiere_confirmacion → no ok, con contrato visible, total, pagado y nuevo abono", async () => {
  db.rpcRegistro = { data: { estado: "requiere_confirmacion", contrato: "00-0451", total: 1_800_000, pagado: 1_800_000, nuevo: 100_000, moneda: "COP" }, error: null };
  const r = await registrarAbono("00-0451", 100_000, "Transferencia", "R-2", undefined, undefined, false, OP);
  assert.equal(r.ok, false);
  assert.deepEqual(r.confirmacion, { contrato: "00-0451", total: 1_800_000, pagado: 1_800_000, nuevo: 100_000, moneda: "COP" });
  assert.match(r.error ?? "", /ya está pagado/);
  assert.equal(ultimaRpc().args.p_confirmar, false);
});

test("confirmado: se manda p_confirmar=true con la MISMA operación", async () => {
  const r = await registrarAbono("00-0451", 100_000, "Transferencia", "R-3", undefined, undefined, true, OP);
  assert.deepEqual(r, { ok: true });
  assert.equal(ultimaRpc().args.p_confirmar, true);
  assert.equal(ultimaRpc().args.p_operacion, OP);
});

test("ya_registrado (doble pulsación) responde ok sin tocar nada más", async () => {
  db.rpcRegistro = { data: { estado: "ya_registrado", abono_id: 7 }, error: null };
  assert.deepEqual(await registrarAbono("00-0451", 100_000, "Efectivo", "", undefined, undefined, false, OP), { ok: true });
});

test("si el asiento falla, el abono queda registrado y se avisa (no se pierde el cobro)", async () => {
  db.rpcRegistro = { data: { estado: "registrado", abono_id: 9, asiento_error: "Falta la cuenta 280505" }, error: null };
  const r = await registrarAbono("00-0451", 100_000, "Efectivo", "", undefined, undefined, false, OP);
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /El abono quedó registrado, pero su asiento contable no: Falta la cuenta 280505/);
});

test("ya_registrado con asiento_error (reintento tras un fallo del asiento): NO es éxito, informa el estado contable real", async () => {
  db.rpcRegistro = { data: { estado: "ya_registrado", abono_id: 9, asiento_error: "Falta la cuenta 280505" }, error: null };
  const r = await registrarAbono("00-0451", 100_000, "Efectivo", "", undefined, undefined, false, OP);
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /El abono quedó registrado, pero su asiento contable no: Falta la cuenta 280505/);
  assert.match(r.error ?? "", /no duplica el abono/);
});

test("operación no válida → no llama a la base", async () => {
  const r = await registrarAbono("00-0451", 100_000, "Efectivo", "", undefined, undefined, false, "no-es-uuid");
  assert.equal(r.ok, false);
  assert.deepEqual(db.rpcs, []);
});

test("sin sesión, contrato pendiente de registro financiero o USD sin TRM → no llama a la base", async () => {
  db.sesion = false;
  assert.deepEqual(await registrarAbono("00-0451", 100_000, "Efectivo", ""), { ok: false, error: "Sesión no válida." });
  db.sesion = true;
  db.venta = venta({ financiero_estado: "pendiente" });
  assert.match((await registrarAbono("00-0451", 100_000, "Efectivo", "")).error ?? "", /pendiente su registro financiero/);
  db.venta = venta({ moneda: "USD", precio_venta: 1000 });
  assert.match((await registrarAbono("00-0451", 4_000_000, "Efectivo", "")).error ?? "", /TRM/);
  assert.deepEqual(db.rpcs, []);
});

test("contrato USD: manda la TRM; contrato COP: manda null (la base usa 1)", async () => {
  db.venta = venta({ moneda: "USD", precio_venta: 1000 });
  await registrarAbono("00-0451", 4_000_000, "Transferencia", "", 4000, undefined, false, OP);
  assert.equal(ultimaRpc().args.p_trm, 4000);
});

for (const [codigo, mensaje, esperado] of [
  ["F4466", "FIN_OPERACION_DISTINTA: esa operación ya se registró con otros datos; genera una operación nueva.", /operación ya se registró con otros datos/],
  ["F4468", "FIN_OPERACION_ANULADA: el abono de esa operación ya fue anulado; si de verdad es un pago nuevo, regístralo como una operación nueva.", /ya fue anulado/],
  ["F4402", "FIN_OTRA_AGENCIA: el contrato es de la agencia mayorista, que no es la tuya.", /no es la tuya/],
  ["F4401", "FIN_NO_AUTORIZADO: el usuario no está autorizado para esta operación.", /no está autorizado/],
] as const) {
  test(`registrarAbono: ${codigo} llega con su mensaje específico (sin prefijo técnico)`, async () => {
    db.rpcRegistro = { data: null, error: { code: codigo, message: mensaje } };
    const r = await registrarAbono("00-0451", 100_000, "Efectivo", "", undefined, undefined, false, OP);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", esperado);
    assert.doesNotMatch(r.error ?? "", /^FIN_/);
  });
}

// ── Anulación ───────────────────────────────────────────────────────────
test("anularAbono: deriva el actor de la sesión, toma la agencia del CONTRATO y recorta el motivo", async () => {
  db.venta = venta({ tenant: "minorista" });
  const r = await anularAbono(41, "00-0451", "  Abono duplicado  ");
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(db.rpcs, [{ fn: "anular_abono", args: { p_abono_id: 41, p_numero: "00-0451", p_tenant: "minorista", p_actor: "u-1", p_motivo: "Abono duplicado" } }]);
});

test("anularAbono: sin sesión, sin motivo o contrato inexistente → no llama a la base", async () => {
  db.sesion = false;
  assert.deepEqual(await anularAbono(41, "00-0451", "duplicado"), { ok: false, error: "Sesión no válida." });
  db.sesion = true;
  assert.equal((await anularAbono(41, "00-0451", " ")).ok, false);
  db.venta = null;
  assert.deepEqual(await anularAbono(41, "00-9999", "duplicado"), { ok: false, error: "Contrato no encontrado." });
  assert.deepEqual(db.rpcs, []);
});

for (const [codigo, mensaje, esperado] of [
  ["F4460", "FIN_ABONO_PAGO_PREVIO: el abono 41 viene de un pago previo aplicado desde la cotización; no se anula desde el contrato. No se cambió nada.", /pago previo aplicado/],
  ["F4461", "FIN_ABONO_CONCILIADO: el abono 41 está conciliado con el extracto bancario; deshaz el cruce en Conciliaciones antes de anularlo. No se cambió nada.", /deshaz el cruce en Conciliaciones/],
  ["F4418", "FIN_ANTICIPO_APLICADO: la factura vigente de 00-0451 ya aplicó el anticipo de este abono; quita la factura antes de anularlo. No se cambió nada.", /quita la factura/],
  ["F4402", "FIN_OTRA_AGENCIA: el contrato es de la agencia mayorista, que no es la tuya.", /no es la tuya/],
  ["F4401", "FIN_NO_AUTORIZADO: el usuario no está autorizado para esta operación.", /no está autorizado/],
] as const) {
  test(`anularAbono: ${codigo} llega a la pantalla con su mensaje específico (sin prefijo técnico)`, async () => {
    db.rpcAnular = { data: null, error: { code: codigo, message: mensaje } };
    const r = await anularAbono(41, "00-0451", "duplicado");
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", esperado);
    assert.doesNotMatch(r.error ?? "", /^FIN_/);
  });
}

test("eliminarAbono ya no existe: la única salida es anular (con huella y asiento atómico)", () => {
  assert.equal("eliminarAbono" in acciones, false);
  assert.equal(typeof anularAbono, "function");
});
