// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom).
// O-3 — panel «Preparar la solicitud (opcional)» del portal (`components/portal/PanelPreparacionContrato.tsx`) dentro de la tabla de cotizaciones, tal cual:
//   solo en cotizaciones VIGENTES; comprobantes (evidencia, NO un pago) y pasajeros adicionales opcionales; reglas de documento = las de la conversión; el servidor decide.
import { test, afterEach, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/portal/b2b/cotizaciones", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, File: dom.window.File, FormData: dom.window.FormData,
  MouseEvent: dom.window.MouseEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const llamadas: { fn: string; args: unknown[] }[] = [];
let respAdjuntar: { ok: true } | { ok: false; error: string } = { ok: true };
let respGuardar: { ok: true; guardados?: number } | { ok: false; error: string } = { ok: true, guardados: 1 };
// El cargador de pruebas resuelve las acciones del panel a este stub (convención del proyecto para Server Actions); aquí se sustituye por dobles que registran cada llamada.
mock.module(new URL("./support/stubs/preparacionActionsStub.mjs", import.meta.url).href, {
  namedExports: {
    adjuntarEvidenciaCotizacion: async (fd: FormData) => { llamadas.push({ fn: "adjuntar", args: [fd.get("cotizacionId"), (fd.get("archivo") as File | null)?.name] }); return respAdjuntar; },
    retirarEvidenciaCotizacion: async (id: number) => { llamadas.push({ fn: "retirar", args: [id] }); return { ok: true }; },
    guardarPasajerosAliado: async (id: number, lista: unknown[]) => { llamadas.push({ fn: "guardar", args: [id, lista] }); return respGuardar; },
  },
});
mock.module(new URL("../app/portal/b2b/cotizaciones/actions.ts", import.meta.url).href, { namedExports: { solicitarContratoCotizacion: async () => ({ ok: true, estado: "solicitada", notificados: 1 }) } });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { TablaCotizaciones } = await import("../components/portal/TablaCotizaciones.tsx");
const { act, createElement: h } = React;

const HOY = "2026-11-21";
const fila = (id: number, extra: Record<string, unknown> = {}) => ({
  id, codigo: `C-00${id}`, modo: "simple", cliente: "Cliente", destino: "Cartagena", hotel: null, pax: 2, precio_venta: 1000000, moneda: "COP", fecha_salida: "2027-01-10",
  vigencia_hasta: "2026-12-30", estado: "abierta", share_token: `tok${id}`, numero_contrato: null, created_at: "2026-11-01", ...extra,
});
const ev = (id: number) => ({ id, cotizacion_id: 1, nombre_original: `comprobante-${id}.png`, mime: "image/png", size_bytes: 2048, subido_en: "2026-11-20T15:00:00Z" });
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
const CAPTURA_OK = { ok: true } as const;
/** Preparación con captura de pasajeros disponible (carrito / tarifario sin pasajeros previos), salvo que el caso diga otra cosa. */
const prep = (o: Record<string, unknown> = {}) => ({ evidencias: [], pasajeros: [], captura: CAPTURA_OK, ...o });
async function render(filas: unknown[], preparaciones: Record<number, unknown> = { 1: prep() }) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(h(TablaCotizaciones as never, { filas, hoy: HOY, vacio: "vacío", preparaciones } as never)));
}
const paneles = () => [...container.querySelectorAll<HTMLElement>('[data-testid="preparacion-contrato"]')];
const texto = () => container.textContent ?? "";
const porTestId = (id: string) => container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
const escribir = async (el: HTMLInputElement | HTMLSelectElement, valor: string) => {
  const proto = el instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor); el.dispatchEvent(new dom.window.Event(el instanceof dom.window.HTMLSelectElement ? "change" : "input", { bubbles: true })); });
};
const campoDe = (fs: Element, etiqueta: string) => [...fs.querySelectorAll("label")].find((l) => l.textContent === etiqueta)!.parentElement!.querySelector("input,select") as HTMLInputElement;

beforeEach(() => { llamadas.length = 0; respAdjuntar = { ok: true }; respGuardar = { ok: true, guardados: 1 }; });
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = undefined; });
after(() => dom.window.close());

test("solo las cotizaciones VIGENTES tienen el panel: convertida, vencida y salida pasada no", async () => {
  await render([fila(1), fila(2, { estado: "convertida", numero_contrato: "00-0451" }), fila(3, { vigencia_hasta: "2026-11-01" }), fila(4, { fecha_salida: "2026-11-01" })], { 1: prep() });
  assert.equal(paneles().length, 1);
});

