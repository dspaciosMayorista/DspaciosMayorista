// #82 — destino y aeropuerto del vuelo en el SERVIDOR (guardarPaqueteTotal real con clientes Supabase falsos, sin red ni base):
//  · sin Multidestino el vuelo manual usa el IATA del destino principal LEÍDO del catálogo de destinos (no lo que mande el navegador);
//  · destino principal sin IATA → se rechaza pidiendo crearlo/completarlo en Destinos (nada se inventa) y no se escribe nada;
//  · con Multidestino se respeta el Destino IATA escrito; los vinculados conservan la ruta real del empaquetado.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { if (s === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }; return n(s === "next/cache" ? s + ".js" : s, c); }'));

type Fila = Record<string, unknown>;
let destinosCatalogo: Fila[] = [];
let empaquetados: Fila[] = [];
let rpcs: { fn: string; args: Fila }[] = [];
const escrituras: string[] = [];

function constructor(tabla: string, resolver: (t: string, maybe: boolean) => { data: unknown; error: unknown }) {
  let maybe = false;
  const b: Record<string, unknown> = new Proxy({}, {
    get(_o, prop: string) {
      if (prop === "then") return (ok: (v: unknown) => unknown) => ok(resolver(tabla, maybe));
      if (prop === "insert" || prop === "update" || prop === "delete" || prop === "upsert") return () => { escrituras.push(`${tabla}.${prop}`); return b; };
      return () => { if (prop === "maybeSingle" || prop === "single") maybe = true; return b; };
    },
  });
  return b;
}
const catalogos = (t: string, maybe: boolean) => {
  const una = (x: unknown) => ({ data: maybe ? x : [x].filter(Boolean), error: null });
  switch (t) {
    case "usuarios": return una({ rol: "superadmin" });
    case "paquete_din": return una({ tenant: "mayorista" });
    case "destinos": return { data: destinosCatalogo, error: null };
    case "empaquetados": return { data: empaquetados, error: null };
    default: return { data: [], error: null };
  }
};
const cliente = () => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  from: (t: string) => constructor(t, catalogos),
  rpc: async (fn: string, args: Fila) => { rpcs.push({ fn, args }); return { data: 99, error: null }; },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => cliente() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => cliente() } });
mock.module("@/lib/cotizacion/acceso", { namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, tenant: "mayorista" }), autorizaTenant: () => true } });

const { guardarPaqueteTotal } = await import("../app/(dashboard)/dashboard/paquetes/total/actions.ts");

const dest = (id: number, nombre: string, codigo_iata: string | null) => ({ id, nombre, pais: "Jamaica", codigo_iata });
const vuelo = (o: Fila = {}) => ({ empaquetadoId: null, destinoId: 1, aerolinea: "Avianca", ruta: "", origenIata: "bog", destinoIata: "", fechaIda: "", fechaRegreso: "", proveedor: "Avianca", neto: { adulto: 400000, infante: 50000 }, pvp: {}, ...o });
const entrada = (o: Fila = {}) => ({
  nombre: "Paquete", destinoId: 1, multidestino: false, destinosExtra: [], moneda: "COP", esquema: "neta_markup", pvpModo: null, pctMkPct: 20,
  usaVuelo: true, usaHotel: false, usaServicios: false, noches: 3, compraInicio: "", compraFin: "", viajeInicio: "", viajeFin: "", pvpGeneral: null, totalDeclarado: null,
  descripcion: "", incluye: "", noIncluye: "", vuelos: [vuelo()], hoteles: [], servicios: [], ...o,
});
const reiniciar = (d: Fila[], e: Fila[] = []) => { destinosCatalogo = d; empaquetados = e; rpcs = []; escrituras.length = 0; };
const guardado = () => (rpcs.find((x) => x.fn === "guardar_paquete_din")?.args.p_vuelos as Fila[] | undefined)?.[0];

