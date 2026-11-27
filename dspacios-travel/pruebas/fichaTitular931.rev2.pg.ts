// B2-11 / B2-12a — lectura REAL (PostgREST → RLS → PostgreSQL) de lo que alimenta la ficha del titular y la columna del listado de Cotizaciones.
// Lo simulado es solo la sesión (JWT firmado). Base LOCAL desechable: lo lanza supabase/scripts/test_931_ficha_titular.sh con test_pg_local.sh (PG_REACT=1).
// Afirma: (1) los cinco roles internos de la agencia leen titular/contacto de SU agencia por la misma consulta del listado y de la ficha; (2) otra agencia y un aliado B2B no
// leen nada; (3) la ficha armada con lo leído por PostgREST (no con un objeto a mano) dice lo mismo que lo guardado, y «No registrado» (null) donde no hay dato.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG931_CONTENEDOR ?? "";
const DB = process.env.PG931_BASE ?? "";
const PGRST = process.env.PG931_POSTGREST ?? "";
const SECRETO = process.env.PG931_JWT_SECRET ?? "";
if (!CT || !DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG931_*: usa supabase/scripts/test_931_ficha_titular.sh.");

const { fichaTitularCotizacion, enmascararDocumento } = await import("../lib/cotizacion/fichaTitular.ts");

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const uid = (n: number) => `00000000-0000-0000-0000-0000009310${String(n).padStart(2, "0")}`;
const sidDe = (id: string) => id.replace(/^00000000/, "5e550000");
const U = {
  super: { id: uid(1), email: "t931-super@x.test", nombre: "T931 Super", rol: "superadmin", tenant: "mayorista", aliado: null },
  gerencia: { id: uid(2), email: "t931-ger@x.test", nombre: "T931 Gerencia", rol: "gerencia", tenant: "mayorista", aliado: null },
  admin: { id: uid(3), email: "t931-adm@x.test", nombre: "T931 Admin", rol: "administracion", tenant: "mayorista", aliado: null },
  ops: { id: uid(4), email: "t931-ops@x.test", nombre: "T931 Ops", rol: "operaciones", tenant: "mayorista", aliado: null },
  venta: { id: uid(5), email: "t931-venta@x.test", nombre: "T931 Venta", rol: "venta", tenant: "mayorista", aliado: null },
  adminMin: { id: uid(6), email: "t931-admmin@x.test", nombre: "T931 AdmMin", rol: "administracion", tenant: "minorista", aliado: null },
  agencia: { id: uid(7), email: "t931-agencia@x.test", nombre: "T931 Agencia", rol: "agencia", tenant: "mayorista", aliado: 9931 },
} as const;
type Quien = keyof typeof U;

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
let solicitudes = 0;
const fetchLocal: typeof fetch = (input, init) => { solicitudes++; return fetch(String(input).replace("/rest/v1/", "/"), init); };
const como = (q: Quien) => crearClienteSupabase(PGRST, jwt({ role: "authenticated", sub: U[q].id, session_id: sidDe(U[q].id) }), { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });

// Misma consulta que el listado (app/(dashboard)/dashboard/cotizaciones/page.tsx).
const SELECT_LISTA = "id, codigo, tipo, modo, cliente, estado, titular_doc:payload->cliente->>numeroDoc, titular_tel:payload->cliente->>telefono, titular_email:payload->cliente->>email";

const A = { tipo: "manual", cliente: "Ana Perez", payload: { cliente: { nombres: "Ana", apellidos: "Perez", tipoDoc: "CC", numeroDoc: "1010101010", nacimiento: "1990-05-04", telefono: "3001112233", email: "ana@x.test" }, ninos: 1, infantes: 1, pasajeros: [{ nombres: "Beto", apellidos: "Perez", tipoDoc: "TI", numeroDoc: "2020", fechaNacimiento: "2015-01-01" }] }, pax: 2 };
const B = { tipo: "carrito", cliente: "Cliente", payload: { cliente: { nombres: "Cliente", apellidos: "", tipoDoc: "", numeroDoc: "", telefono: "", email: "" } }, pax: 2 }; // relleno del motor: no es una persona
const C = { tipo: "manual", cliente: "Solo Columna", payload: {}, pax: 1 };                                    // sin payload.cliente: solo el texto de la columna
const D = { tipo: "manual", cliente: "Otra Agencia", payload: { cliente: { nombres: "Otra", apellidos: "Agencia", numeroDoc: "999" } }, pax: 1 };
const ids: Record<string, number> = {};

before(() => {
  const us = Object.values(U);
  sql(`
    insert into auth.users (id, email) values ${us.map((u) => `('${u.id}', '${u.email}')`).join(", ")} on conflict do nothing;
    insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion) values (9931, 'T931 Agencia', '9931', 'agencia', 0.10, false, 0) on conflict (id) do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
      ${us.map((u) => `('${u.id}', '${u.email}', '${u.nombre}', '${u.rol}', true, '${u.tenant}', ${u.aliado ?? "null"})`).join(", ")}
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant, aliado_id = excluded.aliado_id, nombre = excluded.nombre;
    insert into auth.sessions (id, user_id) select ('5e550000' || substr(id::text, 9))::uuid, id from public.usuarios where id in (${us.map((u) => `'${u.id}'`).join(", ")}) on conflict do nothing;
    insert into public.sesion_agencia (session_id, user_id, tenant) select ('5e550000' || substr(id::text, 9))::uuid, id, tenant from public.usuarios where id in (${us.map((u) => `'${u.id}'`).join(", ")}) on conflict do nothing;
  `);
  const ins = (k: string, f: { tipo: string; cliente: string; payload: unknown; pax: number }, tenant: string) => {
    ids[k] = Number(sql(`insert into public.cotizaciones (tenant, tipo, estado, cliente, pax, payload) values ('${tenant}', '${f.tipo}', 'abierta', '${f.cliente}', ${f.pax}, '${JSON.stringify(f.payload)}'::jsonb) returning id`));
  };
  ins("A", A, "mayorista"); ins("B", B, "mayorista"); ins("C", C, "mayorista"); ins("D", D, "minorista");
});

describe("lectura por rol (misma consulta del listado)", () => {
  for (const q of ["super", "gerencia", "admin", "ops", "venta"] as const) {
    test(`${q}: lee titular, documento y contacto de las cotizaciones de su agencia`, async () => {
      const { data, error } = await como(q).from("cotizaciones").select(SELECT_LISTA).in("id", [ids.A, ids.B, ids.C, ids.D]).order("id");
      assert.equal(error, null);
      const vistos = (data ?? []).map((f) => (f as { id: number }).id);
      const esperados = q === "super" ? [ids.A, ids.B, ids.C, ids.D] : [ids.A, ids.B, ids.C];
      assert.deepEqual(vistos, esperados);
      const a = (data ?? []).find((f) => (f as { id: number }).id === ids.A) as unknown as Record<string, string>;
      assert.equal(a.titular_doc, "1010101010"); assert.equal(a.titular_tel, "3001112233"); assert.equal(a.titular_email, "ana@x.test");
      assert.equal(enmascararDocumento(a.titular_doc), "••••1010");
    });
  }
  test("otra agencia solo lee la suya; un aliado B2B no lee ninguna", async () => {
    const m = await como("adminMin").from("cotizaciones").select(SELECT_LISTA).in("id", [ids.A, ids.B, ids.C, ids.D]);
    assert.deepEqual((m.data ?? []).map((f) => (f as { id: number }).id), [ids.D]);
    const ag = await como("agencia").from("cotizaciones").select(SELECT_LISTA).in("id", [ids.A, ids.B, ids.C, ids.D]);
    assert.deepEqual(ag.data ?? [], []);
  });
});

describe("la ficha armada con lo leído de la base", () => {
  test("titular completo, niños, infantes y viajero guardado", async () => {
    const { data } = await como("venta").from("cotizaciones").select("*").eq("id", ids.A).single();
    const f = fichaTitularCotizacion(data as never, { puestos: null });
    assert.equal(f.nombre, "Ana Perez"); assert.equal(f.documento, "CC 1010101010"); assert.equal(f.nacimiento, "1990-05-04");
    assert.equal(f.telefono, "3001112233"); assert.equal(f.email, "ana@x.test"); assert.equal(f.identificado, true); assert.equal(f.registro, "desconocido");
    assert.deepEqual(f.composicion, [{ etiqueta: "Adultos", valor: "2" }, { etiqueta: "Niños", valor: "1" }, { etiqueta: "Infantes", valor: "1" }]);
    assert.deepEqual(f.pasajeros.map((p) => [p.nombre, p.documento, p.nacimiento, p.fuente]), [["Beto Perez", "TI 2020", "2015-01-01", "cotizacion"]]);
  });
  test("el titular de relleno del motor NO es una persona; sin payload.cliente solo queda el texto de la columna", async () => {
    const b = fichaTitularCotizacion((await como("ops").from("cotizaciones").select("*").eq("id", ids.B).single()).data as never, { puestos: [] });
    assert.equal(b.nombre, null); assert.equal(b.documento, null); assert.equal(b.identificado, false); assert.equal(b.registro, "sin_titular");
    const c = fichaTitularCotizacion((await como("ops").from("cotizaciones").select("*").eq("id", ids.C).single()).data as never, { puestos: null });
    assert.equal(c.nombre, "Solo Columna"); assert.equal(c.documento, null); assert.equal(c.telefono, null); assert.equal(c.identificado, false);
  });
  test("consumo: una consulta por pantalla, sin sondeo", () => { assert.ok(solicitudes > 0 && solicitudes < 20, `solicitudes HTTP totales de la suite: ${solicitudes}`); console.log(`  [consumo] ${solicitudes} solicitudes HTTP en toda la suite (7 roles × 1 lectura + 3 fichas)`); });
});
