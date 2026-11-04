// Se ejecuta con test:react. Alta asistida de aliados B2B (/dashboard/usuarios):
// acciones REALES contra un service-role simulado, y el portal REAL
// (contratosDelPortalB2B) con el perfil que dejó el alta.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "clave-de-prueba";
const { crearUsuario, crearAliadoB2B, buscarFichasAliado } = await import("../app/(dashboard)/dashboard/usuarios/actions.ts");
const { contratosDelPortalB2B, consultasPortalSupabase, COLUMNAS_DECISION } = await import("../lib/auth/contratosPortalB2B.ts");
const { supabaseEnMemoria } = await import("./support/memoriaSupabase.ts");
const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { __setAdmin, __resetAdmin } = await import("./support/stubs/supabaseAdminStub.mjs");

type Fila = Record<string, unknown>;
const sesion = (rol: string) => ({
  auth: { getUser: async () => ({ data: { user: { id: "u-s" } } }) },
  from: () => { const a = { select: () => a, eq: () => a, single: async () => ({ data: { rol }, error: null }) }; return a; },
});

// Admin simulado: `aliados` con fichas dadas; registra escrituras.
type Fallos = { ficha?: "error" | "lanzar"; auth?: "error" | "lanzar"; insertFicha?: boolean; dup?: "error" | "duplicado" };
function admin(fichas: Fila[], perfilFalla = false, fallos: Fallos = {}) {
  const ops: { tabla: string; op: string; payload?: Fila; filtros?: Record<string, unknown> }[] = [];
  const auth = { creados: 0, borrados: [] as string[] };
  const sb = {
    from(tabla: string) {
      const filtros: Record<string, unknown> = {};
      const q = { tabla, op: "select", payload: undefined as Fila | undefined, filtros };
      ops.push(q);
      const res = () => {
        if (q.op === "select") {
          if (tabla === "aliados") return { data: fichas.filter((f) => Object.entries(filtros).every(([k, v]) => f[k] === v)), error: null };
          if (tabla === "usuarios" && fallos.dup === "error") return { data: null, error: { message: "consulta simulada" } };
          if (tabla === "usuarios" && fallos.dup === "duplicado") return { data: { id: "otro" }, error: null };
          return { data: null, error: null };
        }
        if (fallos.insertFicha && q.op === "insert") return { data: null, error: { message: "insert simulado" } };
        if (q.op === "delete") {
          if (fallos.ficha === "lanzar") throw new Error("red caída");
          if (fallos.ficha === "error") return { data: null, error: { message: "delete simulado" } };
        }
        if (perfilFalla && q.op === "upsert") return { data: null, error: { message: "fallo simulado" } };
        return { data: [{ id: q.op === "insert" ? 99 : "nuevo" }], error: null };
      };
      const api = {
        select: () => api, in: () => api, ilike: () => api, limit: () => api, delete: () => { q.op = "delete"; return api; },
        eq: (k: string, v: unknown) => { filtros[k] = v; return api; },
        insert: (p: Fila) => { q.op = "insert"; q.payload = p; return api; },
        upsert: (p: Fila) => { q.op = "upsert"; q.payload = p; return api; },
        maybeSingle: async () => res(),
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, ko),
      };
      return api;
    },
    auth: { admin: {
      createUser: async () => { auth.creados++; return { data: { user: { id: "nuevo" } }, error: null }; },
      deleteUser: async (id: string) => { auth.borrados.push(id);
        if (fallos.auth === "lanzar") throw new Error("auth caído");
        return { data: {}, error: fallos.auth === "error" ? { message: "auth simulado" } : null }; },
    } },
  };
  return { sb, ops, auth };
}
afterEach(() => { __resetClient(); __resetAdmin(); });

const FICHA = { id: 7, nombre: "Viajes Antiguos", nit: "900123", tipo_documento: "NIT", email: null };
const base = { tipo: "agencia" as const, nombre: "Viajes Nuevos", email: "A@x.co", password: "secreta1", tipoDocumento: "NIT", documento: "900123", contacto: "", telefono: "" };
const upsertDe = (ops: { op: string; payload?: Fila }[]) => ops.find((o) => o.op === "upsert")?.payload;

test("interno: rechaza roles B2B (flujo separado) y conserva los internos", async () => {
  __setClient(sesion("superadmin") as never);
  const a = admin([]); __setAdmin(a.sb);
  const r = await crearUsuario({ email: "x@t", password: "secreta1", nombre: "X", rol: "agencia" });
  assert.equal(r.ok, false);
  assert.equal(a.auth.creados, 0);
  assert.deepEqual(await crearUsuario({ email: "x@t", password: "secreta1", nombre: "X", rol: "venta" }), { ok: true });
});

