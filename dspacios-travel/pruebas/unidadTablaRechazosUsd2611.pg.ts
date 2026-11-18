// Owner correction batch 2026-11-18 · gap G2 — the unit-hotel search that the TABLE view now calls (buscarAlojamientosUnidadPorFechas), proved with REAL actions against PostgreSQL:
//   · capacity rejection: more travellers than the published tariff's maxPax → «sin_disponibilidad» (never a price), while the same hotel with fewer travellers is available;
//   · a USD unit hotel keeps its currency end to end (no conversion invented): USD 600 for 2 adults × 3 nights × USD 100, and USD 750 with a 5-year-old (child band 3–10 at USD 50);
//   · Adults Only with a minor is already covered by edadesHotelUnidadU1.pg.ts («Adults Only rechaza menores por su propia regla», same function, same migration set).
// Only the session plumbing is simulated; tariffs are created/published with the real tariff actions. SOLO base LOCAL desechable; launch:
//   MSYS_NO_PATHCONV=1 sh supabase/scripts/test_pg_local.sh pg304 plantilla304 PG263 pruebas/unidadTablaRechazosUsd2611.pg.ts supabase/migrations/20260601000303_*.sql … 311_*.sql
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG263_CONTENEDOR ?? "pg304";
const DB = process.env.PG263_BASE ?? "";
const PGRST = process.env.PG263_POSTGREST ?? "";
const SECRETO = process.env.PG263_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG263_BASE (desechable), PG263_POSTGREST y PG263_JWT_SECRET: usa supabase/scripts/test_pg_local.sh (prefijo PG263).");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(specifier, context, nextResolve) { const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true }; return nextResolve(specifier, context); } });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const UID_ADMIN = "00000000-0000-0000-0000-000000263003";
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
}
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/cotizacion/acceso", { namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, tenant: "mayorista" }), autorizaTenant: () => true } });
mock.module("@/lib/contrato/congelarCondicionesContrato", { namedExports: { componenteHotelReal: async () => null, componentePaqueteReal: async () => null, trmReferenciaAproximada: async () => null, congelarCondicionesContratoBestEffort: async () => {} } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteLocal(TOKEN_SERVICIO) } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => ({ get: () => undefined, getAll: () => [] as unknown[] }) } });

const { crearTarifaUnidadBorrador, publicarTarifaUnidad } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/tarifasUnidadActions.ts");
const { buscarAlojamientosUnidadPorFechas } = await import("../app/tarifario/busquedaUnidadActions.ts");

// Destinations/packages: COP (CARTAGENA U2) and USD (CARTAGENA U2 USD). Hotels: CAP4 (maxPax 4) and CAP6 (maxPax 6) in COP; USD hotel (maxPax 6) in USD.
const DEST_COP = 26301, DEST_USD = 26302, PAQ_COP = 26301, PAQ_USD = 26302;
const H = { CAP4: 26311, CAP6: 26312, USD: 26313 } as const;
const IDA = "2030-06-10", REG = "2030-06-13";
const REGLAS = [
  { categoria: "infante" as const, edadMinAnios: 0, edadMaxAnios: 2 },
  { categoria: "nino" as const, edadMinAnios: 3, edadMaxAnios: 10 },
  { categoria: "adulto" as const, edadMinAnios: 11, edadMaxAnios: 17 },
];
const entrada = (version: string, over: Record<string, unknown> = {}) => ({
  versionTarifario: version, temporada: "ALTA", comisionPct: 20, categoria: "Estandar", alimentacion: "PAM", unidadCobro: "persona" as const, valorBase: 100000,
  nino: 50000, infante: 0, periodicidadInfante: "por_noche" as const, capacidad: { minPax: 1, maxPax: 6, paxIncluidos: 0 },
  suplementos: { adultoAdicional: null, personaSola: null, menorAdicionalNino: null, menorAdicionalInfante: null },
  reglasEdad: REGLAS, fuenteDocumento: null, fuentePagina: null, ...over,
});