test("estado inicial: nada inventado, aclara que un comprobante NO es un pago y que es opcional", async () => {
  await render([fila(1)]);
  assert.match(texto(), /Preparar la solicitud \(opcional\)/);
  assert.match(texto(), /0 comprobante\(s\) · 0 pasajero\(s\) adicional/);
  assert.match(texto(), /Adjuntar un comprobante no registra ni aprueba ningún pago/);
  assert.equal(container.querySelectorAll('[data-testid="pasajero-aliado"]').length, 0, "no hay filas de pasajeros hasta que ella agregue una");
  assert.equal(llamadas.length, 0, "abrir/ver el panel no llama a ninguna acción");
});

test("un solo viajero: no hay captura de pasajeros adicionales", async () => {
  await render([fila(1, { pax: 1 })]);
  assert.match(texto(), /un solo viajero/);
  assert.equal(container.querySelector('[data-testid="agregar-pasajero"]'), null);
});

const guardado = (n: string, extra: Record<string, string> = {}) => ({ nombres: n, apellidos: "Vega", tipoDoc: "CE", numeroDoc: "7654321", fechaNacimiento: "1987-02-02", nacionalidad: "", ...extra });
const resumenes = () => [...container.querySelectorAll('[data-testid="pasajero-aliado-resumen"]')];
const abiertas = () => [...container.querySelectorAll('[data-testid="pasajero-aliado"]')];

test("3.1/3.2 universo exacto: «Agregar pasajero» desaparece al representar a todos los viajeros y vuelve al quitar una fila", async () => {
  await render([fila(1, { pax: 2 })]);
  assert.ok(container.querySelector('[data-testid="agregar-pasajero"]'), "con 2 viajeros y solo el titular, falta uno: se ofrece");
  await act(async () => porTestId("agregar-pasajero").click());
  assert.equal(abiertas().length, 1);
  assert.equal(container.querySelector('[data-testid="agregar-pasajero"]'), null, "universo completo: el botón NO está (no solo deshabilitado)");
  assert.match(texto(), /Ya están todos los viajeros de la cotización/);
  await act(async () => (abiertas()[0].querySelector("button.text-red-600") as HTMLButtonElement).click());
  assert.equal(abiertas().length, 0);
  assert.ok(container.querySelector('[data-testid="agregar-pasajero"]'), "al liberar un lugar, el control reaparece");
});

test("3.3 carrito con dos unidades independientes: el universo es AMBIGUO, no se oculta por el máximo de los pax; solo la cota de seguridad (suma) frena", async () => {
  // Dos hoteles de 2 pax: el máximo daría 1 adicional; los viajeros pueden ser distintos (hasta 4 en total ⇒ 3 adicionales).
  const universo = { tipo: "ambiguo", minimo: 2, tope: 4, unidades: 2 };
  await render([fila(1, { pax: 2 })], { 1: prep({ universo }) });
  for (let i = 0; i < 3; i++) {
    assert.ok(container.querySelector('[data-testid="agregar-pasajero"]'), `con ${i} adicionales sigue ofrecido`);
    await act(async () => porTestId("agregar-pasajero").click());
  }
  assert.equal(abiertas().length, 3);
  assert.equal(container.querySelector('[data-testid="agregar-pasajero"]'), null, "en la cota (suma de unidades) ya no se ofrece");
  assert.match(texto(), /cota máxima de viajeros/);
});

test("3.3 con una nota visible que explica la ambigüedad mientras se puede agregar", async () => {
  await render([fila(1, { pax: 2 })], { 1: prep({ universo: { tipo: "ambiguo", minimo: 2, tope: 4, unidades: 2 } }) });
  assert.match(container.querySelector('[data-testid="nota-universo"]')!.textContent ?? "", /2 servicios independientes.*el personal al convertir/);
});

test("2.1 pasajeros ya guardados y completos llegan COMPACTOS (resumen legible) y «Editar» los reabre con todo intacto", async () => {
  await render([fila(1, { pax: 3 })], { 1: prep({ pasajeros: [guardado("Marco")] }) });
  assert.equal(abiertas().length, 0);
  assert.equal(resumenes().length, 1);
  const r = resumenes()[0].textContent ?? "";
  assert.match(r, /Pasajero 2/); assert.match(r, /Marco Vega/); assert.match(r, /CE 7654321/); assert.match(r, /nac\. 1987-02-02/);
  assert.equal(resumenes()[0].querySelector('[data-testid="pasajero-faltan"]'), null, "completo: sin marca de faltantes");
  await act(async () => porTestId("editar-pasajero").click());
  const fs = abiertas()[0];
  assert.equal(campoDe(fs, "Nombres").value, "Marco"); assert.equal(campoDe(fs, "N° doc").value, "7654321"); assert.equal(campoDe(fs, "Tipo doc").value, "CE");
});

