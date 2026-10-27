// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// 248 · Confirmación de pago adicional y anulación de abonos, en la ficha del contrato (AbonoForm) y en Cartera (CarteraList).
// Cancelar no escribe; confirmar reintenta con confirmarExcedente=true; una doble pulsación no duplica el envío; anular exige motivo.
import { test, mock, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData, // React arma FormData al enviar un <form>: debe ser el de jsdom
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON() {} });
Element.prototype.scrollIntoView = () => {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
// Las Server Actions se sustituyen por módulo (mock.module sobre su archivo real) SOLO en esta prueba: el loader de
// test:react es compartido y otras pruebas necesitan las acciones reales.
let impls: Record<string, (...a: never[]) => unknown> = {};
const __setImpls = (next: Record<string, (...a: never[]) => unknown>) => { impls = { ...impls, ...next }; };
const via = (n: string) => async (...a: unknown[]) => (impls[n] as unknown as (...x: unknown[]) => unknown)(...a);
mock.module(new URL("../app/(dashboard)/dashboard/contratos/actions.ts", import.meta.url).href, {
  namedExports: { registrarAbono: via("registrarAbono"), actualizarAbono: via("actualizarAbono"), anularAbono: via("anularAbono") },
});
mock.module(new URL("../app/(dashboard)/dashboard/cartera/actions.ts", import.meta.url).href, {
  namedExports: { registrarAbonoCartera: via("registrarAbonoCartera"), actualizarAbonoCartera: via("actualizarAbonoCartera"), anularAbonoCartera: via("anularAbonoCartera") },
});
const { AbonoForm } = await import("../app/(dashboard)/dashboard/contratos/[numero]/AbonoForm.tsx");
const { CarteraList } = await import("../app/(dashboard)/dashboard/cartera/CarteraList.tsx");
const { act, createElement: h } = React;

const DATOS = { contrato: "00-0451", total: 1_800_000, pagado: 1_800_000, nuevo: 100_000, moneda: "COP" as const };
type Llamada = { numero: string; valor: number; confirmar?: boolean; operacion?: string };
const llamadas: Llamada[] = [];
const anulaciones: Array<[number, string, string]> = [];

// El servidor decide: sin confirmación responde "requiere confirmar" (y no escribe); con confirmación registra.
function servidorExcedente() {
  return async (numero: string, valor: number, _f: string, _r: string, _t?: number, _fecha?: string, confirmar?: boolean, operacion?: string) => {
    llamadas.push({ numero, valor, confirmar, operacion });
    if (!confirmar) return { ok: false, error: "ya pagado", confirmacion: DATOS };
    return { ok: true };
  };
}
__setImpls({
  registrarAbono: servidorExcedente(),
  registrarAbonoCartera: servidorExcedente(),
  anularAbono: async (id: number, numero: string, motivo: string) => { anulaciones.push([id, numero, motivo]); return { ok: true }; },
  anularAbonoCartera: async (id: number, numero: string, motivo: string) => { anulaciones.push([id, numero, motivo]); return { ok: true }; },
});

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
const texto = () => document.body.textContent ?? "";
const boton = (t: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(t)) as HTMLButtonElement | undefined;

async function montar(el: React.ReactElement) {
  llamadas.length = 0;
  anulaciones.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(el));
}
async function escribir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function clic(btn: HTMLElement | undefined, fallo: string) {
  assert.ok(btn, fallo);
  await act(async () => btn!.click());
  await act(async () => { await Promise.resolve(); });
}
const entradaValor = () => container.querySelector<HTMLInputElement>('input[type="number"]')!;
async function enviarFormulario() {
  const form = container.querySelector("form")!;
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  document.body.innerHTML = "";
});
after(() => dom.window.close());

test("ficha: contrato ya pagado → confirmación con contrato, total, pagado y nuevo abono; nada se guarda aún", async () => {
  await montar(h(AbonoForm, { numeroContrato: "00-0451", formasPago: ["Efectivo"], moneda: "COP" }));
  await escribir(entradaValor(), "100000");
  await enviarFormulario();
  const t = texto();
  assert.match(t, /Este contrato ya está pagado/);
  assert.match(t, /00-0451/);
  assert.match(t, /Total a cobrar/);
  assert.match(t, /Pagado/);
  assert.match(t, /Nuevo abono/);
  assert.deepEqual(llamadas.map((l) => l.confirmar), [false], "el primer envío va sin confirmar y el servidor no escribió nada");
});

