// #59 — Tarjeta «Cupos disponibles» del Home: enlace al inventario de vuelos solo para los roles que pueden abrir
// ese módulo (LECTURA_MODULO.vuelos, el mismo mapa del menú y de proxy.ts), sin consultas nuevas, con los conteos
// y la ventana hoy–día 14 (Bogotá) intactos. Renderiza la página REAL con un cliente Supabase sintético.
import * as nodeModule from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

type ResolveHook = (s: string, c: { parentURL?: string }, n: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const FRONTERAS: Record<string, string> = {
  "@/lib/supabase/server": datos("export async function createClient() { return globalThis.__dash59.cliente(); }"),
  "@/lib/tenant.server": datos("export async function getTenant() { return 'mayorista'; }"),
};
registerHooks({ resolve(s, c, next) { return FRONTERAS[s] ? { url: FRONTERAS[s], shortCircuit: true } : next(s, c); } });

type Llamada = { tipo: "from" | "rpc"; nombre: string; args: unknown[] };
const estado = { rol: "superadmin", llamadas: [] as Llamada[] };
const CUPOS = { capacidad: 40, ocupados: 25, disponibles: 15, records_disponibles: 3, proximos_disponibles: 6, proximos_records: 2 };
function builder(tipo: Llamada["tipo"], nombre: string, args: unknown[]) {
  const ll: Llamada = { tipo, nombre, args };
  estado.llamadas.push(ll);
  const resultado = () => {
    if (nombre === "usuarios") return { data: { nombre: "Prueba", rol: estado.rol }, error: null };
    if (nombre === "fn_dashboard_cupos_activos") return { data: CUPOS, error: null };
    return { data: null, error: null, count: 0 };
  };
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "lte", "not", "in", "order", "limit"]) q[m] = (...a: unknown[]) => { ll.args.push({ [m]: a }); return q; };
  q.single = () => q; q.maybeSingle = () => q;
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resultado()).then(ok, ko);
  return q;
}
(globalThis as unknown as { __dash59: unknown }).__dash59 = {
  cliente: () => ({
    auth: { async getUser() { return { data: { user: { id: "00000000-0000-0000-0000-000000000059" } } }; } },
    from: (t: string) => builder("from", t, []),
    rpc: (f: string, a: unknown) => builder("rpc", f, [a]),
  }),
};

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { default: DashboardPage } = await import("../app/(dashboard)/dashboard/page.tsx");
const { LECTURA_MODULO } = await import("../lib/constants.ts");
void React;

async function pintar(rol: string) {
  estado.rol = rol;
  estado.llamadas = [];
  const html = renderToStaticMarkup(await DashboardPage());
  return { html, llamadas: estado.llamadas.map((l) => `${l.tipo}:${l.nombre}`).sort() };
}
const tarjetaCupos = (html: string) => html.slice(html.indexOf("Cupos disponibles"), html.indexOf("Paquetes activos"));
const ENLACE = 'href="/dashboard/vuelos?vista=inventario"';

test("roles con módulo de vuelos: la tarjeta enlaza al inventario y conserva conteos", async () => {
  for (const rol of LECTURA_MODULO.vuelos) {
    const { html } = await pintar(rol);
    const t = tarjetaCupos(html);
    assert.ok(t.includes(ENLACE), `${rol}: enlace en la tarjeta`);
    assert.match(t, /Ver inventario de vuelos/);
    assert.match(t, /15 sillas disponibles/);
    assert.match(t, /en 3 records/);
    assert.match(t, /25 de 40/);
  }
});

test("venta (sin módulo de vuelos): la tarjeta no enlaza al inventario", async () => {
  assert.ok(!LECTURA_MODULO.vuelos.includes("venta" as never));
  const { html } = await pintar("venta");
  const t = tarjetaCupos(html);
  assert.match(t, /15 sillas disponibles/, "la cifra se sigue mostrando");
  assert.ok(!t.includes(ENLACE));
  assert.doesNotMatch(t, /Ver inventario de vuelos/);
});

test("sin consultas nuevas: el enlace no cambia las llamadas de la página; la ventana sigue siendo hoy..hoy+14", async () => {
  // Listas exactas de la página antes de #59 (el diff no añade ninguna llamada a Supabase): con o sin enlace.
  const BASE = ["from:bloqueos_vuelo", "from:paquetes", "from:usuarios", "rpc:fn_dashboard_contratos_por_estado", "rpc:fn_dashboard_cupos_activos"];
  const INTERNO = [...BASE, "from:meta_ventas_mensual", "rpc:fn_dashboard_cartera_por_moneda", "rpc:fn_dashboard_cxp_resumen", "rpc:fn_dashboard_ventas_mes"].sort();
  assert.deepEqual((await pintar("operaciones")).llamadas, INTERNO);
  assert.deepEqual((await pintar("venta")).llamadas, BASE);
  estado.rol = "operaciones";
  estado.llamadas = [];
  await DashboardPage();
  const cupos = estado.llamadas.find((l) => l.nombre === "fn_dashboard_cupos_activos")!;
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  assert.deepEqual(cupos.args[0], { p_hoy: hoy });
  const salidas = estado.llamadas.find((l) => l.nombre === "bloqueos_vuelo")!;
  const gte = salidas.args.find((x) => "gte" in (x as object)) as { gte: unknown[] };
  const lte = salidas.args.find((x) => "lte" in (x as object)) as { lte: unknown[] };
  assert.deepEqual(gte.gte, ["fecha_ida", hoy]);
  const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 14);
  assert.deepEqual(lte.lte, ["fecha_ida", d.toISOString().slice(0, 10)]);
});
