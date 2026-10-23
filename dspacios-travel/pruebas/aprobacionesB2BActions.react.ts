// Se ejecuta con npm run test:react (loader TSX/esbuild), no con test:unit.
// Ejecuta las Server Actions REALES del flujo B2B endurecido (migración 193)
// contra clientes simulados:
//   · aprobarSolicitudB2B / rechazarSolicitudB2B: delegan en las RPC atómicas
//     con la SESIÓN de quien aprueba (nunca service-role), mapean el modo de
//     enlace, cortan antes de la RPC si no hay permiso, y no filtran errores
//     internos.
//   · crearUsuario (alta interna): el rol no viaja en la metadata; fija rol y
//     `activo` explícitos y, si el perfil no queda confirmado, borra la cuenta.
//   · crearAgente (portal): mismo cierre; nunca deja un `agencia` sin
//     `agencia_id` (sería un titular) a medias.
// Los casos de base de datos (permisos efectivos, trigger, doble aprobación,
// concurrencia) están en supabase/scripts/pruebas/test_193_registro_b2b.sh.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "clave-de-prueba";

const { aprobarSolicitudB2B, rechazarSolicitudB2B } = await import("../app/(dashboard)/dashboard/usuarios/b2b/actions.ts");
const { crearUsuario } = await import("../app/(dashboard)/dashboard/usuarios/actions.ts");
const { crearAgente } = await import("../app/portal/b2b/agentes/actions.ts");
const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { __setAdmin, __resetAdmin } = await import("./support/stubs/supabaseAdminStub.mjs");
const { __revalidadas, __resetRevalidadas } = await import("./support/stubs/nextCacheStub.mjs");

type RpcLlamada = { nombre: string; args: Record<string, unknown> };

// Cliente de SESIÓN simulado: usuario autenticado con un perfil dado.
function sesion(perfil: Record<string, unknown> | null, rpcRespuesta: { error: unknown } = { error: null }) {
  const rpcs: RpcLlamada[] = [];
  const sb = {
    auth: { getUser: async () => ({ data: { user: perfil ? { id: "u-sesion", email: "yo@t" } : null } }) },
    from: () => {
      const api = {
        select: () => api, eq: () => api,
        maybeSingle: async () => ({ data: perfil, error: null }),
        single: async () => ({ data: perfil, error: null }),
      };
      return api;
    },
    rpc: async (nombre: string, args: Record<string, unknown>) => { rpcs.push({ nombre, args }); return { data: null, ...rpcRespuesta }; },
  };
  return { sb, rpcs };
}

// Cliente service-role simulado para altas.
function adminFalso(opts: { perfilFilas?: number; perfilError?: boolean; dup?: boolean } = {}) {
  const ops: { tabla: string; op: string; payload: unknown }[] = [];
  const auth = { creados: [] as Record<string, unknown>[], borrados: [] as string[] };
  const sb = {
    from(tabla: string) {
      const q = { tabla, op: "select", payload: null as unknown };
      ops.push(q);
      const res = () => {
        if (q.op === "select") return { data: opts.dup ? { id: "dup" } : null, error: null };
        if (opts.perfilError) return { data: null, error: { message: "fallo simulado" } };
        return { data: Array.from({ length: opts.perfilFilas ?? 1 }, () => ({ id: "nuevo" })), error: null };
      };
      const api = {
        select: () => api, eq: () => api, in: () => api, ilike: () => api, limit: () => api,
        update: (p: unknown) => { q.op = "update"; q.payload = p; return api; },
        upsert: (p: unknown) => { q.op = "upsert"; q.payload = p; return api; },
        maybeSingle: async () => res(),
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, ko),
      };
      return api;
    },
    auth: {
      admin: {
        createUser: async (a: Record<string, unknown>) => { auth.creados.push(a); return { data: { user: { id: "nuevo" } }, error: null }; },
        deleteUser: async (id: string) => { auth.borrados.push(id); return { data: {}, error: null }; },
      },
    },
  };
  return { sb, ops, auth };
}

