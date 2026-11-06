// #82 — si falla la lectura de estrellas/descripción/ubicación de una ficha vinculada, el guardado SE DETIENE con un error claro y no escribe nada.
// Ejecuta el `guardarPaqueteTotal` real con clientes Supabase falsos (sin red ni base): el paquete existente no se altera (ninguna escritura ni RPC de guardado).
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// `next` no publica mapa "exports": en ESM plano sus subrutas no resuelven (mismo truco que cambiarTenant237.test.ts).
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { if (s === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }; return n(s === "next/cache" ? s + ".js" : s, c); }'));

type Fila = Record<string, unknown>;
const escrituras: string[] = [];
let leerInfoHoteles: "ok" | "error" = "ok";
let rpcs: { fn: string; args: Fila }[] = [];

// Constructor encadenable: cualquier método lo devuelve; `await` (o maybeSingle) responde según tabla y columnas pedidas.
function constructor(tabla: string, resolver: (t: string, select: string, maybe: boolean) => { data: unknown; error: unknown }) {
  let select = ""; let maybe = false;
  const b: Record<string, unknown> = new Proxy({}, {
    get(_o, prop: string) {
      if (prop === "then") return (ok: (v: unknown) => unknown) => ok(resolver(tabla, select, maybe));
      if (prop === "insert" || prop === "update" || prop === "delete" || prop === "upsert") return () => { escrituras.push(`${tabla}.${prop}`); return b; };
      return (...a: unknown[]) => { if (prop === "select") select = String(a[0] ?? ""); if (prop === "maybeSingle" || prop === "single") maybe = true; return b; };
    },
  });
  return b;
}
const catalogos = (t: string, select: string, maybe: boolean) => {
  const una = (x: unknown) => ({ data: maybe ? x : [x].filter(Boolean), error: null });
  switch (t) {
    case "usuarios": return una({ rol: "superadmin" });
    case "paquete_din": return una({ tenant: "mayorista" });
    case "categorias_habitacion": return { data: [{ nombre: "Estándar" }], error: null };
    case "planes_alimentacion": return { data: [{ codigo: "PAE" }], error: null };
    case "hotel_categorias": return { data: [{ hotel_id: 5, categorias_habitacion: { nombre: "Estándar" } }], error: null };
    case "hotel_regimenes": return { data: [{ hotel_id: 5, planes_alimentacion: { codigo: "PAE" } }], error: null };
    case "hoteles":
      if (select.includes("estrellas")) return leerInfoHoteles === "error" ? { data: null, error: { message: "canceling statement due to statement timeout" } } : { data: [{ id: 5, estrellas: 4, descripcion: "Frente al mar", ubicacion: "Bocagrande, Cartagena" }], error: null };
      return { data: [{ id: 5, moneda: "COP" }], error: null };
    default: return { data: [], error: null };
  }
};
const cliente = () => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  from: (t: string) => constructor(t, catalogos),
  rpc: async (fn: string, args: Fila) => { rpcs.push({ fn, args }); return fn === "hotel_vinculable_din" ? { data: true, error: null } : { data: 99, error: null }; },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => cliente() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => cliente() } });
mock.module("@/lib/cotizacion/acceso", { namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, tenant: "mayorista" }), autorizaTenant: () => true } });

const { guardarPaqueteTotal } = await import("../app/(dashboard)/dashboard/paquetes/total/actions.ts");

const neto = { sencilla: 100000, doble: 80000, triple: 70000, multiple: 60000, nino: 50000, nino2: 40000, infante: 0 };
const entrada = (o: Fila = {}) => ({
  id: 7, nombre: "Paquete", destinoId: 1, multidestino: false, destinosExtra: [], moneda: "COP", esquema: "neta_markup", pvpModo: null, pctMkPct: 20,
  usaVuelo: false, usaHotel: true, usaServicios: false, noches: 3, compraInicio: "", compraFin: "", viajeInicio: "", viajeFin: "", pvpGeneral: null, totalDeclarado: null,
  descripcion: "", incluye: "", noIncluye: "", vuelos: [], servicios: [],
  hoteles: [{ hotelId: 5, nombre: "Hotel ficha", categoria: "Estándar", regimen: "PAE", descripcion: "", fotoUrl: "", proveedor: "Prov", estrellas: null, ubicacion: "", neto, pvp: {}, pvpGeneral: null, capacidadNinos: null, edadInfanteMax: null, edadNinoMax: null }],
  ...o,
});

test("fallo al leer la ficha: error claro, el guardado se detiene y no se escribe nada (el paquete existente queda intacto)", async () => {
  leerInfoHoteles = "error"; escrituras.length = 0; rpcs = [];
  const r = await guardarPaqueteTotal(entrada() as never);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /No se pudo leer las estrellas, la descripción y la ubicación de la ficha del hotel vinculado\. No se guardó nada/);
  assert.deepEqual(escrituras, [], "ninguna escritura directa");
  assert.equal(rpcs.some((x) => x.fn === "guardar_paquete_din"), false, "no se llamó a guardar_paquete_din");
});

test("el mismo fallo sobre un paquete nuevo tampoco guarda nada", async () => {
  leerInfoHoteles = "error"; escrituras.length = 0; rpcs = [];
  const r = await guardarPaqueteTotal(entrada({ id: undefined }) as never);
  assert.equal(r.ok, false); assert.deepEqual(escrituras, []); assert.equal(rpcs.some((x) => x.fn === "guardar_paquete_din"), false);
});

test("control: sin fallo se guarda y la RPC recibe estrellas, descripción y ubicación COPIADAS de la ficha (aunque el navegador mande otra cosa)", async () => {
  leerInfoHoteles = "ok"; escrituras.length = 0; rpcs = [];
  const e = entrada(); (e.hoteles[0] as Fila).estrellas = 1; (e.hoteles[0] as Fila).ubicacion = "Manipulada";
  const r = await guardarPaqueteTotal(e as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  const g = rpcs.find((x) => x.fn === "guardar_paquete_din")!;
  assert.ok(g, "se llamó a guardar_paquete_din");
  const h = (g.args.p_hoteles as Fila[])[0];
  assert.equal(h.estrellas, 4); assert.equal(h.descripcion, "Frente al mar"); assert.equal(h.ubicacion, "Bocagrande, Cartagena");
});