test("buscar por documento: devuelve TODAS las coincidencias, sin elegir", async () => {
  __setClient(sesion("administracion") as never);
  __setAdmin(admin([FICHA, { ...FICHA, id: 8 }, { ...FICHA, id: 9, nit: "otro" }]).sb);
  const r = await buscarFichasAliado("900123");
  assert.ok(r.ok && r.fichas.map((f) => f.id).join() === "7,8");
});

test("aliado B2B: sin confirmación explícita no crea nada", async () => {
  __setClient(sesion("superadmin") as never);
  const a = admin([FICHA]); __setAdmin(a.sb);
  const r = await crearAliadoB2B({ ...base, enlace: null });
  assert.equal(r.ok, false);
  assert.equal(a.auth.creados, 0);
});

test("aliado B2B: enlazar ficha guarda usuarios.aliado_id; el id debe corresponder al documento", async () => {
  __setClient(sesion("superadmin") as never);
  const a = admin([FICHA]); __setAdmin(a.sb);
  assert.deepEqual(await crearAliadoB2B({ ...base, enlace: { modo: "ficha", aliadoId: 7 } }), { ok: true });
  const u = upsertDe(a.ops)!;
  assert.deepEqual([u.rol, u.aliado_id, u.activo, u.acceso_legacy_nombre], ["agencia", 7, true, false]);

  const b = admin([FICHA]); __setAdmin(b.sb);
  const mal = await crearAliadoB2B({ ...base, enlace: { modo: "ficha", aliadoId: 123 } }); // ficha de otro documento
  assert.equal(mal.ok, false);
  assert.equal(b.auth.creados, 0);
});

test("aliado B2B: ficha nueva explícita se crea y se enlaza", async () => {
  __setClient(sesion("administracion") as never);
  const a = admin([]); __setAdmin(a.sb);
  assert.deepEqual(await crearAliadoB2B({ ...base, tipo: "freelance", tipoDocumento: "CC", enlace: { modo: "nueva" } }), { ok: true });
  const ins = a.ops.find((o) => o.op === "insert")!.payload!;
  assert.deepEqual([ins.nit, ins.tipo_documento, ins.tipo], ["900123", "CC", "freelance"]);
  assert.equal(upsertDe(a.ops)!.aliado_id, 99);
});

test("aliado B2B: sin rol de gestión no crea nada", async () => {
  __setClient(sesion("gerencia") as never);
  const a = admin([FICHA]); __setAdmin(a.sb);
  assert.equal((await crearAliadoB2B({ ...base, enlace: { modo: "ficha", aliadoId: 7 } })).ok, false);
  assert.equal(a.auth.creados, 0);
});

// ── Portal: lo que ve la cuenta que dejó el alta ───────────────────────────
test("portal: la cuenta enlazada ve los contratos de Minorista por aliado_id; la no enlazada, ninguno", async () => {
  const v = (n: string, e: Fila): Fila => ({ numero_contrato: n, tenant: "minorista", aliado_id: null, b2b_usuario_id: null, agencia_nombre: null, freelance_nombre: null, fecha_salida: "2026-01-01", ...e });
  const ventas = [v("MIN-1", { aliado_id: 7, agencia_nombre: "Viajes Nuevos" }), v("MIN-2", { aliado_id: 9 }), v("MIN-3", { agencia_nombre: "Viajes Nuevos" })];
  const listar = async (aliadoId: number | null) => {
    const db = supabaseEnMemoria({ ventas, aliados_b2b: [] });
    const r = await contratosDelPortalB2B(
      { id: "nuevo", rol: "agencia", tenant: "mayorista", activo: true, nombre: "Viajes Nuevos", aliadoId, accesoLegacyNombre: false },
      consultasPortalSupabase(db as never, COLUMNAS_DECISION),
    );
    return r.contratos.map((c: { numero_contrato: string }) => c.numero_contrato);
  };
  assert.deepEqual(await listar(7), ["MIN-1"]);
  assert.deepEqual(await listar(null), []);
});

// ── Fallo al guardar el perfil ─────────────────────────────────────────────
const borradosDeAliados = (ops: { tabla: string; op: string; filtros?: Record<string, unknown> }[]) =>
  ops.filter((o) => o.tabla === "aliados" && o.op === "delete").map((o) => o.filtros);

test("perfil falla con ficha NUEVA: borra la cuenta Auth y esa ficha (por su id)", async () => {
  __setClient(sesion("superadmin") as never);
  const a = admin([], true); __setAdmin(a.sb);
  const r = await crearAliadoB2B({ ...base, enlace: { modo: "nueva" } });
  assert.equal(r.ok, false);
  assert.deepEqual(a.auth.borrados, ["nuevo"]);
  assert.deepEqual(borradosDeAliados(a.ops), [{ id: 99 }]);
});

test("perfil falla con ficha PREEXISTENTE: borra la cuenta Auth, jamás la ficha", async () => {
  __setClient(sesion("superadmin") as never);
  const a = admin([FICHA], true); __setAdmin(a.sb);
  const r = await crearAliadoB2B({ ...base, enlace: { modo: "ficha", aliadoId: 7 } });
  assert.equal(r.ok, false);
  assert.deepEqual(a.auth.borrados, ["nuevo"]);
  assert.deepEqual(borradosDeAliados(a.ops), []);
});