afterEach(() => { __resetClient(); __resetAdmin(); __resetRevalidadas(); });

// ── Aprobación / rechazo ──────────────────────────────────────────────────
test("aprobar: cada elección del panel llega a la RPC atómica con el modo correcto, por la sesión", async () => {
  const casos: [number | "nueva" | null | undefined, Record<string, unknown>][] = [
    [42, { p_id: 7, p_modo: "ficha", p_aliado_id: 42 }],
    ["nueva", { p_id: 7, p_modo: "nueva", p_aliado_id: null }],
    [null, { p_id: 7, p_modo: "ninguno", p_aliado_id: null }],
    [undefined, { p_id: 7, p_modo: "sugerido", p_aliado_id: null }],
  ];
  for (const [eleccion, esperado] of casos) {
    const { sb, rpcs } = sesion({ rol: "gerencia" });
    __setClient(sb);
    assert.deepEqual(await aprobarSolicitudB2B(7, eleccion), { ok: true });
    assert.deepEqual(rpcs, [{ nombre: "aprobar_solicitud_b2b", args: esperado }], `elección ${String(eleccion)}`);
  }
  assert.ok(__revalidadas().includes("/dashboard/usuarios/b2b"));
});

test("aprobar/rechazar: sin sesión o sin rol b2b no se llama ninguna RPC", async () => {
  for (const perfil of [null, { rol: "venta" }, { rol: "operaciones" }, { rol: "agencia" }]) {
    const { sb, rpcs } = sesion(perfil);
    __setClient(sb);
    const a = await aprobarSolicitudB2B(7, 1);
    const r = await rechazarSolicitudB2B(7);
    assert.equal(a.ok, false);
    assert.equal(r.ok, false);
    assert.deepEqual(rpcs, [], `perfil ${JSON.stringify(perfil)}`);
  }
});

test("aprobar: ficha con id inválido se corta antes de la RPC", async () => {
  for (const malo of [0, -3, 1.5, Number.NaN]) {
    const { sb, rpcs } = sesion({ rol: "superadmin" });
    __setClient(sb);
    assert.equal((await aprobarSolicitudB2B(7, malo)).ok, false);
    assert.deepEqual(rpcs, []);
  }
});

test("errores de la RPC: los esperables se muestran; los internos no se filtran", async () => {
  const casos: [{ code: string; message: string }, RegExp][] = [
    [{ code: "55000", message: "La solicitud ya fue procesada (estado: aprobada)." }, /ya fue procesada/],
    [{ code: "55000", message: "El correo de la cuenta no coincide con el de la solicitud; no se aprueba." }, /correo/],
    [{ code: "42501", message: "detalle interno" }, /No tienes permiso/],
    [{ code: "XX000", message: "relation public.secreta does not exist" }, /^No se pudo completar la operación/],
  ];
  for (const [error, esperado] of casos) {
    const { sb } = sesion({ rol: "administracion" }, { error });
    __setClient(sb);
    const r = await aprobarSolicitudB2B(7, null);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, esperado);
    assert.doesNotMatch((r as { error: string }).error, /secreta|detalle interno/);
  }
  assert.deepEqual(__revalidadas(), [], "si falla no se revalida como si hubiera cambiado");
});

test("rechazar: usa la RPC de rechazo por la sesión", async () => {
  const { sb, rpcs } = sesion({ rol: "gerencia" });
  __setClient(sb);
  assert.deepEqual(await rechazarSolicitudB2B(9), { ok: true });
  assert.deepEqual(rpcs, [{ nombre: "rechazar_solicitud_b2b", args: { p_id: 9 } }]);
});