before(async () => {
  const ids = Object.values(H).join(",");
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin263@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_ADMIN}', 'admin263@x.test', 'Admin 263', 'administracion', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into public.destinos (id, nombre) values (${DEST_COP}, 'CARTAGENA U2'), (${DEST_USD}, 'CARTAGENA U2 USD') on conflict do nothing;
    insert into public.proveedores (id, nombre, tipo) values (26301, 'Proveedor Hotel U2', 'hotelero') on conflict do nothing;
    insert into public.categorias_habitacion (nombre) values ('Estandar') on conflict do nothing;
    insert into public.planes_alimentacion (codigo, nombre) values ('PAM', 'Pension alimenticia media') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, modelo_tarifario, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo, adults_only) values
      (${H.CAP4}, ${DEST_COP}, 'U2 Hotel capacidad 4', 26301, 'COP', 'unidad', 0, 2, 3, 10, 1, 4, true, false),
      (${H.CAP6}, ${DEST_COP}, 'U2 Hotel capacidad 6', 26301, 'COP', 'unidad', 0, 2, 3, 10, 1, 6, true, false),
      (${H.USD}, ${DEST_USD}, 'U2 Hotel USD', 26301, 'USD', 'unidad', 0, 2, 3, 10, 1, 6, true, false);
    insert into public.hotel_categorias (hotel_id, categoria_id) select h, (select id from public.categorias_habitacion where nombre = 'Estandar') from unnest(array[${ids}]) h;
    insert into public.hotel_regimenes (hotel_id, plan_id) select h, (select id from public.planes_alimentacion where codigo = 'PAM') from unnest(array[${ids}]) h;
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) select h, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa' from unnest(array[${ids}]) h;
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo) values
      (${PAQ_COP}, 'Porción U2', 'porcion_terrestre', 3, ${DEST_COP}, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true),
      (${PAQ_USD}, 'Porción U2 USD', 'porcion_terrestre', 3, ${DEST_USD}, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'USD', 'USD', true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values
      (${PAQ_COP}, ${H.CAP4}, array['Estandar'], array['PAM']), (${PAQ_COP}, ${H.CAP6}, array['Estandar'], array['PAM']), (${PAQ_USD}, ${H.USD}, array['Estandar'], array['PAM']);
  `);
  // Tariffs through the REAL actions (create + publish): capacity 4 and 6 in COP (100.000 adult / 50.000 child), USD hotel at USD 100 / USD 50.
  const publicar = async (h: number, e: ReturnType<typeof entrada>) => {
    const c = await crearTarifaUnidadBorrador(h, e);
    assert.equal(c.ok, true, JSON.stringify(c));
    const p = await publicarTarifaUnidad((c as { id: number }).id, h);
    assert.equal(p.ok, true, JSON.stringify(p));
  };
  await publicar(H.CAP4, entrada("u2-cap4", { capacidad: { minPax: 1, maxPax: 4, paxIncluidos: 0 } }));
  await publicar(H.CAP6, entrada("u2-cap6"));
  await publicar(H.USD, entrada("u2-usd", { valorBase: 100, nino: 50 }));
});

type Res = Awaited<ReturnType<typeof buscarAlojamientosUnidadPorFechas>>;
const buscar = (destino: string, destinoId: number, adultos: number, menores: number[]): Promise<Res> => buscarAlojamientosUnidadPorFechas({
  fechaIda: IDA, fechaRegreso: REG, destino, destinoId, habitaciones: [{ acom: "doble" }], adultos, cantidadMenores: menores.length, edadesMenores: menores,
});
const estados = (r: Res) => { assert.equal(r.ok, true, JSON.stringify(r)); const ok = r as Extract<Res, { ok: true }>; return new Map(ok.disponibilidad.map((d) => [d.hotelId, d])); };

describe("G2 · búsqueda por unidad de la VISTA TABLA: capacidad y moneda con el motor real", () => {
  test("C1 capacidad: 2 adultos + 3 menores = 5 viajeros > maxPax 4 → el hotel de capacidad 4 NO está disponible (sin precio); el de capacidad 6 sí", async () => {
    const m = estados(await buscar("CARTAGENA U2", DEST_COP, 2, [5, 6, 7]));
    assert.equal(m.get(H.CAP4)?.estado, "sin_disponibilidad", "5 > 4");
    assert.equal(m.get(H.CAP6)?.estado, "disponible", "5 ≤ 6");
    const cap4 = m.get(H.CAP4) as { opciones?: unknown[] } | undefined;
    assert.ok(!cap4?.opciones?.length, "un hotel sin disponibilidad no devuelve opciones ni precio");
  });

  test("C2 frontera: 2 adultos + 2 menores = 4 viajeros = maxPax 4 → los dos hoteles disponibles; con 1 menor (3 viajeros) también", async () => {
    for (const menores of [[5, 6], [5]]) {
      const m = estados(await buscar("CARTAGENA U2", DEST_COP, 2, menores));
      assert.equal(m.get(H.CAP4)?.estado, "disponible", `${2 + menores.length} ≤ 4`);
      assert.equal(m.get(H.CAP6)?.estado, "disponible");
    }
  });

  test("C3 precio por unidad COP a mano: 2 adultos × 3 noches × 100.000 = 600.000; con un niño de 5 (banda 3–10): 600.000 + 3 × 50.000 = 750.000", async () => {
    const solo = estados(await buscar("CARTAGENA U2", DEST_COP, 2, [])).get(H.CAP6) as { opciones: { precioVenta: number; moneda: string; paxTotal: number }[] };
    assert.deepEqual(solo.opciones.map((o) => ({ p: Number(o.precioVenta), m: o.moneda, pax: o.paxTotal })), [{ p: 600_000, m: "COP", pax: 2 }]);
    const con = estados(await buscar("CARTAGENA U2", DEST_COP, 2, [5])).get(H.CAP6) as { opciones: { precioVenta: number; paxTotal: number }[] };
    assert.deepEqual(con.opciones.map((o) => ({ p: Number(o.precioVenta), pax: o.paxTotal })), [{ p: 750_000, pax: 3 }]);
  });

  test("U1 hotel en USD: la moneda se conserva (USD 600 = 2 × 3 × USD 100; con un niño de 5 USD 750), sin convertir ni inventar tasa", async () => {
    const solo = estados(await buscar("CARTAGENA U2 USD", DEST_USD, 2, [])).get(H.USD) as { estado: string; opciones: { precioVenta: number; moneda: string }[] };
    assert.equal(solo.estado, "disponible");
    assert.deepEqual(solo.opciones.map((o) => ({ p: Number(o.precioVenta), m: o.moneda })), [{ p: 600, m: "USD" }]);
    const con = estados(await buscar("CARTAGENA U2 USD", DEST_USD, 2, [5])).get(H.USD) as { opciones: { precioVenta: number; moneda: string }[] };
    assert.deepEqual(con.opciones.map((o) => ({ p: Number(o.precioVenta), m: o.moneda })), [{ p: 750, m: "USD" }]);
  });

  test("U2 los destinos no se mezclan: buscar el destino COP no devuelve el hotel USD y viceversa (un paquete es de UNA moneda)", async () => {
    const cop = estados(await buscar("CARTAGENA U2", DEST_COP, 2, []));
    assert.equal(cop.has(H.USD), false);
    const usd = estados(await buscar("CARTAGENA U2 USD", DEST_USD, 2, []));
    assert.equal(usd.has(H.CAP6), false);
    assert.equal(usd.has(H.CAP4), false);
  });
});
