// Programas · migración 252 — la Server Action REAL `guardarHoteles` contra PostgreSQL por HTTP (PostgREST propio, sesión `administracion` real con su RLS).
// SOLO base LOCAL desechable: la lanza supabase/scripts/test_252_programa_hoteles_unicos.sh.
import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG252_CONTENEDOR ?? "pg244anular";
const DB = process.env.PG252_BASE ?? "";
const PGRST = process.env.PG252_POSTGREST ?? "";
const SECRETO = process.env.PG252_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) {
  throw new Error("Faltan PG252_BASE (desechable), PG252_POSTGREST y PG252_JWT_SECRET: usa supabase/scripts/test_252_programa_hoteles_unicos.sh.");
}

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

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const UID_ADMIN = "00000000-0000-0000-0000-000000252003";
const TOKEN_SERVICIO = jwt({ role: "service_role" });

process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-252";

const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteSesion = () => clienteLocal(jwt({ role: "authenticated", sub: UID_ADMIN }), { id: UID_ADMIN, email: "admin252@x.test" });
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: q, encoding: "utf8" }).trim();
}

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { guardarHoteles, leerCatalogoHoteles } = await import("../app/(dashboard)/dashboard/producto/programas/actions.ts");

const PID = 25201;
before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin252@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_ADMIN}', 'admin252@x.test', 'Admin 252', 'administracion', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into public.programas (id, nombre, subtitulo, moneda, pct_mk, pct_fee_tarjeta, asistencia_medica_dia, modo_precio, dias, noches, tipo_transporte, incluye_aereo)
      values (${PID}, 'Caribe terrestre 252', 'Cartagena', 'USD', 0.15, 0.03, 4, 'hotel', 4, 3, 'ninguno', false) on conflict do nothing;
  `);
});
beforeEach(() => { sql(`delete from public.programa_hoteles where programa_id = ${PID}`); });

const netos = (o: Record<string, string> = {}) => ({ sencilla: "", doble: "", triple: "", multiple: "", nino: "", ...o });
const hotel = (nombre: string, id: number | null = null, extra: Record<string, unknown> = {}) => ({
  id, nombre, zona: "Centro", tipoHabitacion: "", maxPaxHabitacion: "4", maxMenoresHabitacion: "", proveedorId: null as number | null,
  base: [{ desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: netos({ doble: "600", nino: "400" }) }],
  noches: [{ desde: "2027-03-01", hasta: "2027-03-31", unidad: "persona", neto: netos({ doble: "100" }) }],
  ...extra,
});
/** Estado completo del catálogo: ids, orden, nombre, zona y filas hijas (para comprobar que un fallo no deja NADA a medias). */
const estado = () => sql(`select coalesce(string_agg(h.id || ':' || h.orden || ':' || h.nombre || ':' || coalesce(h.zona, '') || ':' ||
    (select count(*) from public.programa_hotel_precios p where p.hotel_id = h.id) || ':' || (select count(*) from public.programa_hotel_noches n where n.hotel_id = h.id), ' | ' order by h.orden, h.id), '(vacío)')
  from public.programa_hoteles h where h.programa_id = ${PID}`);
const ids = () => sql(`select coalesce(string_agg(id::text || '=' || nombre, ',' order by orden), '') from public.programa_hoteles where programa_id = ${PID}`);
const idDe = (nombre: string) => Number(sql(`select id from public.programa_hoteles where programa_id = ${PID} and nombre = '${nombre}'`));
const MENSAJE_DUPLICADO = "Ya existe un hotel con ese nombre en este programa. Usa otro nombre";
const TECNICO = /violat|constraint|duplicate key|uq_programa|programa_hoteles|foreign key|SQLSTATE|PGRST|relation |column |23505|23503|23514/i;
const msg = (r: { ok: boolean }) => ("error" in r ? String((r as { error: unknown }).error) : "");

describe("guardarHoteles (acción real) · guardado válido", () => {
  test("V1 dos hoteles con nombres distintos: se guardan con sus vigencias y la acción devuelve los ids en el orden de la lista", async () => {
    const r = await guardarHoteles(PID, [hotel("Hotel Sol"), hotel("Hotel Mar")]);
    assert.equal(r.ok, true, msg(r));
    assert.match(estado(), /^\d+:0:Hotel Sol:Centro:1:1 \| \d+:1:Hotel Mar:Centro:1:1$/);
    assert.deepEqual((r as { ids?: number[] }).ids, [idDe("Hotel Sol"), idDe("Hotel Mar")], "ids en el orden enviado (para que el formulario no conserve hoteles sin id)");
  });

  test("V2 guardar de nuevo con los ids conserva los ids y aplica el cambio", async () => {
    await guardarHoteles(PID, [hotel("Hotel Sol"), hotel("Hotel Mar")]);
    const [a, b] = [idDe("Hotel Sol"), idDe("Hotel Mar")];
    const r = await guardarHoteles(PID, [hotel("Hotel Sol", a, { zona: "Playa" }), hotel("Hotel Mar", b)]);
    assert.equal(r.ok, true, msg(r));
    assert.equal(ids(), `${a}=Hotel Sol,${b}=Hotel Mar`);
    assert.match(estado(), /Hotel Sol:Playa/);
  });
});

describe("leerCatalogoHoteles (acción real) · recarga del catálogo guardado", () => {
  test("V3 devuelve los hoteles guardados, en orden y con sus ids, vigencias y noches (lo que el editor usa para reinicializarse)", async () => {
    const r = await guardarHoteles(PID, [hotel("Hotel Sol"), hotel("Hotel Mar")]);
    assert.equal(r.ok, true, msg(r));
    const c = await leerCatalogoHoteles(PID);
    assert.equal(c.ok, true, msg(c));
    if (!c.ok) return;
    assert.deepEqual(c.catalogo.hoteles.map((x) => x.nombre), ["Hotel Sol", "Hotel Mar"]);
    assert.deepEqual(c.catalogo.hoteles.map((x) => x.id), (r as { ids: number[] }).ids);
    assert.equal(c.catalogo.base.length, 2);
    assert.equal(c.catalogo.noches.length, 2);
  });
});

describe("guardarHoteles (acción real) · el estado final tiene nombres únicos aunque el orden de las operaciones colisione", () => {
  test("R1 reemplazo: se quita «Hotel Sol» y se agrega otro con el mismo nombre (sin id) — el estado final es único", async () => {
    await guardarHoteles(PID, [hotel("Hotel Sol"), hotel("Hotel Mar")]);
    const [sol, mar] = [idDe("Hotel Sol"), idDe("Hotel Mar")];
    const r = await guardarHoteles(PID, [hotel("Hotel Sol", null, { zona: "Nuevo" }), hotel("Hotel Mar", mar)]);
    assert.equal(r.ok, true, msg(r));
    assert.match(estado(), /^\d+:0:Hotel Sol:Nuevo:1:1 \| \d+:1:Hotel Mar:Centro:1:1$/);
    assert.equal(Number(sql(`select count(*) from public.programa_hoteles where id = ${sol}`)), 0, "el hotel anterior se borró");
    assert.equal(idDe("Hotel Mar"), mar);
  });

  test("R2 intercambio de nombres entre dos hoteles existentes — el estado final es único y los ids se conservan", async () => {
    await guardarHoteles(PID, [hotel("Hotel Sol"), hotel("Hotel Mar")]);
    const [sol, mar] = [idDe("Hotel Sol"), idDe("Hotel Mar")];
    const r = await guardarHoteles(PID, [hotel("Hotel Mar", sol), hotel("Hotel Sol", mar)]);
    assert.equal(r.ok, true, msg(r));
    assert.equal(ids(), `${sol}=Hotel Mar,${mar}=Hotel Sol`);
  });

  test("R3 renombrar un hotel con el nombre de otro que también se renombra (cadena) — el estado final es único", async () => {
    await guardarHoteles(PID, [hotel("Hotel A"), hotel("Hotel B"), hotel("Hotel C")]);
    const [a, b, c] = [idDe("Hotel A"), idDe("Hotel B"), idDe("Hotel C")];
    const r = await guardarHoteles(PID, [hotel("Hotel B", a), hotel("Hotel C", b), hotel("Hotel D", c)]);
    assert.equal(r.ok, true, msg(r));
    assert.equal(ids(), `${a}=Hotel B,${b}=Hotel C,${c}=Hotel D`);
  });

  test("R4 mayúsculas y espacios: «hotel sol» reemplaza a «Hotel Sol» (el índice no distingue mayúsculas)", async () => {
    await guardarHoteles(PID, [hotel("Hotel Sol")]);
    const r = await guardarHoteles(PID, [hotel("  hotel sol  ", null)]);
    assert.equal(r.ok, true, msg(r));
    assert.equal(ids().replace(/^\d+=/, ""), "hotel sol");
  });
});

describe("guardarHoteles (acción real) · duplicado real: mensaje claro y SIN cambios parciales", () => {
  test("D1 nombres que la validación de la acción ve distintos pero la base ve IGUALES (ΑΣ / ασ): llega el 23505 real — mensaje claro, sin SQL ni restricción, y NINGÚN cambio parcial", async () => {
    await guardarHoteles(PID, [hotel("Hotel Sol"), hotel("Hotel Mar")]);
    const antes = estado();
    const errores = mock.method(console, "error", () => {});
    try {
      // «Hotel Sol» cambia de zona y se agregan dos hoteles: el primero entra bien, el segundo choca con el primero. Nada de eso debe quedar persistido.
      const r = await guardarHoteles(PID, [hotel("Hotel Sol", idDe("Hotel Sol"), { zona: "Cambiada" }), hotel("Hotel Mar", idDe("Hotel Mar")), hotel("Hotel ΑΣ"), hotel("Hotel ασ")]);
      assert.equal(r.ok, false);
      assert.equal(msg(r), MENSAJE_DUPLICADO);
      assert.doesNotMatch(msg(r), TECNICO);
      assert.equal(estado(), antes, "ni el cambio de «Hotel Sol» ni el alta del primer «Hotel ΑΣ» quedaron a medias");
      // Registro interno: detalle técnico mínimo, sin nombres ni valores del usuario.
      const log = errores.mock.calls.map((c) => c.arguments.join(" ")).join("; ");
      assert.match(log, /guardarHoteles/);
      assert.match(log, /23505/);
      assert.doesNotMatch(log, /Hotel (Sol|Mar)|Cambiada|ΑΣ|ασ/, "el registro no lleva datos del usuario");
    } finally { errores.mock.restore(); }
  });
});

describe("guardarHoteles (acción real) · otros errores de la base: mensaje de negocio útil o mensaje claro, nunca SQL", () => {
  test("E1 hotel que no pertenece al programa (mensaje de negocio de la RPC): se conserva y no deja cambios", async () => {
    await guardarHoteles(PID, [hotel("Hotel Sol")]);
    const antes = estado();
    const r = await guardarHoteles(PID, [hotel("Hotel Sol", idDe("Hotel Sol"), { zona: "X" }), hotel("Ajeno", 999999)]);
    assert.equal(r.ok, false);
    assert.match(msg(r), /no pertenece al programa/);
    assert.equal(estado(), antes);
  });

  test("E2 proveedor inexistente (clave foránea): mensaje claro sin nombre de restricción ni texto de la base, y sin cambios", async () => {
    await guardarHoteles(PID, [hotel("Hotel Sol")]);
    const antes = estado();
    const errores = mock.method(console, "error", () => {});
    try {
      const r = await guardarHoteles(PID, [hotel("Hotel Sol", idDe("Hotel Sol"), { zona: "Y", proveedorId: 987654 })]);
      assert.equal(r.ok, false);
      assert.doesNotMatch(msg(r), TECNICO);
      assert.match(msg(r), /proveedor|referencia/i, "dice qué revisar");
      assert.equal(estado(), antes);
      assert.match(errores.mock.calls.map((c) => c.arguments.join(" ")).join("\n"), /23503/);
    } finally { errores.mock.restore(); }
  });

  test("E3 nombre demasiado largo (CHECK de la tabla): mensaje claro, sin nombre de restricción", async () => {
    await guardarHoteles(PID, [hotel("Hotel Sol")]);
    const antes = estado();
    const r = await guardarHoteles(PID, [hotel("H".repeat(250))]);
    assert.equal(r.ok, false);
    assert.doesNotMatch(msg(r), TECNICO);
    assert.equal(estado(), antes);
  });
});