test("ficha: el diálogo de pago adicional es HTML válido (el <dl> no va dentro del <p> de la descripción)", async () => {
  const errores: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { errores.push(a.map(String).join(" ")); };
  try {
    await montar(h(AbonoForm, { numeroContrato: "00-0451", formasPago: [], moneda: "COP" }));
    await escribir(entradaValor(), "100000");
    await enviarFormulario();
  } finally {
    console.error = original;
  }
  const dl = document.querySelector("dl");
  assert.ok(dl, "el desglose se renderiza");
  assert.equal(dl.closest("p"), null, "ningún <dl> dentro de un <p>");
  const desc = document.querySelector('[data-slot="dialog-description"]');
  assert.equal(desc?.tagName, "P");
  assert.match(desc?.textContent ?? "", /pago adicional intencional/);
  assert.equal(desc?.querySelector("dl"), null);
  assert.deepEqual([...dl.querySelectorAll("dt")].map((x) => x.textContent), ["Contrato", "Total a cobrar", "Pagado", "Nuevo abono"]);
  assert.equal(dl.querySelectorAll("dt").length, dl.querySelectorAll("dd").length);
  assert.deepEqual(errores.filter((e) => /validateDOMNesting|cannot be a descendant|hydration/i.test(e)), [], "React no avisa de anidamiento inválido");
});

test("ficha: el asiento falló → el reintento (misma operación) muestra el error contable y, al recuperarse, éxito sin duplicar", async () => {
  const msg = "El abono quedó registrado, pero su asiento contable no: boom. Vuelve a pulsar Registrar para reintentar el asiento (no duplica el abono).";
  let n = 0;
  __setImpls({ registrarAbono: async (numero: string, valor: number, _f: string, _r: string, _t?: number, _fe?: string, confirmar?: boolean, operacion?: string) => {
    llamadas.push({ numero, valor, confirmar, operacion });
    n += 1;
    return n < 3 ? { ok: false, error: msg } : { ok: true };
  } });
  try {
    await montar(h(AbonoForm, { numeroContrato: "00-0451", formasPago: [], moneda: "COP" }));
    await escribir(entradaValor(), "100000");
    await enviarFormulario();
    assert.match(texto(), /su asiento contable no/, "el primer intento informa el fallo contable");
    assert.equal(entradaValor().value, "100000", "el formulario NO se limpia mientras falte el asiento");
    await enviarFormulario();
    assert.match(texto(), /su asiento contable no/, "el reintento sigue informando el fallo mientras persista");
    await enviarFormulario();
    assert.doesNotMatch(texto(), /su asiento contable no/);
    assert.equal(entradaValor().value, "", "al recuperarse el asiento se limpia");
    assert.equal(new Set(llamadas.map((l) => l.operacion)).size, 1, "los tres intentos son LA MISMA operación (la base no duplica el abono)");
    assert.equal(llamadas.length, 3);
  } finally {
    __setImpls({ registrarAbono: servidorExcedente() });
  }
});

test("ficha: Cancelar no vuelve a llamar al servidor (no escribe) y conserva el formulario", async () => {
  await montar(h(AbonoForm, { numeroContrato: "00-0451", formasPago: [], moneda: "COP" }));
  await escribir(entradaValor(), "100000");
  await enviarFormulario();
  await clic(boton("Cancelar"), "faltó Cancelar");
  assert.equal(llamadas.length, 1, "solo el intento inicial; cancelar no escribe");
  assert.doesNotMatch(texto(), /Este contrato ya está pagado/);
  assert.equal(entradaValor().value, "100000", "el valor digitado se conserva");
});

test("ficha: Confirmar reintenta con confirmarExcedente=true y limpia el formulario", async () => {
  await montar(h(AbonoForm, { numeroContrato: "00-0451", formasPago: [], moneda: "COP" }));
  await escribir(entradaValor(), "100000");
  await enviarFormulario();
  await clic(boton("Registrar pago adicional"), "faltó Registrar pago adicional");
  assert.deepEqual(llamadas.map((l) => l.confirmar), [false, true]);
  assert.ok(llamadas[0].operacion && llamadas[0].operacion === llamadas[1].operacion, "el intento y su confirmación son LA MISMA operación (la base no los duplica)");
  assert.doesNotMatch(texto(), /Este contrato ya está pagado/, "el diálogo se cierra");
  assert.equal(entradaValor().value, "", "el formulario se limpia tras registrar");
  await escribir(entradaValor(), "100000");
  await enviarFormulario();
  await clic(boton("Registrar pago adicional"), "faltó Registrar pago adicional");
  assert.notEqual(llamadas[2].operacion, llamadas[0].operacion, "el siguiente abono es otra operación");
});