test("2.3 un pasajero guardado a medias (sin documento ni nacimiento) se ve compacto pero con «Faltan: …» explícito", async () => {
  await render([fila(1, { pax: 3 })], { 1: prep({ pasajeros: [{ ...guardado("Luz"), tipoDoc: "", numeroDoc: "", fechaNacimiento: "" }] }) });
  assert.match(resumenes()[0].querySelector('[data-testid="pasajero-faltan"]')!.textContent ?? "", /Faltan: documento, nacimiento/);
});

test("2.4 los cambios sin guardar se conservan al compactar/reabrir y al quitar OTRA fila; la fila inválida se reabre sola al guardar", async () => {
  await render([fila(1, { pax: 4 })], { 1: prep({ pasajeros: [guardado("Ana"), guardado("Beto")] }) });
  await act(async () => (container.querySelectorAll('[data-testid="editar-pasajero"]')[1] as HTMLButtonElement).click());
  const fs = abiertas()[0];
  await escribir(campoDe(fs, "N° doc"), "12AB"); // inválido para CE (letras)
  await escribir(campoDe(fs, "Nombres"), "Beto Editado");
  // quitar la OTRA fila (la primera, compacta) no pierde lo escrito en la abierta
  await act(async () => (container.querySelector('[aria-label="Quitar pasajero 2"]') as HTMLButtonElement).click());
  assert.equal(campoDe(abiertas()[0], "Nombres").value, "Beto Editado");
  assert.equal(campoDe(abiertas()[0], "N° doc").value, "12AB");
  // «Listo» no está disponible mientras la fila es inválida
  assert.equal(container.querySelector('[data-testid="compactar-pasajero"]'), null);
  await act(async () => porTestId("guardar-pasajeros").click());
  assert.match(texto(), /el documento debe ser solo números/);
  assert.equal(llamadas.length, 0, "no se llama al servidor con una fila inválida");
  assert.equal(abiertas().length, 1, "la fila con error sigue abierta y visible");
  await escribir(campoDe(abiertas()[0], "N° doc"), "123456");
  await act(async () => porTestId("compactar-pasajero").click());
  assert.equal(abiertas().length, 0); assert.equal(resumenes().length, 1);
  assert.match(resumenes()[0].textContent ?? "", /Beto Editado/);
  assert.match(resumenes()[0].textContent ?? "", /CE 123456/);
});

test("2.2 muchos pasajeros: 9 adicionales completos son 9 líneas de resumen, ningún formulario expandido", async () => {
  const nueve = Array.from({ length: 9 }, (_, i) => guardado(`P${i}`));
  await render([fila(1, { pax: 10 })], { 1: prep({ pasajeros: nueve }) });
  assert.equal(resumenes().length, 9); assert.equal(abiertas().length, 0);
  assert.equal(container.querySelector('[data-testid="agregar-pasajero"]'), null, "10 viajeros representados (titular + 9): el control no se ofrece");
});

test("guardar con éxito vuelve a compactar las filas guardadas", async () => {
  await render([fila(1, { pax: 3 })]);
  await act(async () => porTestId("agregar-pasajero").click());
  const fs = abiertas()[0];
  await escribir(campoDe(fs, "Nombres"), "Marco"); await escribir(campoDe(fs, "Apellidos"), "Vega");
  await act(async () => porTestId("guardar-pasajeros").click());
  assert.equal(abiertas().length, 0); assert.equal(resumenes().length, 1);
  assert.match(resumenes()[0].textContent ?? "", /Marco Vega/);
  assert.match(resumenes()[0].textContent ?? "", /Faltan: documento, nacimiento/);
});

test("pasajeros ya guardados llegan precargados, tal como se escribieron (al reabrirlos)", async () => {
  await render([fila(1, { pax: 3 })], { 1: prep({ pasajeros: [guardado("Marco")] }) });
  await act(async () => porTestId("editar-pasajero").click());
  const fs = abiertas()[0];
  assert.equal(campoDe(fs, "Nombres").value, "Marco");
  assert.equal(campoDe(fs, "N° doc").value, "7654321");
  assert.equal(campoDe(fs, "Tipo doc").value, "CE");
});