test("SIN Multidestino y destino principal CON IATA: el servidor usa el del catálogo (ignora el que mande el navegador) y arma la ruta", async () => {
  reiniciar([dest(1, "MONTEGO BAY", "mbj")]);
  const r = await guardarPaqueteTotal(entrada({ vuelos: [vuelo({ destinoIata: "ZZZ" })] }) as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  const v = guardado()!;
  assert.equal(v.destino_iata, "MBJ"); assert.equal(v.origen_iata, "BOG"); assert.equal(v.ruta, "BOG - MBJ"); assert.equal(v.destino_id, 1);
});

test("SIN Multidestino, con regreso: la ruta es ida y vuelta y el vuelo sin destino toma el principal", async () => {
  reiniciar([dest(1, "MONTEGO BAY", "MBJ")]);
  const r = await guardarPaqueteTotal(entrada({ vuelos: [vuelo({ destinoId: null, fechaIda: "2030-01-10", fechaRegreso: "2030-01-13" })] }) as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(guardado()!.ruta, "BOG - MBJ - BOG"); assert.equal(guardado()!.destino_id, 1);
});

test("SIN Multidestino y destino principal SIN IATA (o con uno inválido): error que pide crearlo/completarlo en Destinos; no se inventa código ni se escribe nada", async () => {
  for (const codigo of [null, "", "  ", "AB", "M1J"]) {
    reiniciar([dest(1, "CARTAGENA", codigo)]);
    const r = await guardarPaqueteTotal(entrada({ vuelos: [vuelo({ destinoIata: "XYZ" })] }) as never);
    assert.equal(r.ok, false, `código ${JSON.stringify(codigo)}`);
    assert.match((r as { error: string }).error, /El destino principal «CARTAGENA» no tiene código IATA: créalo o complétalo en Producto → Destinos/);
    assert.deepEqual(escrituras, []); assert.equal(rpcs.some((x) => x.fn === "guardar_paquete_din"), false);
  }
});

test("SIN Multidestino: el Origen sigue siendo obligatorio y distinto del destino", async () => {
  reiniciar([dest(1, "MONTEGO BAY", "MBJ")]);
  let r = await guardarPaqueteTotal(entrada({ vuelos: [vuelo({ origenIata: "" })] }) as never);
  assert.equal(r.ok, false); assert.match((r as { error: string }).error, /origen como código IATA/);
  r = await guardarPaqueteTotal(entrada({ vuelos: [vuelo({ origenIata: "mbj" })] }) as never);
  assert.equal(r.ok, false); assert.match((r as { error: string }).error, /distintos/);
  assert.equal(rpcs.some((x) => x.fn === "guardar_paquete_din"), false);
});

test("CON Multidestino: se respeta el destino elegido y el Destino IATA escrito (no se sobrescribe con el del principal)", async () => {
  reiniciar([dest(1, "MONTEGO BAY", "MBJ"), dest(3, "KINGSTON", "KIN")]);
  const r = await guardarPaqueteTotal(entrada({ multidestino: true, destinosExtra: [3], vuelos: [vuelo({ destinoId: 3, destinoIata: "kin" })] }) as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  const v = guardado()!;
  assert.equal(v.destino_id, 3); assert.equal(v.destino_iata, "KIN"); assert.equal(v.ruta, "BOG - KIN");
});

test("CON Multidestino: sin Destino IATA escrito el servidor rechaza (no lo toma del destino por su cuenta)", async () => {
  reiniciar([dest(1, "MONTEGO BAY", "MBJ"), dest(3, "KINGSTON", "KIN")]);
  const r = await guardarPaqueteTotal(entrada({ multidestino: true, destinosExtra: [3], vuelos: [vuelo({ destinoId: 3, destinoIata: "" })] }) as never);
  assert.equal(r.ok, false); assert.match((r as { error: string }).error, /destino como código IATA/);
  assert.equal(rpcs.some((x) => x.fn === "guardar_paquete_din"), false);
});

test("Multidestino apagado con un vuelo de otro destino: rechazado (no se reasigna en silencio)", async () => {
  reiniciar([dest(1, "MONTEGO BAY", "MBJ"), dest(3, "KINGSTON", "KIN")]);
  const r = await guardarPaqueteTotal(entrada({ vuelos: [vuelo({ destinoId: 3 })] }) as never);
  assert.equal(r.ok, false); assert.match((r as { error: string }).error, /Multidestino está desactivado/);
  assert.equal(rpcs.some((x) => x.fn === "guardar_paquete_din"), false);
});

test("VINCULADO sin Multidestino: conserva la ruta REAL del empaquetado (no la del destino comercial) aunque el principal tenga o no IATA", async () => {
  for (const iataPrincipal of ["MBJ", null]) {
    reiniciar([dest(1, "MONTEGO BAY", iataPrincipal)], [{ id: 3, ruta: " PTY - KIN - PTY ", origen: "PTY", destino_id: 1 }]);
    const r = await guardarPaqueteTotal(entrada({ vuelos: [vuelo({ empaquetadoId: 3, origenIata: "", destinoIata: "", ruta: "MANIPULADA" })] }) as never);
    assert.equal(r.ok, true, JSON.stringify(r));
    const v = guardado()!;
    assert.equal(v.ruta, "PTY - KIN - PTY", "la ruta sale del empaquetado, no del navegador ni del destino principal");
    assert.equal(v.origen_iata, "PTY"); assert.equal(v.empaquetado_id, 3);
  }
});