test("ficha: doble pulsación (dos envíos seguidos) manda UNA sola solicitud", async () => {
  let liberar!: () => void;
  const pausa = new Promise<void>((r) => { liberar = r; });
  __setImpls({
    registrarAbono: async (numero: string, valor: number, _f: string, _r: string, _t?: number, _fe?: string, confirmar?: boolean, operacion?: string) => {
      llamadas.push({ numero, valor, confirmar, operacion });
      await pausa;
      return { ok: true };
    },
  });
  await montar(h(AbonoForm, { numeroContrato: "00-0451", formasPago: [], moneda: "COP" }));
  await escribir(entradaValor(), "100000");
  const form = container.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
  assert.equal(llamadas.length, 1, "la segunda pulsación no sale mientras la primera está en curso");
  assert.match(llamadas[0].operacion ?? "", /^[0-9a-f-]{36}$/, "el envío lleva su clave de operación (uuid)");
  await act(async () => { liberar(); await pausa; });
  __setImpls({ registrarAbono: servidorExcedente() });
});

const FILA = {
  numero_contrato: "00-0451", cliente: "Ana", destino: "Cartagena", precio_venta: 1_800_000, estado: "activo", fecha_salida: null,
  moneda: "COP", pagado: 1_700_000, saldo: 100_000,
  abonos: [{ id: 41, fecha_abono: "2026-10-12", valor_abono: 500_000, forma_pago: "Transferencia", referencia: "R-1", trm: null, monto_cop: null }],
};
async function abrirFila() {
  await montar(h(CarteraList, { rows: [FILA], formasPago: ["Efectivo"] }));
  const fila = [...container.querySelectorAll("tr")].find((t) => t.textContent?.includes("00-0451"));
  assert.ok(fila, "no se encontró la fila del contrato en Cartera");
  await act(async () => (fila as HTMLElement).click());
}