test("guardar con letras bajo CE se rechaza en pantalla y NO llama al servidor (misma regla que la conversión)", async () => {
  await render([fila(1)]);
  await act(async () => porTestId("agregar-pasajero").click());
  const fs = container.querySelector('[data-testid="pasajero-aliado"]')!;
  await escribir(campoDe(fs, "Nombres"), "Marco"); await escribir(campoDe(fs, "Apellidos"), "Vega");
  await escribir(campoDe(fs, "Tipo doc") as unknown as HTMLSelectElement, "CE"); await escribir(campoDe(fs, "N° doc"), "E7654321");
  await act(async () => porTestId("guardar-pasajeros").click());
  assert.match(texto(), /Pasajero 2: el documento debe ser solo números/);
  assert.equal(llamadas.length, 0);
});

test("guardar válido llama UNA vez con el id de esa cotización y solo lo escrito (filas vacías descartadas)", async () => {
  await render([fila(1, { pax: 3 })]);
  await act(async () => porTestId("agregar-pasajero").click());
  await act(async () => porTestId("agregar-pasajero").click()); // segunda fila: se deja vacía
  const [f1] = [...container.querySelectorAll('[data-testid="pasajero-aliado"]')];
  await escribir(campoDe(f1, "Nombres"), "Marco"); await escribir(campoDe(f1, "Apellidos"), "Vega");
  await act(async () => porTestId("guardar-pasajeros").click());
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].fn, "guardar");
  assert.equal(llamadas[0].args[0], 1);
  assert.deepEqual(llamadas[0].args[1], [{ nombres: "Marco", apellidos: "Vega", tipoDoc: "", numeroDoc: "", fechaNacimiento: "", nacionalidad: "" }]);
  assert.match(texto(), /Guardamos 1 pasajero/);
});

test("un fallo del servidor al guardar se muestra y no se presenta como guardado", async () => {
  respGuardar = { ok: false, error: "No encontramos esa cotización entre las tuyas." };
  await render([fila(1)]);
  await act(async () => porTestId("agregar-pasajero").click());
  const fs = container.querySelector('[data-testid="pasajero-aliado"]')!;
  await escribir(campoDe(fs, "Nombres"), "A"); await escribir(campoDe(fs, "Apellidos"), "B");
  await act(async () => porTestId("guardar-pasajeros").click());
  assert.match(texto(), /No encontramos esa cotización entre las tuyas/);
  assert.doesNotMatch(texto(), /Guardamos/);
});

test("comprobantes: se listan, adjuntar envía el archivo elegido con el id de esa cotización, retirar llama con el id del comprobante", async () => {
  await render([fila(1)], { 1: prep({ evidencias: [ev(7)] }) });
  assert.match(texto(), /comprobante-7\.png/);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const archivo = new dom.window.File(["x"], "pago.png", { type: "image/png" });
  Object.defineProperty(input, "files", { value: [archivo], configurable: true });
  await act(async () => porTestId("adjuntar-evidencia").click());
  assert.deepEqual(llamadas.map((l) => l.fn), ["adjuntar"]);
  assert.deepEqual(llamadas[0].args, ["1", "pago.png"]);
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Retirar comprobante-7.png"]')!.click());
  assert.deepEqual(llamadas[1], { fn: "retirar", args: [7] });
});

test("adjuntar sin elegir archivo no llama al servidor; un rechazo del servidor se muestra tal cual", async () => {
  respAdjuntar = { ok: false, error: "Solo se admiten archivos PDF, JPG o PNG." };
  await render([fila(1)]);
  await act(async () => porTestId("adjuntar-evidencia").click());
  assert.match(texto(), /Elige un archivo/);
  assert.equal(llamadas.length, 0);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new dom.window.File(["x"], "a.txt", { type: "text/plain" })], configurable: true });
  await act(async () => porTestId("adjuntar-evidencia").click());
  assert.match(texto(), /Solo se admiten archivos PDF, JPG o PNG/);
});

test("con 5 comprobantes vigentes no se puede adjuntar otro", async () => {
  await render([fila(1)], { 1: prep({ evidencias: [ev(1), ev(2), ev(3), ev(4), ev(5)] }) });
  assert.equal(porTestId("adjuntar-evidencia").disabled, true);
  assert.match(texto(), /máximo de 5 comprobantes/);
});

test("vía de conversión sin captura (p. ej. cotización dinámica): se dice ANTES de guardar y no se ofrece escribir pasajeros", async () => {
  await render([fila(1, { pax: 3 })], { 1: prep({ captura: { ok: false, motivo: "Esta cotización se convierte con el titular que ya registraste; no admite pasajeros adicionales escritos aquí." } }) });
  assert.match(container.querySelector('[data-testid="sin-captura-pasajeros"]')!.textContent ?? "", /se convierte con el titular/);
  assert.equal(container.querySelector('[data-testid="agregar-pasajero"]'), null);
  assert.equal(container.querySelector('[data-testid="guardar-pasajeros"]'), null);
  assert.match(texto(), /Comprobantes de pago/, "los comprobantes siguen disponibles");
});