// ── Fallos DURANTE la limpieza: nunca se informa limpieza terminada si no lo está ─────────
const LIMPIA = /No se creó la cuenta./;
const NO_TERMINO = /La limpieza NO terminó/;
for (const modo of ["error", "lanzar"] as const) {
  test(`limpieza: falla el borrado de la ficha nueva (${modo}) → se intenta la cuenta Auth y se reporta la ficha pendiente`, async () => {
    __setClient(sesion("superadmin") as never);
    const a = admin([], true, { ficha: modo }); __setAdmin(a.sb);
    const r = await crearAliadoB2B({ ...base, enlace: { modo: "nueva" } });
    assert.equal(r.ok, false);
    const msg = r.ok ? "" : r.error;
    assert.match(msg, NO_TERMINO);
    assert.match(msg, /ficha de aliado #99/);
    assert.doesNotMatch(msg, /cuenta Auth/, "la cuenta sí se borró");
    assert.doesNotMatch(msg, LIMPIA);
    assert.deepEqual(a.auth.borrados, ["nuevo"], "el fallo de la ficha no impide borrar la cuenta");
  });

  test(`limpieza: falla el borrado de la cuenta Auth (${modo}) → se reporta la cuenta pendiente (ficha preexistente intacta)`, async () => {
    __setClient(sesion("superadmin") as never);
    const a = admin([FICHA], true, { auth: modo }); __setAdmin(a.sb);
    const r = await crearAliadoB2B({ ...base, enlace: { modo: "ficha", aliadoId: 7 } });
    const msg = r.ok ? "" : r.error;
    assert.match(msg, NO_TERMINO);
    assert.match(msg, /cuenta Auth nuevo \(a@x\.co\)/);
    assert.doesNotMatch(msg, LIMPIA);
    assert.deepEqual(borradosDeAliados(a.ops), [], "jamás se borra una ficha preexistente");
  });
}

test("limpieza: fallan AMBOS borrados → el error lista los dos recursos pendientes", async () => {
  __setClient(sesion("superadmin") as never);
  const a = admin([], true, { ficha: "error", auth: "error" }); __setAdmin(a.sb);
  const r = await crearAliadoB2B({ ...base, enlace: { modo: "nueva" } });
  const msg = r.ok ? "" : r.error;
  assert.match(msg, /ficha de aliado #99; cuenta Auth nuevo/);
  assert.match(msg, NO_TERMINO);
});

test("limpieza: falla el INSERT de la ficha nueva y también el borrado de la cuenta → reporta solo la cuenta", async () => {
  __setClient(sesion("superadmin") as never);
  const a = admin([], false, { insertFicha: true, auth: "error" }); __setAdmin(a.sb);
  const r = await crearAliadoB2B({ ...base, enlace: { modo: "nueva" } });
  const msg = r.ok ? "" : r.error;
  assert.match(msg, NO_TERMINO);
  assert.match(msg, /cuenta Auth nuevo/);
  assert.doesNotMatch(msg, /ficha de aliado/);
  assert.deepEqual(borradosDeAliados(a.ops), [], "no hubo ficha que borrar");
});

test("limpieza exitosa: el mensaje sí dice que no se creó la cuenta (y no habla de pendientes)", async () => {
  __setClient(sesion("superadmin") as never);
  const a = admin([], true); __setAdmin(a.sb);
  const r = await crearAliadoB2B({ ...base, enlace: { modo: "nueva" } });
  const msg = r.ok ? "" : r.error;
  assert.match(msg, LIMPIA);
  assert.doesNotMatch(msg, NO_TERMINO);
});

// ── Verificación de nombre duplicado ──────────────────────────────────────
test("falla la consulta de nombre duplicado → error claro y NO se crea la cuenta Auth ni la ficha", async () => {
  __setClient(sesion("superadmin") as never);
  const a = admin([], false, { dup: "error" }); __setAdmin(a.sb);
  const r = await crearAliadoB2B({ ...base, enlace: { modo: "nueva" } });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /No se pudo verificar si ya existe un aliado/);
  assert.equal(a.auth.creados, 0);
  assert.ok(!a.ops.some((o) => o.op === "insert" || o.op === "upsert"), "sin escrituras");
});

test("nombre duplicado encontrado → rechaza sin crear la cuenta", async () => {
  __setClient(sesion("superadmin") as never);
  const a = admin([], false, { dup: "duplicado" }); __setAdmin(a.sb);
  const r = await crearAliadoB2B({ ...base, enlace: { modo: "nueva" } });
  assert.match(r.ok ? "" : r.error, /Ya existe un aliado/);
  assert.equal(a.auth.creados, 0);
});