test("Cartera: pago adicional pide confirmación; cancelar no escribe y confirmar sí", async () => {
  await abrirFila();
  await escribir(container.querySelector<HTMLInputElement>('form input[type="number"]')!, "100000");
  await act(async () => { container.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
  assert.match(texto(), /Este contrato ya está pagado/);
  await clic(boton("Cancelar"), "faltó Cancelar");
  assert.deepEqual(llamadas.map((l) => l.confirmar), [false]);
  await act(async () => { container.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
  await clic(boton("Registrar pago adicional"), "faltó Registrar pago adicional");
  assert.deepEqual(llamadas.map((l) => l.confirmar), [false, false, true]);
});

test("Cartera: Anular exige motivo y solo entonces llama a la acción; no hay botón Eliminar", async () => {
  await abrirFila();
  assert.equal(boton("Eliminar"), undefined, "ya no existe borrar a secas");
  await clic(boton("Anular"), "faltó el botón Anular");
  assert.match(texto(), /¿Anular este abono\?/);
  await clic(boton("Anular abono"), "faltó Anular abono");
  assert.deepEqual(anulaciones, [], "sin motivo no se llama a la acción");
  assert.match(texto(), /Indica el motivo/);
  const motivo = document.querySelector<HTMLInputElement>('[role="dialog"] input, [role="alertdialog"] input')!;
  await escribir(motivo, "Abono duplicado");
  await clic(boton("Anular abono"), "faltó Anular abono");
  assert.deepEqual(anulaciones, [[41, "00-0451", "Abono duplicado"]]);
});

// ── Respuesta demorada: el formulario cambia mientras el servidor decide. Lo confirmado es el abono ORIGINAL ─────────
type Envio = { valor: number; forma: string; ref: string; fecha: string; confirmar?: boolean; operacion?: string };
const envios: Envio[] = [];
async function elegir(select: HTMLSelectElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(select, valor);
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const entradaRef = () => container.querySelector<HTMLInputElement>('input[placeholder="Comprobante / nota"]')!;
const selectForma = () => container.querySelector<HTMLSelectElement>("form select")!;

for (const [nombre, preparar, nombreAccion] of [
  ["ficha", async () => { await montar(h(AbonoForm, { numeroContrato: "00-0451", formasPago: ["Efectivo", "Transferencia"], moneda: "COP" })); }, "registrarAbono"],
  ["Cartera", async () => { await abrirFila(); }, "registrarAbonoCartera"],
] as const) {
  test(`${nombre}: respuesta demorada con el formulario cambiado → diálogo y confirmación usan el abono ORIGINAL`, async () => {
    envios.length = 0;
    let soltar!: (v: unknown) => void;
    const demora = new Promise((r) => { soltar = r; });
    __setImpls({
      [nombreAccion]: async (_n: string, valor: number, forma: string, ref: string, _t?: number, fecha?: string, confirmar?: boolean, operacion?: string) => {
        envios.push({ valor, forma, ref, fecha: fecha ?? "", confirmar, operacion });
        if (confirmar) return { ok: true };
        await demora; // el servidor tarda en decidir
        return { ok: false, error: "ya pagado", confirmacion: { ...DATOS, nuevo: valor } };
      },
    });
    await preparar();
    await escribir(container.querySelector<HTMLInputElement>('form input[type="number"]')!, "100000");
    await elegir(selectForma(), "Efectivo");
    await escribir(entradaRef(), "REF-ORIGINAL");
    await enviarFormulario();
    assert.equal(envios.length, 1);

    // Mientras el servidor decide, quien registra edita el formulario.
    await escribir(container.querySelector<HTMLInputElement>('form input[type="number"]')!, "999");
    await elegir(selectForma(), "Transferencia");
    await escribir(entradaRef(), "REF-OTRO");
    await act(async () => { soltar(null); await demora; });
    await act(async () => { await Promise.resolve(); });

    assert.match(texto(), /Este contrato ya está pagado/, "el diálogo aparece");
    assert.match(texto(), /100\.000|100,000|100000/, "el diálogo muestra el valor del abono ORIGINAL");
    assert.doesNotMatch(texto(), /\b999\b/, "…no el valor que se escribió después");
    await clic(boton("Registrar pago adicional"), "faltó Registrar pago adicional");

    assert.equal(envios.length, 2);
    assert.deepEqual({ ...envios[1], confirmar: undefined }, { ...envios[0], confirmar: undefined }, "el reintento confirmado envía EXACTAMENTE los mismos datos y la misma operación");
    assert.equal(envios[0].valor, 100000);
    assert.equal(envios[0].forma, "Efectivo");
    assert.equal(envios[0].ref, "REF-ORIGINAL");
    assert.equal(envios[1].confirmar, true);
    // El formulario conserva lo que se escribió después (no se pierde) y esa edición es otra operación.
    assert.equal(container.querySelector<HTMLInputElement>('form input[type="number"]')!.value, "999");
    assert.equal(entradaRef().value, "REF-OTRO");
  });

  test(`${nombre}: cancelar el diálogo no escribe y el reintento posterior sigue la clave del formulario actual`, async () => {
    envios.length = 0;
    __setImpls({
      [nombreAccion]: async (_n: string, valor: number, forma: string, ref: string, _t?: number, fecha?: string, confirmar?: boolean, operacion?: string) => {
        envios.push({ valor, forma, ref, fecha: fecha ?? "", confirmar, operacion });
        return confirmar ? { ok: true } : { ok: false, error: "ya pagado", confirmacion: { ...DATOS, nuevo: valor } };
      },
    });
    await preparar();
    await escribir(container.querySelector<HTMLInputElement>('form input[type="number"]')!, "100000");
    await enviarFormulario();
    await clic(boton("Cancelar"), "faltó Cancelar");
    assert.deepEqual(envios.map((e) => e.confirmar), [false], "cancelar no escribe nada");
    await escribir(container.querySelector<HTMLInputElement>('form input[type="number"]')!, "250000");
    await enviarFormulario();
    await clic(boton("Registrar pago adicional"), "faltó Registrar pago adicional");
    assert.deepEqual(envios.map((e) => [e.valor, e.confirmar]), [[100000, false], [250000, false], [250000, true]], "se confirma lo último que el servidor mostró, no el primer intento cancelado");
  });
}
