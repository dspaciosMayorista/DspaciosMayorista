// #106 · Gestión integral de contratos — recorrido de integración REAL por HTTP contra PostgreSQL + PostgREST locales y desechables.
// Corren la RPC real `fn_gestion_contratos`, la RPC de escritura `registrar_seguimiento_contrato`, la RLS por rol (migración 309 sobre el esquema ≤302 + 305/306),
// y el cargador, la acción y la página REALES de la app (lib/gestionContratos/*, app/(dashboard)/dashboard/gestion-contratos/*) con sesiones `authenticated`
// de usuarios reales de la base. Lo ÚNICO simulado: `auth.getUser()` (la sesión), next/cache y next/navigation.
// SOLO base LOCAL desechable: la lanza supabase/scripts/test_106_gestion_contratos.sh (crea la base, PostgREST propio con max-rows=1000, y lo borra todo al final).
import { test, describe, mock, before } from "node:test";
import nodeModule from "node:module";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { __setClient } from "./support/stubs/supabaseServerStub.mjs";

const CT = process.env.PG106_CONTENEDOR ?? "pg304";
const DB = process.env.PG106_BASE ?? "";
const PGRST = process.env.PG106_POSTGREST ?? "";
const SECRETO = process.env.PG106_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG106_BASE (desechable), PG106_POSTGREST y PG106_JWT_SECRET: usa supabase/scripts/test_106_gestion_contratos.sh.");

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}

// ── Usuarios reales (auth.users + usuarios) ─────────────────────────────────
const U = {
  SA: "00000000-0000-0000-0000-000000106001",        // superadmin (mayorista)
  SA_INACTIVO: "00000000-0000-0000-0000-000000106002", // superadmin DESACTIVADO
  GER: "00000000-0000-0000-0000-000000106003",
  ADM: "00000000-0000-0000-0000-000000106004",
  OPE: "00000000-0000-0000-0000-000000106005",
  VENTA: "00000000-0000-0000-0000-000000106006",
  ALIADO: "00000000-0000-0000-0000-000000106007",
} as const;
const PERFIL: Record<string, { rol: string; activo: boolean; email: string; nombre: string; aliado: number | null }> = {
  [U.SA]: { rol: "superadmin", activo: true, email: "sa106@x.test", nombre: "Super Admin 106", aliado: null },
  [U.SA_INACTIVO]: { rol: "superadmin", activo: false, email: "sai106@x.test", nombre: "Super Inactivo 106", aliado: null },
  [U.GER]: { rol: "gerencia", activo: true, email: "ge106@x.test", nombre: "Gerencia 106", aliado: null },
  [U.ADM]: { rol: "administracion", activo: true, email: "ad106@x.test", nombre: "Administración 106", aliado: null },
  [U.OPE]: { rol: "operaciones", activo: true, email: "op106@x.test", nombre: "Operaciones 106", aliado: null },
  [U.VENTA]: { rol: "venta", activo: true, email: "ve106@x.test", nombre: "Local Venta", aliado: null },
  [U.ALIADO]: { rol: "agencia", activo: true, email: "al106@x.test", nombre: "Aliado 106", aliado: 9601 },
};
const TOKEN_SERVICIO = jwt({ role: "service_role" });
let uidSesion: string | null = U.SA;
/** Fija la sesión en las DOS vías por las que la app obtiene su cliente: mock.module (cargador/acción) y el stub que reactLoader pone a lib/roles.ts (miRol). */
function fijar(uid: string | null) { uidSesion = uid; __setClient(clienteDe(uid)); }

process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;

/** Todas las peticiones HTTP que salen hacia PostgREST (para medir cuántas hace cada recorrido y comprobar que en reposo no hay ninguna). */
const peticiones: string[] = [];
const fetchLocal: typeof fetch = async (input, init) => {
  const url = String(input).replace("/rest/v1/", "/");
  peticiones.push(`${init?.method ?? "GET"} ${url.replace(PGRST, "")}`);
  return fetch(url, init);
};
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteDe = (uid: string | null) => uid ? clienteLocal(jwt({ role: "authenticated", sub: uid }), { id: uid, email: PERFIL[uid].email }) : clienteLocal(jwt({ role: "anon" }));

function psql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
}
const sql = psql;
const json = <T>(q: string): T => JSON.parse(sql(q) || "null") as T;
const lit = (v: unknown) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

// next/cache y next/navigation se sustituyen por módulos mínimos (no hay servidor de Next): revalidatePath se registra y redirect lanza como lo hace Next.
type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = {
  "server-only": "export {}",
  "next/cache": "export function revalidatePath(p) { (globalThis.__reval106 ??= []).push(p); } export function revalidateTag() {}",
  "next/navigation": "export function redirect(u) { throw new Error('NEXT_REDIRECT:' + u); } export function usePathname() { return '/dashboard/gestion-contratos'; } export function useRouter() { return { replace() {}, push() {}, refresh() {} }; }",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const src = MODULOS_MINIMOS[specifier];
    if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const revalidados: string[] = ((globalThis as unknown as { __reval106?: string[] }).__reval106 ??= []);
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteDe(uidSesion) } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });

const { cargarGestionContratos } = await import("../lib/gestionContratos/cargar.server.ts");
const { registrarSeguimiento } = await import("../app/(dashboard)/dashboard/gestion-contratos/actions.ts");
const { default: PaginaGestion } = await import("../app/(dashboard)/dashboard/gestion-contratos/page.tsx");
const { cobroDeVenta } = await import("../lib/finanzas/cobro.ts");
const { calcularComisionFila, esComisionDescontada, esComisionEnContratoNeto, estadoComisionFila } = await import("../lib/finanzas/comisionB2B.ts");
const { sumarPagosPorAliado } = await import("../lib/finanzas/pagosComisionB2B.ts");
type Carga = Awaited<ReturnType<typeof cargarGestionContratos>>;
type Ok = Extract<Carga, { estado: "ok" }>;

async function cargar(uid: string | null, sp: Record<string, string | string[] | undefined> = {}): Promise<Carga> { fijar(uid); return cargarGestionContratos(sp); }
async function ok(sp: Record<string, string | string[] | undefined> = {}, uid: string | null = U.SA): Promise<Ok> {
  const r = await cargar(uid, sp);
  assert.equal(r.estado, "ok", JSON.stringify(r));
  return r as Ok;
}
const numeros = (r: Ok) => r.datos.filas.map((f) => f.numero);
const fila = (r: Ok, n: string) => { const f = r.datos.filas.find((x) => x.numero === n); assert.ok(f, `falta ${n}`); return f!; };
const rpcSa = async (nombre: string, args: Record<string, unknown>, uid: string | null = U.SA) => clienteDe(uid).rpc(nombre as never, args as never) as unknown as Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
const uidDe = (n: string) => sql(`select contrato_uid from public.ventas where numero_contrato = ${lit(n)}`);

before(() => {
  sql(`
    insert into auth.users (id, email) values ${Object.entries(PERFIL).map(([id, p]) => `('${id}', '${p.email}')`).join(", ")} on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
      ${Object.entries(PERFIL).map(([id, p]) => `('${id}', '${p.email}', ${lit(p.nombre)}, '${p.rol}', ${p.activo}, 'mayorista', ${p.aliado ?? "null"})`).join(", ")}
      on conflict (id) do update set nombre = excluded.nombre, email = excluded.email, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id;
  `);
});

