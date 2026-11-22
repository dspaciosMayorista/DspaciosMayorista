// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom).
// #78 — botón «Solicitar contrato» del portal (`components/portal/BotonSolicitarContrato.tsx`) dentro de la tabla de cotizaciones (`TablaCotizaciones`, tal cual):
//   solo aparece en cotizaciones VIGENTES (no convertidas, vencidas ni con salida pasada); es una acción aparte del documento; muestra el estado real que manda el servidor
//   (con y sin responsables configurados); un fallo del servidor no se presenta como «registrada»; pulsar llama UNA vez a la acción con el id de ESA fila.
import { test, afterEach, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/portal/b2b/cotizaciones", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  MouseEvent: dom.window.MouseEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

type R = { ok: true; estado: string; notificados: number } | { ok: false; error: string };
const pedidos: number[] = [];
let respuesta: R = { ok: true, estado: "solicitada", notificados: 2 };
mock.module(new URL("../app/portal/b2b/cotizaciones/actions.ts", import.meta.url).href, {
  namedExports: { solicitarContratoCotizacion: async (id: number) => { pedidos.push(id); return respuesta; } },
});

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { TablaCotizaciones } = await import("../components/portal/TablaCotizaciones.tsx");
const { act, createElement: h } = React;

const HOY = "2026-11-20";
const fila = (id: number, extra: Record<string, unknown> = {}) => ({
  id, codigo: `C-00${id}`, modo: "simple", cliente: "Cliente", destino: "Cartagena", hotel: null, pax: 2, precio_venta: 1000000, moneda: "COP", fecha_salida: "2027-01-10",
  vigencia_hasta: "2026-12-30", estado: "abierta", share_token: `tok${id}`, numero_contrato: null, created_at: "2026-11-01", ...extra,
});
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
async function render(filas: unknown[], solicitudes: Record<number, unknown> = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(h(TablaCotizaciones as never, { filas, hoy: HOY, vacio: "vacío", solicitudes } as never)));
}
const botones = () => [...container.querySelectorAll<HTMLButtonElement>('[data-testid="solicitar-contrato"]')];
const texto = () => container.textContent ?? "";

beforeEach(() => { pedidos.length = 0; respuesta = { ok: true, estado: "solicitada", notificados: 2 }; });
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = undefined; });
after(() => dom.window.close());

test("solo las VIGENTES tienen el botón: convertida, vencida y salida pasada no", async () => {
  await render([
    fila(1), fila(2, { estado: "convertida", numero_contrato: "00-0451" }), fila(3, { vigencia_hasta: "2026-11-01" }), fila(4, { fecha_salida: "2026-11-01" }),
  ]);
  assert.equal(botones().length, 1);
  assert.match(botones()[0].textContent ?? "", /Solicitar contrato/);
});

test("pulsar llama UNA vez a la acción con el id de esa fila y muestra la respuesta del servidor", async () => {
  await render([fila(1), fila(2)]);
  await act(async () => botones()[1].click());
  assert.deepEqual(pedidos, [2]);
  assert.match(texto(), /Solicitud de contrato registrada\. Avisamos a D'spacios\./);
});

test("sin responsables configurados lo dice: registrada, pero nadie fue avisado", async () => {
  respuesta = { ok: true, estado: "solicitada", notificados: 0 };
  await render([fila(1)]);
  await act(async () => botones()[0].click());
  assert.match(texto(), /Aún no hay responsables configurados/);
  assert.doesNotMatch(texto(), /Avisamos a D'spacios/);
});

test("un fallo del servidor se muestra como error, nunca como solicitud registrada", async () => {
  respuesta = { ok: false, error: "La cotización venció. Genera una nueva desde el tarifario." };
  await render([fila(1)]);
  await act(async () => botones()[0].click());
  assert.match(texto(), /La cotización venció/);
  assert.doesNotMatch(texto(), /Solicitud de contrato registrada/);
});

test("estado persistido: muestra la fecha y ofrece «Volver a solicitar»; con 0 notificados no afirma que se avisó", async () => {
  await render([fila(1), fila(2)], { 1: { cotizacion_id: 1, notificados: 2, creado_en: "2026-11-19T15:00:00Z" }, 2: { cotizacion_id: 2, notificados: 0, creado_en: "2026-11-19T15:00:00Z" } });
  const b = botones();
  assert.match(b[0].textContent ?? "", /Volver a solicitar/);
  assert.match(texto(), /Avisamos a D'spacios dentro de la plataforma/);
  assert.match(texto(), /Quedó registrado; aún no hay responsables configurados/);
  assert.equal(pedidos.length, 0, "mostrar el estado no hace peticiones");
});

test("repetir sin cambios muestra el mensaje de idempotencia", async () => {
  respuesta = { ok: true, estado: "ya_solicitada", notificados: 2 };
  await render([fila(1)], { 1: { cotizacion_id: 1, notificados: 2, creado_en: "2026-11-19T15:00:00Z" } });
  await act(async () => botones()[0].click());
  assert.match(texto(), /la cotización no ha cambiado/);
});