test("wiring: la aprobación ya no usa service-role, ni busca por correo, ni escribe usuarios", () => {
  const fuente = readFileSync(new URL("../app/(dashboard)/dashboard/usuarios/b2b/actions.ts", import.meta.url), "utf8")
    .replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(fuente, /createAdminClient|supabase\/admin/);
  assert.doesNotMatch(fuente, /\.eq\(\s*"email"/);
  assert.doesNotMatch(fuente, /from\(\s*"usuarios"\s*\)|from\(\s*"b2b_solicitudes"\s*\)/);
  assert.match(fuente, /rpc\("aprobar_solicitud_b2b"/);
  assert.match(fuente, /rpc\("rechazar_solicitud_b2b"/);
});

// ── Alta interna ──────────────────────────────────────────────────────────
test("crearUsuario: el rol no viaja en la metadata; el perfil se fija activo y con su rol", async () => {
  __setClient(sesion({ rol: "superadmin" }).sb);
  const { sb, ops, auth } = adminFalso();
  __setAdmin(sb);
  const r = await crearUsuario({ email: "nuevo@t", password: "secreta1", nombre: "Nuevo", rol: "gerencia" });
  assert.deepEqual(r, { ok: true });
  assert.equal(auth.creados.length, 1);
  assert.equal((auth.creados[0].user_metadata as Record<string, unknown>).rol, undefined, "sin rol en la metadata");
  const up = ops.find((o) => o.op === "upsert")!.payload as Record<string, unknown>;
  assert.equal(up.rol, "gerencia");
  assert.equal(up.activo, true);
  assert.deepEqual(auth.borrados, []);
});

for (const [caso, opts] of [["error", { perfilError: true }], ["0 filas", { perfilFilas: 0 }]] as const) {
  test(`crearUsuario: perfil no confirmado (${caso}) → borra la cuenta y falla`, async () => {
    __setClient(sesion({ rol: "administracion" }).sb);
    const { sb, auth } = adminFalso(opts);
    __setAdmin(sb);
    const r = await crearUsuario({ email: "nuevo@t", password: "secreta1", nombre: "Nuevo", rol: "venta" });
    assert.equal(r.ok, false);
    assert.deepEqual(auth.borrados, ["nuevo"]);
  });
}

test("crearUsuario: sin rol de gestión no crea nada", async () => {
  __setClient(sesion({ rol: "gerencia" }).sb);
  const { sb, auth } = adminFalso();
  __setAdmin(sb);
  assert.equal((await crearUsuario({ email: "x@t", password: "secreta1", nombre: "X", rol: "venta" })).ok, false);
  assert.deepEqual(auth.creados, []);
});

// ── Agentes del portal ────────────────────────────────────────────────────
test("crearAgente: queda activo y atado a su titular; si no se confirma, se borra", async () => {
  __setClient(sesion({ rol: "agencia", agencia_id: null, activo: true }).sb);
  const ok = adminFalso();
  __setAdmin(ok.sb);
  assert.deepEqual(await crearAgente({ nombre: "Agente", email: "ag@t", password: "secreta1" }), { ok: true });
  const upd = ok.ops.find((o) => o.op === "update")!.payload as Record<string, unknown>;
  assert.deepEqual([upd.rol, upd.activo, upd.agencia_id], ["agencia", true, "u-sesion"]);

  for (const opts of [{ perfilError: true }, { perfilFilas: 0 }]) {
    __setClient(sesion({ rol: "agencia", agencia_id: null, activo: true }).sb);
    const malo = adminFalso(opts);
    __setAdmin(malo.sb);
    assert.equal((await crearAgente({ nombre: "Agente", email: "ag@t", password: "secreta1" })).ok, false);
    assert.deepEqual(malo.auth.borrados, ["nuevo"], JSON.stringify(opts));
  }
});

test("wiring: el cargue B2B del CRM fija activo explícito y borra la cuenta si el perfil no se confirma", () => {
  const fuente = readFileSync(new URL("../app/(crm)/crm/b2b/actions.ts", import.meta.url), "utf8");
  assert.match(fuente, /update\(\{ rol: tipo as "agencia" \| "freelance", nombre, activo: true \}\)/);
  assert.match(fuente, /perfil\?\.length !== 1\) \{\s*await admin\.auth\.admin\.deleteUser\(created\.user\.id\)/);
});