// ───────────────────────────────────────────────────────────────────────────
describe("seguridad: solo superadmin, también por la API directa", () => {
  for (const [nombre, uid] of [["gerencia", U.GER], ["administracion", U.ADM], ["operaciones", U.OPE], ["venta", U.VENTA], ["aliado (agencia)", U.ALIADO], ["superadmin DESACTIVADO", U.SA_INACTIVO], ["anónimo", null]] as const) {
    test(`${nombre}: la RPC de lectura responde 42501 y no devuelve datos`, async () => {
      const r = await rpcSa("fn_gestion_contratos", { p_filtros: {}, p_orden: "venta_desc", p_limite: 25, p_desplazamiento: 0 }, uid);
      assert.equal(r.error?.code, "42501", JSON.stringify(r)); assert.equal(r.data, null);
    });
    test(`${nombre}: el cargador de la app lo rechaza (sin_permiso) y no hay lectura de datos`, async () => {
      peticiones.length = 0;
      const r = await cargar(uid);
      assert.equal(r.estado, "sin_permiso");
      assert.ok(!peticiones.some((p) => p.includes("fn_gestion_contratos")), "no debe llegar a pedir la lista");
    });
    test(`${nombre}: la RPC de escritura responde 42501 y no escribe`, async () => {
      const antes = sql("select count(*) from public.contrato_seguimiento");
      const r = await rpcSa("registrar_seguimiento_contrato", { p_numero: "DTM-10602", p_contrato_uid: uidDe("DTM-10602"), p_tipo: "voucher_entregado", p_accion: "marcar", p_canal: "correo", p_nota: null }, uid);
      assert.equal(r.error?.code, "42501", JSON.stringify(r));
      assert.equal(sql("select count(*) from public.contrato_seguimiento"), antes);
    });
  }
  test("la acción de la app también se rechaza para un rol no superadmin, sin tocar la base", async () => {
    fijar(U.GER);
    const antes = sql("select count(*) from public.contrato_seguimiento");
    const r = await registrarSeguimiento({ numero: "DTM-10602", uid: uidDe("DTM-10602"), tipo: "voucher_entregado", accion: "marcar", canal: "correo" });
    assert.equal(r.ok, false);
    assert.equal(sql("select count(*) from public.contrato_seguimiento"), antes);
  });
  test("la tabla de acuses: la API no puede leerla (salvo superadmin) ni escribirla (ni siquiera superadmin)", async () => {
    for (const uid of [U.GER, U.ADM, U.VENTA, U.ALIADO]) {
      const { data, error } = await clienteDe(uid).from("contrato_seguimiento" as never).select("*");
      assert.ok(error != null || (data as unknown[]).length === 0, `rol ${PERFIL[uid].rol} no debe leer acuses`);
    }
    const { data } = await clienteDe(U.SA).from("contrato_seguimiento" as never).select("id");
    assert.ok((data as unknown[]).length >= 5, "superadmin sí lee los acuses sembrados");
    const ins = await clienteDe(U.SA).from("contrato_seguimiento" as never).insert({ numero_contrato: "DTM-10603", contrato_uid: uidDe("DTM-10603"), tenant: "mayorista", tipo: "voucher_entregado", accion: "marcar", canal: "correo", actor_id: U.SA } as never);
    assert.ok(ins.error, "insertar directo debe fallar");
    const upd = await clienteDe(U.SA).from("contrato_seguimiento" as never).update({ nota: "x" } as never).gte("id", 0);
    assert.ok(upd.error || sql("select count(*) from public.contrato_seguimiento where nota = 'x'") === "0");
    const del = await clienteDe(U.SA).from("contrato_seguimiento" as never).delete().gte("id", 0);
    assert.ok(del.error || sql("select count(*) from public.contrato_seguimiento") === "5");
  });
  test("ni siquiera con SQL de dueño se puede modificar un acuse (append-only); borrar el contrato sí se lleva sus acuses", () => {
    assert.throws(() => sql("update public.contrato_seguimiento set nota = 'x' where id = (select min(id) from public.contrato_seguimiento)"), /SEGUIMIENTO_INMUTABLE/);
  });
  test("los permisos existentes de otros roles NO cambiaron (gerencia sigue leyendo ventas, venta sigue sin ellas)", async () => {
    const g = await clienteDe(U.GER).from("ventas").select("numero_contrato").limit(5);
    assert.ok(!g.error && g.data!.length > 0, "gerencia conserva su lectura");
    const v = await clienteDe(U.VENTA).from("ventas" as never).select("numero_contrato").limit(5);
    assert.ok(v.error != null || (v.data as unknown[]).length === 0, "venta sigue sin leer ventas");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("lectura: ambas agencias, saldos con la regla de cobro existente y filtros", () => {
  test("sin filtros: ambas agencias juntas, total exacto, 25 por página", async () => {
    const r = await ok();
    assert.equal(r.datos.total, 62); assert.equal(r.datos.filas.length, 25);
    const todas = (await Promise.all([1, 2, 3].map((p) => ok({ pagina: String(p) })))).flatMap((x) => x.datos.filas);
    assert.equal(new Set(todas.map((f) => f.numero)).size, 62, "las tres páginas cubren los 62 contratos sin repetir ni omitir");
    assert.ok(todas.some((f) => f.tenant === "mayorista") && todas.some((f) => f.tenant === "minorista"));
  });
  test("PARIDAD del saldo con cobroDeVenta + suma de abonos, contrato por contrato (62)", async () => {
    const ventas = json<Record<string, unknown>[]>("select coalesce(jsonb_agg(to_jsonb(v)), '[]') from (select numero_contrato, tenant, moneda, precio_venta, moneda_cobro, trm_cobro, total_cobro from public.ventas) v");
    const abonos = json<{ numero_contrato: string; s: number }[]>("select coalesce(jsonb_agg(to_jsonb(a)), '[]') from (select numero_contrato, sum(valor_abono)::float8 as s from public.abonos group by 1) a");
    const pagado = new Map(abonos.map((a) => [a.numero_contrato, a.s]));
    const todas = (await Promise.all([1, 2, 3].map((p) => ok({ pagina: String(p) })))).flatMap((x) => x.datos.filas);
    assert.equal(todas.length, ventas.length);
    for (const v of ventas) {
      const c = cobroDeVenta(v as never);
      const f = todas.find((x) => x.numero === v.numero_contrato)!;
      const p = pagado.get(String(v.numero_contrato)) ?? 0;
      assert.equal(f.monedaCobro, c.moneda, `${f.numero} moneda`);
      assert.equal(f.total, c.total, `${f.numero} total`);
      assert.equal(f.pagado, p, `${f.numero} pagado`);
      assert.ok(Math.abs((f.saldo ?? NaN) - (c.total - p)) < 0.005, `${f.numero} saldo`);
      assert.equal(f.cobroConvertido, c.convertido, `${f.numero} conversión`);
    }
  });
  test("casos de cobro: COP, USD, cobro cruzado en ambos sentidos, sobrepago, cancelado y sin total", async () => {
    const r = await ok({ numero: "-106" , orden: "numero_asc" });
    const f = (n: string) => fila(r, n);
    assert.deepEqual([f("DTM-10601").monedaCobro, f("DTM-10601").saldoClase], ["COP", "pagado"]);
    assert.deepEqual([f("DTM-10604").monedaCobro, f("DTM-10604").monedaOferta, f("DTM-10604").total, f("DTM-10604").saldoClase, f("DTM-10604").cobroConvertido], ["COP", "USD", 4_200_000, "pagado", true]);
    assert.deepEqual([f("DTM-10616").monedaCobro, f("DTM-10616").monedaOferta, f("DTM-10616").total, f("DTM-10616").saldo, f("DTM-10616").saldoClase], ["USD", "COP", 2000, 1200, "con_saldo"]);
    assert.deepEqual([f("DTM-10608").saldo, f("DTM-10608").saldoClase], [-100, "sobrepago"]);
    assert.equal(f("DTM-10605").estadoGrupo, "cancelado");
    assert.deepEqual([f("DTM-10610").total, f("DTM-10610").saldoClase, f("DTM-10610").financieroPendiente], [0, "sin_total", true]);
    assert.equal(f("DTM-10603").pagado, 0); assert.equal(f("DTM-10603").saldo, 1_500_000);
  });
  test("filtro de saldo: «con saldo» excluye cancelados y pagados; incluye pendientes", async () => {
    const r = await ok({ saldo: "con_saldo", numero: "-106" });
    const n = numeros(r);
    assert.ok(n.includes("DTM-10602") && n.includes("DTM-10603") && n.includes("DTM-10616") && n.includes("DTM-10612"));
    assert.ok(!n.includes("DTM-10605") && !n.includes("DTM-10601") && !n.includes("DTM-10608") && !n.includes("DTM-10610"));
    assert.deepEqual(numeros(await ok({ saldo: "sobrepago" })), ["DTM-10608"]);
    assert.deepEqual(numeros(await ok({ saldo: "sin_total" })), ["DTM-10610"]);
    assert.ok((await ok({ saldo: "pagado", numero: "-106" })).datos.filas.every((f) => f.saldoClase === "pagado"));
  });
  test("moneda de cobro y agencia", async () => {
    const usd = await ok({ moneda: "USD" });
    assert.deepEqual(numeros(usd).sort(), ["DTM-10608", "DTM-10616", "MIN-00-0904"]);
    const min = await ok({ agencia: "minorista" });
    assert.equal(min.datos.total, 15); assert.ok(min.datos.filas.every((f) => f.tenant === "minorista"));
    const may = await ok({ agencia: "mayorista" });
    assert.equal(may.datos.total, 47);
  });
  test("el resumen separa agencia y moneda y nunca mezcla COP con USD", async () => {
    const r = await ok({ numero: "-106" });
    const llaves = r.datos.resumen.map((x) => `${x.tenant}:${x.moneda}`);
    assert.equal(new Set(llaves).size, llaves.length);
    const may = r.datos.resumen.find((x) => x.tenant === "mayorista" && x.moneda === "COP")!;
    const esperado = json<number>("select coalesce(sum(t.total - coalesce(a.s,0)),0)::float8 from (select numero_contrato, estado, case when moneda_cobro is not null and moneda_cobro is distinct from coalesce(moneda,'COP') and coalesce(total_cobro,0)>0 and coalesce(trm_cobro,0)>0 then total_cobro else precio_venta end as total, case when moneda_cobro is not null and moneda_cobro is distinct from coalesce(moneda,'COP') and coalesce(total_cobro,0)>0 and coalesce(trm_cobro,0)>0 then moneda_cobro else coalesce(moneda,'COP') end as mon from public.ventas where tenant='mayorista' and numero_contrato like 'DTM-106%') t left join (select numero_contrato, sum(valor_abono) s from public.abonos group by 1) a using (numero_contrato) where t.mon='COP' and t.estado not in ('cancelado') and t.total - coalesce(a.s,0) > 0");
    assert.equal(may.saldoPorCobrar, esperado);
  });
  test("fechas: bordes inclusivos y rangos vacíos", async () => {
    // DTM-10601: compra 2026-09-02, salida 2026-12-10
    assert.ok(numeros(await ok({ venta_desde: "2026-09-02", venta_hasta: "2026-09-02", numero: "DTM-10601" })).includes("DTM-10601"));
    assert.ok(!numeros(await ok({ venta_desde: "2026-09-03", numero: "DTM-10601" })).includes("DTM-10601"));
    assert.ok(!numeros(await ok({ venta_hasta: "2026-09-01", numero: "DTM-10601" })).includes("DTM-10601"));
    assert.ok(numeros(await ok({ salida_desde: "2026-12-10", salida_hasta: "2026-12-10", numero: "DTM-10601" })).includes("DTM-10601"));
    assert.ok(!numeros(await ok({ salida_desde: "2026-12-11", numero: "DTM-10601" })).includes("DTM-10601"));
    assert.ok(!numeros(await ok({ salida_hasta: "2026-12-09", numero: "DTM-10601" })).includes("DTM-10601"));
    const vacio = await ok({ venta_desde: "2030-01-01" });
    assert.equal(vacio.datos.total, 0); assert.deepEqual(vacio.datos.filas, []); assert.deepEqual(vacio.datos.resumen, []);
    const inv = await ok({ venta_desde: "2026-11-30", venta_hasta: "2026-11-01" });
    assert.equal(inv.datos.total, 0); assert.ok(inv.avisos.length >= 1);
  });
  test("estado: «confirmado» agrupa confirmado y activo; «cancelado» agrupa las variantes", async () => {
    const c = await ok({ estado: "confirmado", numero: "-106" });
    assert.ok(numeros(c).includes("DTM-10617") && numeros(c).includes("DTM-10601"));
    assert.deepEqual(numeros(await ok({ estado: "cancelado", numero: "-106" })), ["DTM-10605"]);
    assert.ok(numeros(await ok({ estado: "cancelado", agencia: "minorista" })).includes("MIN-00-0903"));
    sql("set session_replication_role = replica; update public.ventas set estado = 'Anulada' where numero_contrato = 'DTM-10603'; set session_replication_role = origin;");
    try { assert.ok(numeros(await ok({ estado: "cancelado", numero: "DTM-10603" })).includes("DTM-10603")); }
    finally { sql("set session_replication_role = replica; update public.ventas set estado = 'pendiente' where numero_contrato = 'DTM-10603'; set session_replication_role = origin;"); }
  });
  test("búsqueda de texto: % y _ son literales, comillas e inyecciones no rompen ni devuelven todo", async () => {
    for (const q of ["%", "_", "'; drop table ventas; --", "\\", "10601' or '1'='1"]) {
      const r = await ok({ numero: q });
      assert.equal(r.datos.total, 0, `«${q}» no debe coincidir con nada`);
    }
    assert.equal((await ok({ cliente: "Cliente DTM-10601" })).datos.total, 1);
    assert.ok(Number(sql("select count(*) from public.ventas")) === 62, "la tabla sigue intacta");
  });
  test("la RPC rechaza filtros desconocidos, valores y fechas inválidas, órdenes ajenos; acota el límite a 100", async () => {
    for (const filtros of [{ hack: "x" }, { tenant: "otra" }, { saldo: "x" }, { venta_desde: "2026-02-30" }, { estado: 3 }, ["a"]]) {
      const r = await rpcSa("fn_gestion_contratos", { p_filtros: filtros, p_orden: "venta_desc", p_limite: 25, p_desplazamiento: 0 });
      assert.equal(r.error?.code, "22023", JSON.stringify(filtros));
    }
    assert.equal((await rpcSa("fn_gestion_contratos", { p_filtros: {}, p_orden: "id; drop", p_limite: 25, p_desplazamiento: 0 })).error?.code, "22023");
    const grande = (await rpcSa("fn_gestion_contratos", { p_filtros: {}, p_orden: "numero_asc", p_limite: 100000, p_desplazamiento: 0 })).data as { filas: unknown[]; limite: number };
    assert.equal(grande.limite, 100); assert.ok(grande.filas.length <= 100);
    const neg = (await rpcSa("fn_gestion_contratos", { p_filtros: {}, p_orden: "numero_asc", p_limite: -5, p_desplazamiento: -9 })).data as { filas: unknown[]; limite: number; desplazamiento: number };
    assert.deepEqual([neg.limite, neg.desplazamiento, neg.filas.length], [1, 0, 1]);
  });
  test("orden determinista (sin piso de «Viaje más reciente»): páginas contiguas sin solapes con empates de fecha", async () => {
    const a = [...(await ok({ orden: "salida_desc", pagina: "1" })).datos.filas, ...(await ok({ orden: "salida_desc", pagina: "2" })).datos.filas, ...(await ok({ orden: "salida_desc", pagina: "3" })).datos.filas].map((f) => f.numero);
    assert.equal(new Set(a).size, 62);
    const b = [...(await ok({ orden: "salida_desc", pagina: "1" })).datos.filas].map((f) => f.numero);
    assert.deepEqual(b, a.slice(0, 25), "repetir la consulta da el mismo orden");
    const fueraRango = await ok({ pagina: "4" });
    assert.equal(fueraRango.datos.total, 62); assert.equal(fueraRango.datos.filas.length, 0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("voucher, factura y comisión: lo generado no es lo entregado/enviado; NETO no es pendiente", () => {
  const m = async () => ok({ numero: "-106", orden: "numero_asc" });
  test("voucher: preparado sin acuse = pendiente; acuse vigente = entregado; un voucher NUEVO después del acuse lo limpia (pendiente + acuse anterior en el historial); sin voucher = sin_voucher", async () => {
    const r = await m(); const e = (n: string) => fila(r, n).voucher.entrega;
    assert.equal(e("DTM-10601"), "entregado"); assert.equal(e("DTM-10602"), "pendiente"); assert.equal(e("DTM-10604"), "pendiente"); assert.equal(fila(r, "DTM-10604").voucher.acuseAnterior, true, "el acuse anterior sigue visible");
    assert.equal(fila(r, "DTM-10602").voucher.acuseAnterior, false);
    assert.equal(e("DTM-10606"), "entregado"); assert.equal(e("DTM-10609"), "pendiente"); assert.equal(e("DTM-10603"), "sin_voucher"); assert.equal(e("DTM-10610"), "sin_voucher");
    assert.equal(fila(r, "DTM-10601").voucher.canal, "whatsapp"); assert.equal(fila(r, "DTM-10601").voucher.n, 2);
  });
  test("factura: «emitida» = validada en la DIAN (asiento o N° solos = sin validar); emitida ≠ enviada; sin DIAN no se pide acuse", async () => {
    const r = await m(); const x = (n: string) => fila(r, n).factura;
    assert.deepEqual([x("DTM-10601").emitida, x("DTM-10601").contable, x("DTM-10601").dian, x("DTM-10601").envio], [true, true, true, "enviada"]);
    assert.deepEqual([x("DTM-10602").emitida, x("DTM-10602").estado, x("DTM-10602").contable, x("DTM-10602").registros, x("DTM-10602").envio], [false, "sin_validar", false, 1, "sin_factura"], "número antiguo sin DIAN");
    assert.deepEqual([x("DTM-10606").emitida, x("DTM-10606").estado, x("DTM-10606").contable, x("DTM-10606").envio], [false, "sin_validar", true, "sin_factura"], "asiento contable sin DIAN");
    assert.deepEqual([x("DTM-10609").emitida, x("DTM-10609").estado, x("DTM-10609").dian, x("DTM-10609").envio], [true, "emitida", true, "pendiente"], "DIAN sin acuse de envío");
    assert.deepEqual([x("DTM-10603").emitida, x("DTM-10603").envio], [false, "sin_factura"]);
  });
  test("filtros de entrega y envío usan SOLO los acuses", async () => {
    assert.deepEqual(numeros(await ok({ entrega: "entregado", numero: "-106" })).sort(), ["DTM-10601", "DTM-10606"]);
    const pend = numeros(await ok({ entrega: "pendiente", numero: "-106" }));
    assert.ok(pend.includes("DTM-10602") && pend.includes("DTM-10609") && pend.includes("DTM-10604") && !pend.includes("DTM-10601"));
    assert.deepEqual(numeros(await ok({ envio: "enviada", numero: "-106" })), ["DTM-10601"]);
    const pe = numeros(await ok({ envio: "pendiente", numero: "-106" }));
    assert.ok(pe.includes("DTM-10609") && !pe.includes("DTM-10602") && !pe.includes("DTM-10606") && !pe.includes("DTM-10601") && !pe.includes("DTM-10603"), "solo una factura DIAN sin acuse espera el envío");
    assert.deepEqual(numeros(await ok({ factura: "emitida", numero: "-106" })).filter((n) => ["DTM-10601", "DTM-10602", "DTM-10603", "DTM-10606", "DTM-10609"].includes(n)).sort(), ["DTM-10601", "DTM-10609"]);
    const sinEmitir = numeros(await ok({ factura: "sin_emitir", numero: "-106" }));
    assert.ok(sinEmitir.includes("DTM-10603") && sinEmitir.includes("DTM-10602") && sinEmitir.includes("DTM-10606") && !sinEmitir.includes("DTM-10601"));
    const con = numeros(await ok({ voucher: "con", numero: "-106" })), sin = numeros(await ok({ voucher: "sin", numero: "-106" }));
    assert.ok(con.includes("DTM-10609") && !con.includes("DTM-10603") && sin.includes("DTM-10603") && !sin.includes("DTM-10609"));
  });
  test("datos históricos sin seguimiento NO se infieren como entregados/enviados", async () => {
    const r = await ok({ numero: "-109", agencia: "minorista" });
    for (const f of r.datos.filas) assert.notEqual(f.voucher.entrega === "entregado" && f.voucher.evento == null, true);
    assert.equal(fila(await ok({ numero: "DTM-10609" }), "DTM-10609").voucher.entrega, "pendiente");
    assert.equal(Number(sql("select count(*) from public.contrato_seguimiento where accion = 'marcar'")), 5, "solo existen los 5 acuses de la semilla");
  });
  test("comisión: NETO descontada no es pendiente; pendiente/parcial/pagada/retenida/prevista/sin_definir/revisión NETO/no aplica", async () => {
    const r = await m(); const c = (n: string) => fila(r, n).comision.clase;
    assert.equal(c("DTM-10606"), "descontada"); assert.equal(c("DTM-10602"), "pendiente"); assert.equal(c("DTM-10607"), "pagada"); assert.equal(c("DTM-10614"), "parcial");
    assert.equal(c("DTM-10612"), "retenida"); assert.equal(c("DTM-10611"), "prevista"); assert.equal(c("DTM-10613"), "sin_definir"); assert.equal(c("DTM-10615"), "revision_neto");
    assert.equal(c("DTM-10601"), "no_aplica");
    assert.ok(!numeros(await ok({ comision: "pendiente", numero: "-106" })).includes("DTM-10606"), "una NETO descontada nunca aparece como comisión pendiente");
    assert.deepEqual(numeros(await ok({ comision: "descontada", numero: "-106" })), ["DTM-10606"]);
  });
  test("PARIDAD de la clase de comisión con las reglas TS existentes (estadoComisionFila), fila por fila", async () => {
    const filas = json<Record<string, unknown>[]>("select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.aliados_b2b a");
    const pagos = json<{ aliado_b2b_id: number; valor: number }[]>("select coalesce(jsonb_agg(to_jsonb(p)), '[]') from public.comision_b2b_pagos p");
    const ventas = json<{ numero_contrato: string; comision_estado: string | null }[]>("select coalesce(jsonb_agg(to_jsonb(v)), '[]') from (select numero_contrato, comision_estado from public.ventas) v");
    const estadoVenta = new Map(ventas.map((v) => [v.numero_contrato, v.comision_estado]));
    const pagado = sumarPagosPorAliado(pagos);
    const retenidas = new Set(json<number[]>("select coalesce(jsonb_agg(aliado_b2b_id), '[]') from public.comision_b2b_revision"));
    const porContrato = new Map<string, string[]>();
    for (const a of filas) {
      const fil = a as never;
      const c = calcularComisionFila(fil);
      const ce = estadoVenta.get(String(a.numero_contrato));
      const desc = esComisionDescontada(fil, ce); const neto = esComisionEnContratoNeto(fil, ce);
      const est = retenidas.has(Number(a.id)) ? "retenida" : estadoComisionFila(c.totalPagar, pagado[Number(a.id)] ?? 0, desc, neto);
      porContrato.set(String(a.numero_contrato), [...(porContrato.get(String(a.numero_contrato)) ?? []), est]);
    }
    const peor = (es: string[]) => es.includes("retenida") ? "retenida" : es.includes("revision_neto") ? "revision_neto" : es.includes("pendiente") ? "pendiente" : es.includes("parcial") ? "parcial" : es.every((x) => x === "descontada") ? "descontada" : "pagada";
    const r = (await Promise.all([1, 2, 3].map((p) => ok({ pagina: String(p) })))).flatMap((x) => x.datos.filas);
    assert.ok(porContrato.size >= 7);
    for (const [num, es] of porContrato) assert.equal(r.find((f) => f.numero === num)!.comision.clase, peor(es), `${num}: ${es.join(",")}`);
  });
});

// ───────────────────────────────────────────────────────────────────────────
const TABLAS_FINANCIERAS = ["abonos", "abonos_anulados", "asientos_contables", "asiento_lineas", "facturacion", "contrato_facturacion", "vouchers", "cuentas_por_pagar", "cxp_pagos", "aliados_b2b", "comision_b2b_pagos", "comision_b2b_revision", "comision_plan", "ventas", "cuotas", "contrato_pasajeros"];
const huella = () => Object.fromEntries(TABLAS_FINANCIERAS.map((t) => [t, sql(`select count(*) || ':' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from public.${t} x`)]));

describe("acuses manuales: registrados, auditados, sin efectos financieros", () => {
  const E = (numero: string, tipo: "voucher_entregado" | "factura_enviada", accion: "marcar" | "desmarcar", canal?: string, nota?: string) =>
    registrarSeguimiento({ numero, uid: uidDe(numero), tipo, accion, canal, nota });
  const sesion = (uid: string | null) => { fijar(uid); };

  test("marcar la entrega de un voucher: guarda actor/hora/canal/nota, audita, revalida y NO toca nada financiero", async () => {
    sesion(U.SA);
    const antes = huella(); const aud0 = Number(sql("select count(*) from public.auditoria where tabla = 'contrato_seguimiento'")); revalidados.length = 0;
    const r = await E("DTM-10602", "voucher_entregado", "marcar", "correo", "  Enviado a agencia@x.test  ");
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(huella(), antes, "ninguna tabla financiera, de vouchers, de facturación o de comisiones cambió");
    const ev = json<{ accion: string; canal: string; nota: string; actor_id: string; actor_email: string; actor_nombre: string; creado_en: string; tenant: string; referencia: unknown }>(
      "select to_jsonb(s) from public.contrato_seguimiento s where numero_contrato = 'DTM-10602' and tipo = 'voucher_entregado' order by id desc limit 1");
    assert.deepEqual([ev.accion, ev.canal, ev.nota, ev.actor_id, ev.actor_email, ev.actor_nombre, ev.tenant], ["marcar", "correo", "Enviado a agencia@x.test", U.SA, "sa106@x.test", "Super Admin 106", "mayorista"]);
    assert.deepEqual(ev.referencia, { n: 1, max_id: Number(sql("select max(id) from public.vouchers where numero_contrato = 'DTM-10602'")) });
    assert.ok(Math.abs(Date.now() - new Date(ev.creado_en).getTime()) < 120_000);
    assert.equal(Number(sql("select count(*) from public.auditoria where tabla = 'contrato_seguimiento'")), aud0 + 1, "una fila de auditoría");
    assert.equal(sql("select actor_email from public.auditoria where tabla = 'contrato_seguimiento' order by id desc limit 1"), "sa106@x.test");
    assert.deepEqual(revalidados, ["/dashboard/gestion-contratos"]);
    const f = fila(await ok({ numero: "DTM-10602" }), "DTM-10602");
    assert.equal(f.voucher.entrega, "entregado"); assert.equal(f.voucher.actor, "Super Admin 106"); assert.equal(f.voucher.canal, "correo");
    assert.equal(f.factura.envio, "sin_factura", "marcar el voucher no marca la factura (y sin DIAN no hay factura que enviar)");
  });
  test("un acuse vigente no se duplica; retirarlo deja «pendiente» y se puede volver a registrar; el historial conserva los eventos", async () => {
    sesion(U.SA);
    assert.equal((await E("DTM-10602", "voucher_entregado", "marcar", "correo")).ok, false);
    assert.deepEqual(await E("DTM-10602", "voucher_entregado", "desmarcar", undefined, "Fue un error"), { ok: true });
    assert.equal(fila(await ok({ numero: "DTM-10602" }), "DTM-10602").voucher.entrega, "pendiente");
    assert.equal((await E("DTM-10602", "voucher_entregado", "desmarcar")).ok, false, "no hay acuse que retirar");
    assert.deepEqual(await E("DTM-10602", "voucher_entregado", "marcar", "presencial"), { ok: true });
    const eventos = sql("select string_agg(accion || ':' || coalesce(canal, '-'), ',' order by id) from public.contrato_seguimiento where numero_contrato = 'DTM-10602' and tipo = 'voucher_entregado'");
    assert.equal(eventos, "marcar:correo,desmarcar:-,marcar:presencial");
  });
  test("factura: se acusa el envío solo si la factura existe; contrato sin factura o sin voucher se rechaza", async () => {
    sesion(U.SA);
    const antes = Number(sql("select count(*) from public.contrato_seguimiento"));
    assert.equal((await E("DTM-10603", "factura_enviada", "marcar", "correo")).ok, false);
    assert.equal((await E("DTM-10603", "voucher_entregado", "marcar", "correo")).ok, false);
    assert.equal(Number(sql("select count(*) from public.contrato_seguimiento")), antes);
    assert.equal((await E("DTM-10602", "factura_enviada", "marcar", "whatsapp")).ok, false, "número antiguo sin validación DIAN: no hay factura emitida que enviar");
    assert.equal((await E("DTM-10606", "factura_enviada", "marcar", "whatsapp")).ok, false, "asiento contable sin validación DIAN: tampoco");
    assert.equal(Number(sql("select count(*) from public.contrato_seguimiento")), antes);
    assert.deepEqual(await E("DTM-10609", "factura_enviada", "marcar", "whatsapp"), { ok: true });
    assert.equal(fila(await ok({ numero: "DTM-10609" }), "DTM-10609").factura.envio, "enviada");
  });
  test("un voucher de REEMPLAZO limpia la entrega (se puede marcar de nuevo) y conserva el historial; ediciones ajenas NO la limpian", async () => {
    sesion(U.SA);
    // Ajenos al voucher: editar el contrato, el contenido de un voucher o borrar uno NO limpia la entrega registrada.
    sql("update public.ventas set observaciones = 'edición sin relación' where numero_contrato = 'DTM-10601'");
    sql("update public.vouchers set contenido = jsonb_build_object('hotel', 'Hotel editado') where numero_contrato = 'DTM-10601' and tipo = 'traslado'");
    assert.equal(fila(await ok({ numero: "DTM-10601" }), "DTM-10601").voucher.entrega, "entregado", "editar contrato/voucher no limpia");
    const antesEventos = Number(sql("select count(*) from public.contrato_seguimiento where numero_contrato = 'DTM-10601' and tipo = 'voucher_entregado'"));
    // Reemplazo: se genera un voucher nuevo (id mayor) → la entrega queda pendiente, el acuse anterior sigue visible y en el log.
    sql("insert into public.vouchers (numero_contrato, tipo, proveedor, contenido) values ('DTM-10601', 'asistencia', 'Asistencia Demo', '{}')");
    const f = fila(await ok({ numero: "DTM-10601" }), "DTM-10601");
    assert.equal(f.voucher.entrega, "pendiente"); assert.equal(f.voucher.acuseAnterior, true); assert.equal(f.voucher.canal, "whatsapp");
    assert.equal(Number(sql("select count(*) from public.contrato_seguimiento where numero_contrato = 'DTM-10601' and tipo = 'voucher_entregado'")), antesEventos, "el historial no se toca");
    assert.equal((await E("DTM-10601", "voucher_entregado", "desmarcar")).ok, false, "no hay entrega vigente que retirar");
    assert.deepEqual(await E("DTM-10601", "voucher_entregado", "marcar", "portal"), { ok: true });
    assert.equal(fila(await ok({ numero: "DTM-10601" }), "DTM-10601").voucher.entrega, "entregado");
    assert.equal(Number(sql("select count(*) from public.contrato_seguimiento where numero_contrato = 'DTM-10601' and tipo = 'voucher_entregado'")), antesEventos + 1, "el acuse nuevo se agrega; el anterior permanece");
    // Borrar un voucher (sin generar otro) tampoco limpia la entrega vigente.
    sql("delete from public.vouchers where numero_contrato = 'DTM-10601' and tipo = 'asistencia'");
    assert.equal(fila(await ok({ numero: "DTM-10601" }), "DTM-10601").voucher.entrega, "entregado", "borrar un voucher no es generar uno de reemplazo");
  });
  test("validaciones: canal obligatorio, nota ≤ 500, tipo/acción inválidos, uid mal formado", async () => {
    sesion(U.SA);
    const antes = Number(sql("select count(*) from public.contrato_seguimiento"));
    for (const e of [
      { numero: "DTM-10609", uid: uidDe("DTM-10609"), tipo: "voucher_entregado", accion: "marcar" },
      { numero: "DTM-10609", uid: uidDe("DTM-10609"), tipo: "voucher_entregado", accion: "marcar", canal: "paloma" },
      { numero: "DTM-10609", uid: uidDe("DTM-10609"), tipo: "voucher_entregado", accion: "marcar", canal: "correo", nota: "x".repeat(501) },
      { numero: "DTM-10609", uid: uidDe("DTM-10609"), tipo: "otro", accion: "marcar", canal: "correo" },
      { numero: "DTM-10609", uid: uidDe("DTM-10609"), tipo: "voucher_entregado", accion: "borrar", canal: "correo" },
      { numero: "DTM-10609", uid: "no-es-uuid", tipo: "voucher_entregado", accion: "marcar", canal: "correo" },
      { numero: "", uid: uidDe("DTM-10609"), tipo: "voucher_entregado", accion: "marcar", canal: "correo" },
    ]) assert.equal((await registrarSeguimiento(e as never)).ok, false, JSON.stringify(e));
    assert.equal(Number(sql("select count(*) from public.contrato_seguimiento")), antes);
    const directo = await rpcSa("registrar_seguimiento_contrato", { p_numero: "DTM-10609", p_contrato_uid: uidDe("DTM-10609"), p_tipo: "voucher_entregado", p_accion: "marcar", p_canal: null, p_nota: null });
    assert.equal(directo.error?.code, "22023");
  });
  test("IDENTIDAD: con el uid de un contrato que ya no existe, el número reutilizado NO recibe el acuse", async () => {
    sesion(U.SA);
    // Contrato de prueba con voucher, abierto en «pantalla» (uid viejo) y luego reemplazado por otro con el MISMO número.
    sql(`set session_replication_role = replica;
      insert into public.ventas (numero_contrato, tenant, cliente, destino, estado, asesor, precio_venta, moneda, financiero_estado) values ('DTM-10690', 'mayorista', 'Viejo', 'X', 'pendiente', 'Local Venta', 1000, 'COP', 'completo');
      insert into public.vouchers (numero_contrato, tipo, proveedor, contenido) values ('DTM-10690', 'hotel', 'H', '{}');
      set session_replication_role = origin;`);
    const viejo = uidDe("DTM-10690");
    assert.deepEqual(await registrarSeguimiento({ numero: "DTM-10690", uid: viejo, tipo: "voucher_entregado", accion: "marcar", canal: "correo" }), { ok: true });
    sql(`delete from public.ventas where numero_contrato = 'DTM-10690';
      set session_replication_role = replica;
      insert into public.ventas (numero_contrato, tenant, cliente, destino, estado, asesor, precio_venta, moneda, financiero_estado) values ('DTM-10690', 'mayorista', 'Nuevo', 'X', 'pendiente', 'Local Venta', 2000, 'COP', 'completo');
      insert into public.vouchers (numero_contrato, tipo, proveedor, contenido) values ('DTM-10690', 'hotel', 'H2', '{}');
      set session_replication_role = origin;`);
    const nuevo = uidDe("DTM-10690");
    assert.notEqual(nuevo, viejo);
    assert.equal(Number(sql("select count(*) from public.contrato_seguimiento where numero_contrato = 'DTM-10690'")), 0, "los acuses del contrato eliminado se fueron con él");
    const f = fila(await ok({ numero: "DTM-10690" }), "DTM-10690");
    assert.equal(f.cliente, "Nuevo"); assert.equal(f.voucher.entrega, "pendiente", "el contrato nuevo NO hereda el acuse del anterior"); assert.equal(f.uid, nuevo);
    const r = await registrarSeguimiento({ numero: "DTM-10690", uid: viejo, tipo: "voucher_entregado", accion: "marcar", canal: "correo" });
    assert.equal(r.ok, false); assert.match((r as { error: string }).error, /cambió|reemplaz/i);
    assert.equal(Number(sql("select count(*) from public.contrato_seguimiento where numero_contrato = 'DTM-10690'")), 0, "ni una fila para el contrato nuevo");
    const dir = await rpcSa("registrar_seguimiento_contrato", { p_numero: "DTM-10690", p_contrato_uid: viejo, p_tipo: "voucher_entregado", p_accion: "marcar", p_canal: "correo", p_nota: null });
    assert.equal(dir.error?.code, "F4601");
    assert.deepEqual(await registrarSeguimiento({ numero: "DTM-10690", uid: nuevo, tipo: "voucher_entregado", accion: "marcar", canal: "correo" }), { ok: true }, "con su identidad vigente sí se registra");
    assert.equal((await registrarSeguimiento({ numero: "DTM-10699", uid: viejo, tipo: "voucher_entregado", accion: "marcar", canal: "correo" })).ok, false, "un número que no existe tampoco");
  });
  test("un contrato con acuses bloquea la reutilización de su consecutivo (RELACION_CONTRATO_SEGUIMIENTO)", () => {
    const b = sql("select array_to_string(public.dtm_reuso_bloqueos('DTM-10601', true), ',')");
    assert.match(b, /RELACION_CONTRATO_SEGUIMIENTO/);
  });
  test("dos acuses simultáneos del mismo contrato: uno gana, el otro se rechaza, nunca dos vigentes", async () => {
    sesion(U.SA);
    const rs = await Promise.all([E("DTM-10609", "voucher_entregado", "marcar", "correo"), E("DTM-10609", "voucher_entregado", "marcar", "correo"), E("DTM-10609", "voucher_entregado", "marcar", "correo")]);
    assert.equal(rs.filter((r) => r.ok).length, 1, JSON.stringify(rs));
    assert.equal(Number(sql("select count(*) from public.contrato_seguimiento where numero_contrato = 'DTM-10609' and tipo = 'voucher_entregado' and accion = 'marcar'")), 1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("página real y consumo de solicitudes", () => {
  const plano = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  async function render(sp: Record<string, string | undefined> = {}, uid: string | null = U.SA) {
    fijar(uid);
    const el = await (PaginaGestion as unknown as (a: unknown) => Promise<unknown>)({ searchParams: Promise.resolve(sp) });
    return renderToStaticMarkup(el as never);
  }
  test("superadmin ve ambas agencias, textos honestos y enlaces directos; no hay tokens ni uid en el HTML", async () => {
    const html = await render({ numero: "-106", orden: "numero_asc" }) + await render({ agencia: "minorista", orden: "numero_asc" });
    const t = plano(html);
    for (const s of ["Entrega registrada manualmente", "Descontada en el precio (NETO)", "Sobrepagado", "Sin total", "Registro financiero incompleto", "Generado (", "Entrega sin registrar", "Acuse de envío desactualizado"]) assert.ok(t.includes(s), s);
    for (const n of ["DTM-10606", "DTM-10608", "00-0901", "00-0904"]) assert.ok(html.includes(`aria-label="Contrato ${n}"`), n);
    assert.ok(html.includes('/dashboard/contratos/DTM-10602?tab=cartera') && html.includes('/dashboard/contratos/DTM-10602#vouchers') && html.includes('/dashboard/contratos/DTM-10602?tab=facturacion') && html.includes('/dashboard/contratos/DTM-10606?tab=comisiones'));
    assert.ok(!/share_token|service_role/i.test(html));
    assert.ok(!html.includes(uidDe("DTM-10602")), "el HTML estático no expone el uid (solo viaja en el payload del control)");
  });
  test("un rol no superadmin es redirigido al dashboard y no se envía ninguna lectura de datos", async () => {
    peticiones.length = 0;
    await assert.rejects(render({}, U.GER), /NEXT_REDIRECT:\/dashboard/);
    assert.ok(!peticiones.some((p) => p.includes("fn_gestion_contratos")));
  });
  test("una respuesta de la base que falla se muestra como error, no como una lista vacía", async () => {
    const original = globalThis.fetch;
    const rota = (async (i: unknown, init?: unknown) => String(i).includes("fn_gestion_contratos") ? new Response(JSON.stringify({ message: "boom" }), { status: 500, headers: { "content-type": "application/json" } }) : original(i as never, init as never)) as typeof fetch;
    globalThis.fetch = rota;
    try { const t = plano(await render({})); assert.match(t, /No se pudo cargar la lista/); assert.ok(!/boom/.test(t), "el detalle técnico no se muestra"); }
    finally { globalThis.fetch = original; }
  });
  test("CONSUMO: una carga = 1 consulta de rol + 1 RPC; cada filtro y cada página igual; en reposo, cero", async () => {
    const medir = async (sp: Record<string, string>) => { peticiones.length = 0; await render(sp); return [...peticiones]; };
    for (const sp of [{}, { agencia: "minorista" }, { saldo: "con_saldo", orden: "saldo_desc" }, { pagina: "2" }, { numero: "106", venta_desde: "2026-09-01" }] as Record<string, string>[]) {
      const p = await medir(sp);
      assert.equal(p.length, 2, `${JSON.stringify(sp)}: ${p.join(" | ")}`);
      assert.equal(p.filter((x) => x.includes("/rpc/fn_gestion_contratos")).length, 1);
      assert.equal(p.filter((x) => x.includes("/usuarios")).length, 1);
    }
    peticiones.length = 0;
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(peticiones.length, 0, "tras renderizar y esperar, no hay sondeos ni reintentos");
  });
  test("una página de acciones: registrar un acuse = 1 consulta de rol + 1 RPC (sin lecturas por fila)", async () => {
    fijar(U.SA); peticiones.length = 0;
    await registrarSeguimiento({ numero: "DTM-10609", uid: uidDe("DTM-10609"), tipo: "voucher_entregado", accion: "desmarcar" });
    assert.ok(peticiones.length <= 2, peticiones.join(" | "));
    assert.equal(peticiones.filter((x) => x.includes("/rpc/registrar_seguimiento_contrato")).length, 1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// #126-E · «Viaje más reciente» (orden salida_asc) = salidas de HOY (America/Bogota) en adelante, la más próxima primero.
// Reloj inyectado en el cargador real; consulta real a fn_gestion_contratos; el conjunto del dato se aísla con el filtro «numero» = DTM-91.
// ───────────────────────────────────────────────────────────────────────────
describe("#126-E · Viaje más reciente: hoy (Bogotá) en adelante, el más próximo primero", () => {
  const HOY = "2030-06-15";
  const D = (n: number) => { const d = new Date(Date.UTC(2030, 5, 15 + n)); return d.toISOString().slice(0, 10); };
  // «ahora» (instantes UTC) → día de Bogotá (UTC-5, sin horario de verano)
  const AHORA = {
    mediodia: new Date("2030-06-15T17:00:00Z"),           // 12:00 en Bogotá → 2030-06-15
    ultimoSegundo: new Date("2030-06-16T04:59:59Z"),      // 23:59:59 en Bogotá → todavía 2030-06-15 (en UTC ya es el 16)
    medianoche: new Date("2030-06-16T05:00:00Z"),         // 00:00:00 en Bogotá → 2030-06-16
    trampaUtc: new Date("2030-06-16T02:00:00Z"),          // 21:00 del 15 en Bogotá; el día UTC (16) lo daría por pasado
  };
  const FUT = Array.from({ length: 30 }, (_, i) => ({ n: `DTM-9${String(1100 + i)}`, salida: D(20 + i) }));       // 30 futuros (para paginar: 25 + 5)
  const PROPIOS = [
    { n: "DTM-91001", salida: D(-1), cliente: "Ayer" },
    { n: "DTM-91002", salida: D(0), cliente: "Hoy" },
    { n: "DTM-91003", salida: D(1), cliente: "Mañana" },
    { n: "DTM-91004", salida: null, cliente: "Sin fecha" },
    { n: "DTM-91005", salida: D(-400), cliente: "Histórico viejo" },
    { n: "DTM-91006", salida: D(2), cliente: "Pasado mañana" },
  ];
  before(() => {
    const filas = [...PROPIOS.map((p) => ({ n: p.n, salida: p.salida, cliente: p.cliente })), ...FUT.map((f) => ({ n: f.n, salida: f.salida, cliente: `Futuro ${f.n}` }))];
    sql(`insert into public.ventas (numero_contrato, cliente, moneda, fecha_salida, fecha_venta, precio_venta, estado) values
      ${filas.map((f) => `(${lit(f.n)}, ${lit(f.cliente)}, 'COP', ${f.salida ? lit(f.salida) : "null"}, '2030-01-02', 1000000, 'pendiente')`).join(",\n")};`);
  });
  const cargarEn = async (ahora: Date, sp: Record<string, string | undefined> = {}): Promise<Ok> => {
    fijar(U.SA);
    const r = await cargarGestionContratos({ numero: "DTM-91", ...sp }, ahora);
    assert.equal(r.estado, "ok", JSON.stringify(r));
    return r as Ok;
  };
  const independiente = (desde: string) => num(sql(`select count(*) from public.ventas where numero_contrato like 'DTM-91%' and fecha_salida >= '${desde}'`));
  const num = (v: unknown) => Number(v);
  const plano = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  async function render(sp: Record<string, string | undefined> = {}) {
    fijar(U.SA);
    const el = await (PaginaGestion as unknown as (a: unknown) => Promise<unknown>)({ searchParams: Promise.resolve(sp) });
    return renderToStaticMarkup(el as never);
  }

  test("ayer / hoy / mañana: ayer queda fuera; hoy y mañana entran; el más próximo primero; sin fecha y viejo fuera", async () => {
    const r = await cargarEn(AHORA.mediodia, { orden: "salida_asc" });
    assert.equal(r.pisoDesde, HOY);
    const primeras = numeros(r).slice(0, 3);
    assert.deepEqual(primeras, ["DTM-91002", "DTM-91003", "DTM-91006"], "hoy, mañana, pasado mañana (la más próxima primero)");
    const todos = [...numeros(r), ...numeros(await cargarEn(AHORA.mediodia, { orden: "salida_asc", pagina: "2" }))];
    for (const fuera of ["DTM-91001", "DTM-91004", "DTM-91005"]) assert.ok(!todos.includes(fuera), `${fuera} no debe estar`);
  });

  test("medianoche de Bogotá: 23:59:59 sigue siendo HOY (aunque en UTC ya sea mañana); 00:00:00 ya es el día siguiente", async () => {
    const antes = await cargarEn(AHORA.ultimoSegundo, { orden: "salida_asc" });
    assert.equal(antes.pisoDesde, HOY); assert.equal(numeros(antes)[0], "DTM-91002", "el viaje de hoy todavía entra");
    const trampa = await cargarEn(AHORA.trampaUtc, { orden: "salida_asc" });
    assert.equal(trampa.pisoDesde, HOY); assert.equal(numeros(trampa)[0], "DTM-91002", "el día UTC (16) lo habría descartado");
    const despues = await cargarEn(AHORA.medianoche, { orden: "salida_asc" });
    assert.equal(despues.pisoDesde, "2030-06-16"); assert.equal(numeros(despues)[0], "DTM-91003", "00:00 Bogotá: el viaje de ayer-hoy sale, el de mañana pasa a ser el primero");
    assert.ok(!numeros(despues).includes("DTM-91002"));
  });

  test("ordenamiento futuro: ascendente por fecha de salida con desempate estable por número; sin repetidos entre páginas", async () => {
    const p1 = await cargarEn(AHORA.mediodia, { orden: "salida_asc", pagina: "1" });
    const p2 = await cargarEn(AHORA.mediodia, { orden: "salida_asc", pagina: "2" });
    const todas = [...p1.datos.filas, ...p2.datos.filas];
    const fechas = todas.map((f) => f.fechaSalida as string);
    assert.deepEqual(fechas, [...fechas].sort(), "ascendente por fecha");
    assert.equal(new Set(todas.map((f) => f.numero)).size, todas.length, "ninguna fila repetida entre páginas");
    assert.deepEqual(numeros(await cargarEn(AHORA.mediodia, { orden: "salida_asc", pagina: "1" })), numeros(p1), "repetir da el mismo orden");
  });

  test("conteos, totales y paginación COHERENTES: total = conteo independiente en SQL; resumen suma el total; 25 + resto; página fuera de rango vacía", async () => {
    const esperado = independiente(HOY);                        // 33: hoy, mañana, pasado mañana + 30 futuros
    assert.equal(esperado, 33);
    const p1 = await cargarEn(AHORA.mediodia, { orden: "salida_asc" });
    const p2 = await cargarEn(AHORA.mediodia, { orden: "salida_asc", pagina: "2" });
    const p3 = await cargarEn(AHORA.mediodia, { orden: "salida_asc", pagina: "3" });
    assert.deepEqual([p1.datos.total, p2.datos.total, p3.datos.total], [esperado, esperado, esperado], "el total no cambia con la página");
    assert.deepEqual([p1.datos.filas.length, p2.datos.filas.length, p3.datos.filas.length], [25, 8, 0]);
    assert.equal(p1.datos.resumen.reduce((s, r) => s + r.contratos, 0), esperado, "el resumen cuenta el MISMO conjunto que el total");
    // nunca una fila pasada dentro del conjunto contado
    const todas = [...p1.datos.filas, ...p2.datos.filas];
    assert.ok(todas.every((f) => f.fechaSalida != null && (f.fechaSalida as string) >= HOY));
  });

  test("HISTORIAL accesible de forma explícita: fechas de viaje elegidas mandan (sin piso); otros órdenes no tienen piso", async () => {
    const explicitoDesde = await cargarEn(AHORA.mediodia, { orden: "salida_asc", salida_desde: D(-1) });
    assert.equal(explicitoDesde.pisoDesde, null, "con «viaje desde» explícito no se aplica el piso");
    assert.ok(numeros(explicitoDesde).includes("DTM-91001"), "ayer vuelve a aparecer porque se pidió explícitamente");
    const soloHasta = await cargarEn(AHORA.mediodia, { orden: "salida_asc", salida_hasta: D(-1) });
    assert.equal(soloHasta.pisoDesde, null);
    assert.deepEqual(numeros(soloHasta), ["DTM-91005", "DTM-91001"], "solo pasados, en orden ascendente; el histórico viejo y ayer");
    assert.equal(soloHasta.datos.total, 2);
    const otroOrden = await cargarEn(AHORA.mediodia, { orden: "salida_desc" });
    assert.equal(otroOrden.pisoDesde, null);
    assert.ok(numeros(otroOrden).length === 25 && otroOrden.datos.total === 36, "sin piso: los 36 propios (incluye ayer, histórico y sin fecha)");
    const ventaDesc = await cargarEn(AHORA.mediodia, {});
    assert.equal(ventaDesc.pisoDesde, null); assert.equal(ventaDesc.datos.total, 36);
  });

  test("contratos SIN fecha de salida: fuera de «Viaje más reciente», visibles en los demás órdenes (nulos al final)", async () => {
    assert.ok(!numeros(await cargarEn(AHORA.mediodia, { orden: "salida_asc" })).includes("DTM-91004"));
    const desc = [...(await cargarEn(AHORA.mediodia, { orden: "salida_desc", pagina: "1" })).datos.filas, ...(await cargarEn(AHORA.mediodia, { orden: "salida_desc", pagina: "2" })).datos.filas];
    assert.ok(desc.some((f) => f.numero === "DTM-91004" && f.fechaSalida == null), "el contrato sin fecha sigue accesible");
    assert.equal(desc[desc.length - 1].fechaSalida, null, "los nulos van al final");
  });

  test("la página real dice la regla, el día de Bogotá y cuenta el MISMO conjunto; con fechas explícitas lo aclara", async () => {
    const { fechaNegocio } = await import("../lib/fechaNegocio.ts");
    const hoyReal = fechaNegocio(new Date());
    const html = plano(await render({ orden: "salida_asc", numero: "DTM-91" }));
    assert.match(html, new RegExp(`con viaje desde hoy \\(${hoyReal}, hora de Bogotá\\)`));
    assert.match(html, /no incluye viajes pasados ni contratos sin fecha de salida/);
    assert.ok(!/«Viaje más reciente» muestra solo salidas/.test(plano(await render({ orden: "venta_desc", numero: "DTM-91" }))), "otros órdenes: sin nota");
    const explicito = plano(await render({ orden: "salida_asc", numero: "DTM-91", salida_desde: "2000-01-01" }));
    assert.match(explicito, /también salidas anteriores a hoy/);
    assert.ok(!/con viaje desde hoy/.test(explicito));
  });
});