test("si la información de captura no llegó (falla de lectura), no se promete nada y se explica", async () => {
  await render([fila(1, { pax: 3 })], {});
  assert.match(texto(), /No pudimos comprobar si esta cotización admite pasajeros adicionales/);
  assert.equal(container.querySelector('[data-testid="agregar-pasajero"]'), null);
});

// ── R326-1: capacidad ofrecida = capacidad que se puede guardar (límite técnico de 30), distinta del universo ─────────────────────────────────────────────────────────
test("R326-1 dos servicios de 16 (universo hasta 32): el panel lo dice ANTES de escribir, ofrece exactamente 30, y en el límite NO afirma que estén todos", async () => {
  const universo = { tipo: "ambiguo", minimo: 16, tope: 32, unidades: 2 };
  await render([fila(1, { pax: 16 })], { 1: prep({ universo }) });
  assert.match(texto(), /Hasta 30 además del titular/, "el encabezado ofrece 30, no 31");
  const nota0 = container.querySelector('[data-testid="nota-universo"]')!.textContent ?? "";
  assert.match(nota0, /2 servicios independientes/); assert.match(nota0, /hasta 30 pasajeros adicionales/); assert.match(nota0, /completa el resto al convertir/);
  for (let i = 0; i < 29; i++) await act(async () => porTestId("agregar-pasajero").click());
  assert.equal(abiertas().length, 29);
  assert.ok(container.querySelector('[data-testid="agregar-pasajero"]'), "con 29 adicionales todavía cabe uno");
  await act(async () => porTestId("agregar-pasajero").click());
  assert.equal(abiertas().length, 30, "frontera: 30 filas");
  assert.equal(container.querySelector('[data-testid="agregar-pasajero"]'), null, "la fila 31 NO se ofrece (antes de la corrección el panel la ofrecía y el guardado la rechazaba)");
  const notaLimite = container.querySelector('[data-testid="nota-universo"]')!.textContent ?? "";
  assert.match(notaLimite, /Llegaste al máximo de 30 pasajeros adicionales/); assert.match(notaLimite, /NO significa que ya estén todos los viajeros/);
  assert.doesNotMatch(notaLimite, /Ya están todos/);
  // quitar una fila libera un lugar dentro del límite
  await act(async () => (abiertas()[29].querySelector("button.text-red-600") as HTMLButtonElement).click());
  assert.ok(container.querySelector('[data-testid="agregar-pasajero"]'), "al quitar una fila vuelve a ofrecerse (29 → 30)");
});

test("R326-1 con 30 filas con nombre, guardar envía las 30 completas (sin truncar) a la acción", async () => {
  respGuardar = { ok: true, guardados: 30 };
  await render([fila(1, { pax: 40 })], { 1: prep({ universo: { tipo: "exacto", n: 40 } }) });
  assert.match(container.querySelector('[data-testid="nota-universo"]')!.textContent ?? "", /es para 40 viajeros/);
  for (let i = 0; i < 30; i++) await act(async () => porTestId("agregar-pasajero").click());
  assert.equal(container.querySelector('[data-testid="agregar-pasajero"]'), null);
  for (const [i, fs] of abiertas().entries()) { await escribir(campoDe(fs, "Nombres"), `N${i}`); await escribir(campoDe(fs, "Apellidos"), "Z"); }
  await act(async () => porTestId("guardar-pasajeros").click());
  assert.equal(llamadas.length, 1);
  assert.equal((llamadas[0].args[1] as unknown[]).length, 30, "las 30 viajan completas; nada se descarta en silencio");
  assert.equal((llamadas[0].args[1] as { nombres: string }[])[29].nombres, "N29");
  assert.match(texto(), /Guardamos 30 pasajero/);
  assert.match(container.querySelector('[data-testid="nota-universo"]')!.textContent ?? "", /NO significa que ya estén todos/, "tras guardar, en el límite, sigue sin afirmarse que estén todos");
});

test("R326-1 justo debajo del límite técnico (universo exacto de 31 = 30 adicionales) no hay límite técnico: llegar al final SÍ completa el universo", async () => {
  await render([fila(1, { pax: 31 })], { 1: prep({ universo: { tipo: "exacto", n: 31 } }) });
  for (let i = 0; i < 30; i++) await act(async () => porTestId("agregar-pasajero").click());
  assert.equal(container.querySelector('[data-testid="agregar-pasajero"]'), null);
  assert.match(container.querySelector('[data-testid="nota-universo"]')!.textContent ?? "", /Ya están todos los viajeros/);
});
