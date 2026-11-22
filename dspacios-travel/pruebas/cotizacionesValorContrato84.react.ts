// Se ejecuta con npm run test:react (loader del arnés).
// #84 (ADL-039) — PÁGINA REAL de cotizaciones del portal (cargadores reales + tabla real) contra una base en memoria:
// cotización → conversión → el portal muestra el valor ACTUAL del contrato con enlace, y el valor cotizado queda como histórico rotulado.
// Una edición interna del contrato se ve en la carga siguiente; el aliado B no ve nada del contrato de A; no hay columnas de costo; sin sondeo.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

// La lista de cotizaciones monta el botón «Solicitar contrato» (#78), cuya acción de servidor importa `next/cache` y el cliente admin: aquí solo se desvían a dobles, igual
// que el arnés hace con las demás acciones del portal; esta prueba no ejercita esa acción.
type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((context.parentURL ?? "").endsWith("/portal/b2b/cotizaciones/actions.ts")) {
      if (specifier === "next/cache") return { url: `data:text/javascript,${encodeURIComponent("export function revalidatePath() {}")}`, shortCircuit: true };
      if (specifier === "@/lib/supabase/admin") return { url: pathToFileURL(join(process.cwd(), "pruebas", "support", "stubs", "supabaseAdminStub.mjs")).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { default: PortalCotizaciones } = await import("../app/portal/b2b/cotizaciones/page.tsx");
const { supabaseEnMemoria } = await import("./support/memoriaSupabase.ts");
const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { __setAdmin, __resetAdmin } = await import("./support/stubs/supabaseAdminStub.mjs");

type Fila = Record<string, unknown>;
afterEach(() => { __resetClient(); __resetAdmin(); });

const UA = "u-a", EA = "a@correo.test", UB = "u-b", EB = "b@correo.test";
const usuario = (id: string, aliado: number, nombre: string): Fila => ({ id, nombre, rol: "freelance", activo: true, tenant: "mayorista", agencia_id: null, pct_comision: null, aliado_id: aliado, acceso_legacy_nombre: false });
// Cotización NETO asistida por personal interno para el aliado 7: se le cotizó 4.520.000; el PVP del cliente era 5.000.000.
const cotConvertida = (id: number, numero: string, extra: Fila = {}): Fila => ({
  id, codigo: `COT-${id}`, modo: "simple", estado: "convertida", numero_contrato: numero, tenant: "mayorista", creado_por: "interno@dspacios.test",
  payload: { b2bAsistido: { aliado_id: 7, modo_compra: "neta", total_exigible: 4520000 } },
  // La base en memoria no evalúa los alias JSON de PostgREST (`payload->b2bAsistido->>modo_compra`): se aportan ya resueltos, como los devuelve la base real.
  b2b_modo: "neta", b2b_total: "4520000", precio_venta: 5000000, moneda: "COP", destino: "SMR", cliente: "Cliente Uno", ...extra,
});
const venta = (n: string, extra: Fila = {}): Fila => ({
  numero_contrato: n, precio_venta: 4520000, moneda: "COP", estado: "confirmado", aliado_id: 7, b2b_usuario_id: null, tenant: "mayorista",
  costo_hotel: 3200000, costo_aereo: 800000, comision_b2b: 480000, ...extra,
});

function montar(t: Record<string, Fila[]>, sesion: string, optsAdmin = {}) {
  const lecturas: string[] = [];
  const base = supabaseEnMemoria(t, optsAdmin);
  __setAdmin({ from: (x: string) => { lecturas.push(x); return base.from(x); }, rpc: base.rpc });
  __setClient(supabaseEnMemoria(t, {}, sesion));
  return lecturas;
}
const pagina = async () => renderToStaticMarkup(await PortalCotizaciones({ searchParams: Promise.resolve({ vista: "asistidas" }) }) as never).replace(/<!-- -->/g, "").replace(/\s+/g, " ");
const mundo = (): Record<string, Fila[]> => ({
  usuarios: [{ ...usuario(UA, 7, "Laura Gómez"), email: EA }, { ...usuario(UB, 8, "Beto Viajes"), email: EB }],
  cotizaciones: [cotConvertida(1, "00-0451")],
  ventas: [venta("00-0451")],
  "rpc:comparativas_b2b_visibles": [],
});

test("P84-1 convertida: valor del contrato (vigente) + enlace al contrato + valor cotizado como histórico rotulado", async () => {
  montar(mundo(), UA);
  const h = await pagina();
  assert.match(h, /Valor del contrato[^$]*\$\s?4\.520\.000/);
  assert.match(h, /Valor cotizado: [^<]*(NETO)?[^$]*\$\s?4\.520\.000/);
  assert.match(h, /<a [^>]*href="\/portal\/b2b\/ventas\?vista=asistidas#contrato-00-0451"[^>]*>Contrato 00-0451<\/a>/);
});

test("P84-2 el personal interno edita el contrato: la SIGUIENTE carga muestra el valor nuevo; la cotización conserva su valor histórico (los hechos no se alteran)", async () => {
  const t = mundo();
  montar(t, UA);
  const antes = await pagina();
  assert.match(antes, /Valor del contrato[^$]*\$\s?4\.520\.000/);
  (t.ventas[0] as Fila).precio_venta = 4700000; // edición interna de `ventas.precio_venta`
  const despues = await pagina();
  assert.match(despues, /Valor del contrato[^$]*\$\s?4\.700\.000/);
  assert.match(despues, /Valor cotizado: [^$]*\$\s?4\.520\.000/);
  assert.equal((t.cotizaciones[0].payload as { b2bAsistido: { total_exigible: number } }).b2bAsistido.total_exigible, 4520000, "la cotización congelada no se tocó");
});

test("P84-3 aliado B (misma agencia) cuya cotización apunta al número de contrato de A: NO ve el valor ni el enlace, solo su valor cotizado rotulado", async () => {
  const t = mundo();
  t.cotizaciones = [cotConvertida(2, "00-0451", { payload: { b2bAsistido: { aliado_id: 8, modo_compra: "neta", total_exigible: 1000000 } }, b2b_total: "1000000" })];
  montar(t, UB);
  const h = await pagina();
  assert.doesNotMatch(h, /Valor del contrato/);
  assert.doesNotMatch(h, /4\.520\.000|4\.700\.000|enlace-contrato|#contrato-00-0451/);
  assert.match(h, /Valor cotizado/);
  assert.match(h, /Contrato 00-0451/); // el número que ya figuraba en su propia cotización, sin enlace
});

test("P84-4 sin columnas de costo en la página; moneda USD; contrato anulado; dato inválido cae al valor cotizado (nunca $0)", async () => {
  const t = mundo();
  t.cotizaciones = [cotConvertida(1, "00-0451"), cotConvertida(3, "00-0453", { moneda: "USD", precio_venta: 2500, b2b_total: "2260", payload: { b2bAsistido: { aliado_id: 7, modo_compra: "neta", total_exigible: 2260 } } }), cotConvertida(4, "00-0454")];
  t.ventas = [venta("00-0451", { estado: "anulado" }), venta("00-0453", { precio_venta: 2260, moneda: "USD" }), venta("00-0454", { precio_venta: null })];
  montar(t, UA);
  const h = await pagina();
  assert.match(h, /Contrato anulado/);
  assert.match(h, /Valor del contrato[^<]*<\/span>USD[^0-9<]*2[.,]260(?![0-9])/);
  assert.doesNotMatch(h, /3\.200\.000|800\.000|480\.000/);
  const fila454 = h.slice(h.indexOf("COT-4"));
  assert.match(fila454, /^COT-4.*?Valor cotizado/);
  assert.doesNotMatch(fila454.slice(0, fila454.indexOf("</tr>")), /Valor del contrato|\$\s?0(\D|$)/);
});

test("P84-5 lectura de contratos con error: aviso legible y solo valor cotizado; sin convertidas no se lee `ventas`; lecturas acotadas", async () => {
  const lecturasError = montar(mundo(), UA, { fallar: (c: { tabla: string }) => (c.tabla === "ventas" ? "error" : null) });
  const h = await pagina();
  assert.match(h, /No pudimos cargar el valor actual de tus contratos/);
  assert.doesNotMatch(h, /Valor del contrato/);
  assert.ok(lecturasError.filter((x) => x === "ventas").length <= 2);

  const t = mundo();
  t.cotizaciones = [cotConvertida(5, "x", { estado: "abierta", numero_contrato: null })];
  const lecturas = montar(t, UA);
  await pagina();
  assert.equal(lecturas.filter((x) => x === "ventas").length, 0, "ninguna cotización convertida: cero lecturas de contratos");
  const lecturas2 = montar(mundo(), UA);
  await pagina();
  assert.equal(lecturas2.filter((x) => x === "ventas").length, 1, "una convertida: exactamente una lectura de contratos por carga");
});

test("P84-5 tabla apilable en pantalla angosta: cada celda lleva su rótulo, así el valor del contrato y «Solicitar contrato» se alcanzan sin desplazamiento horizontal", async () => {
  montar(mundo(), UA);
  const h = await pagina();
  for (const rotulo of ["Cliente", "Destino", "Salida", "Vigencia", "Estado", "Modalidad", "Importe", "Documento"]) assert.match(h, new RegExp(`data-label="${rotulo}"`), `falta el rótulo ${rotulo}`);
  assert.match(h, /tablaApilable/, "la tabla usa el modo apilable del portal (como Cartera, Documentos y Ventas)");
});
