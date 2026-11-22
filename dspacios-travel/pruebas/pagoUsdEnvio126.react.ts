// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
// F1 de Codex (ronda 1, #126-A) — lo que el formulario ENVÍA al servidor es lo mismo que la vista previa muestra. Con la entrada «4.100» (formato colombiano de 4100) la vista previa
// decía USD 300 pero el envío llevaba TRM 4,1 (Number("4.100")). Aquí se montan los formularios REALES, se escribe «4.100» y se captura la LLAMADA a la acción:
// registro nuevo en pesos y en dólares nativos, confirmación de pago adicional, reintento de confirmación, comparación de «¿cambió el formulario?» para limpiarlo y los formularios de edición.
import { test, mock, afterEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData,
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
type Fn = (...a: never[]) => unknown;
let impls: Record<string, Fn> = {};
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

// ── «servidor» simulado: captura TODOS los argumentos de cada llamada ──────────────────────────
type Reg = { numero: string; valor: number; forma: string; ref: string; trm: number | undefined; fecha: string | undefined; confirmar: boolean | undefined; operacion: string | undefined; monedaPago: string | undefined };
type Edit = { id: number; numero: string; input: { valor: number; fecha: string; formaPago: string; referencia: string; trmInput?: number } };
const registros: Reg[] = [];
const ediciones: Edit[] = [];
let modo: "ok" | "excedente" | "pendiente" | "lento" = "ok";
let liberar: (() => void) | null = null;
const EXCEDENTE = { contrato: "DTM-0001", total: 1000, pagado: 1000, nuevo: 300, moneda: "USD" as const };
function registrador() {
  return async (numero: string, valor: number, forma: string, ref: string, trm?: number, fecha?: string, confirmar?: boolean, operacion?: string, _identidad?: unknown, monedaPago?: string) => {
    registros.push({ numero, valor, forma, ref, trm, fecha, confirmar, operacion, monedaPago });
    if (modo === "lento") await new Promise<void>((r) => { liberar = r; });
    if (modo === "excedente" && !confirmar) return { ok: false, error: "Este contrato ya está pagado.", confirmacion: EXCEDENTE };
    if (modo === "pendiente") return { ok: false, confirmacionPendiente: true, error: "Abono registrado; confirmación pendiente: x" };
    return { ok: true };
  };
}
impls = {
  registrarAbono: registrador() as Fn, registrarAbonoCartera: registrador() as Fn,
  actualizarAbono: (async (id: number, numero: string, input: Edit["input"]) => { ediciones.push({ id, numero, input }); return { ok: true }; }) as Fn,
  actualizarAbonoCartera: (async (id: number, numero: string, input: Edit["input"]) => { ediciones.push({ id, numero, input }); return { ok: true }; }) as Fn,
  anularAbono: (async () => ({ ok: true })) as Fn, anularAbonoCartera: (async () => ({ ok: true })) as Fn,
};

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
async function montar(el: React.ReactElement) {
  registros.length = 0; ediciones.length = 0; modo = "ok"; liberar = null;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(el));
}
async function escribir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
const campoValor = () => container.querySelector<HTMLInputElement>('input[type="number"]')!;
const campoTrm = () => container.querySelector<HTMLInputElement>('input[placeholder="COP por 1 USD"]')!;
const boton = (t: string) => [...document.querySelectorAll("button")].find((b) => norm(b.textContent).startsWith(t)) as HTMLButtonElement | undefined;
async function clic(btn: HTMLElement | undefined) { assert.ok(btn, "el botón existe"); await act(async () => btn!.click()); await act(async () => { await Promise.resolve(); }); }
async function enviarFormulario() {
  const form = container.querySelector("form")!;
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
}
const previa = () => norm(container.querySelector('[data-testid="vista-previa-pago-usd"]')?.textContent);
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; container?.remove(); document.body.innerHTML = ""; });
after(() => dom.window.close());

const abonoForm = () => h(AbonoForm, { identidad: {}, numeroContrato: "DTM-0001", formasPago: ["Transferencia"], moneda: "USD", saldo: 1000 });

describe("F1 — «4.100» se previsualiza y se ENVÍA como 4100 (registro nuevo)", () => {
  test("pesos: COP 1.230.000 con «4.100» → vista previa USD 300 / saldo USD 700 y la llamada lleva valor 1230000 y TRM 4100 (nunca 4,1)", async () => {
    await montar(abonoForm());
    await escribir(campoValor(), "1230000"); await escribir(campoTrm(), "4.100");
    assert.match(previa(), /Acredita USD\s?\$?300/); assert.match(previa(), /saldo después del pago: USD\s?\$?700/);
    await enviarFormulario();
    assert.equal(registros.length, 1);
    assert.deepEqual({ valor: registros[0].valor, trm: registros[0].trm, confirmar: registros[0].confirmar, monedaPago: registros[0].monedaPago }, { valor: 1_230_000, trm: 4100, confirmar: false, monedaPago: "COP" });
    assert.equal(registros[0].valor / registros[0].trm!, 300, "lo que el servidor acreditará coincide con la vista previa");
    assert.equal(campoValor().value, ""); assert.equal(campoTrm().value, "", "tras registrar sin cambios el formulario se limpia");
  });

  test("dólares nativos: USD 300 con «4.100» → vista previa equivale a $1.230.000 y la llamada lleva COP 1230000 con TRM 4100 (acredita exactamente USD 300)", async () => {
    await montar(abonoForm());
    await clic(boton("Dólares (USD)"));
    await escribir(campoValor(), "300"); await escribir(campoTrm(), "4.100");
    assert.match(previa(), /Acredita USD\s?\$?300/); assert.match(previa(), /equivale a \$\s?1\.230\.000/);
    await enviarFormulario();
    assert.equal(registros.length, 1);
    assert.deepEqual({ valor: registros[0].valor, trm: registros[0].trm, monedaPago: registros[0].monedaPago }, { valor: 1_230_000, trm: 4100, monedaPago: "USD" }, "el servidor sabe que llegaron DÓLARES y que los pesos son solo el equivalente contable");
    assert.equal(registros[0].valor / registros[0].trm!, 300);
    assert.equal(campoTrm().value, "", "se limpia");
  });

  test("cualquier forma equivalente de escribir la TRM envía lo mismo: «4.100», «4100» y «4100.00» → 4100; «4.1» y «99» se rechazan sin llamar al servidor", async () => {
    for (const t of ["4.100", "4100", "4100.00"]) {
      await montar(abonoForm());
      await escribir(campoValor(), "1230000"); await escribir(campoTrm(), t);
      await enviarFormulario();
      assert.equal(registros[0]?.trm, 4100, `«${t}»`);
      await act(async () => root?.unmount()); container.remove();
    }
    for (const t of ["4.1", "99"]) {
      await montar(abonoForm());
      await escribir(campoValor(), "1230000"); await escribir(campoTrm(), t);
      await enviarFormulario();
      assert.equal(registros.length, 0, `«${t}» no llega al servidor`);
      assert.match(norm(container.textContent), /TRM del pago debe ser/);
      await act(async () => root?.unmount()); container.remove();
    }
  });
});

describe("F1 — confirmación de pago adicional, reintento y reinicio usan la TRM normalizada del envío congelado", () => {
  test("pago adicional en pesos: el diálogo confirma EL MISMO envío (TRM 4100, misma operación) aunque el formulario cambie detrás; como cambió, no se limpia", async () => {
    await montar(abonoForm()); modo = "excedente";
    await escribir(campoValor(), "1230000"); await escribir(campoTrm(), "4.100");
    await enviarFormulario();
    assert.equal(registros.length, 1);
    assert.equal(registros[0].trm, 4100); assert.equal(registros[0].confirmar, false);
    assert.match(norm(document.body.textContent), /Este contrato ya está pagado/);
    await escribir(campoTrm(), "4.200");                       // el formulario cambia mientras el diálogo está abierto
    await clic(boton("Registrar pago adicional"));
    assert.equal(registros.length, 2);
    assert.deepEqual({ valor: registros[1].valor, trm: registros[1].trm, confirmar: registros[1].confirmar }, { valor: 1_230_000, trm: 4100, confirmar: true }, "se confirma lo que se mostró, no lo que haya ahora");
    assert.equal(registros[1].operacion, registros[0].operacion);
    assert.equal(campoTrm().value, "4.200", "el formulario había cambiado (otra TRM): no se limpia");
  });

  test("pago adicional en dólares nativos: la confirmación reenvía COP 1230000 / TRM 4100 y, sin cambios, limpia el formulario", async () => {
    await montar(abonoForm()); modo = "excedente";
    await clic(boton("Dólares (USD)"));
    await escribir(campoValor(), "300"); await escribir(campoTrm(), "4.100");
    await enviarFormulario();
    assert.deepEqual({ valor: registros[0].valor, trm: registros[0].trm }, { valor: 1_230_000, trm: 4100 });
    await clic(boton("Registrar pago adicional"));
    assert.deepEqual({ valor: registros[1].valor, trm: registros[1].trm, confirmar: registros[1].confirmar, monedaPago: registros[1].monedaPago }, { valor: 1_230_000, trm: 4100, confirmar: true, monedaPago: "USD" });
    assert.equal(campoValor().value, "", "mismos valores normalizados: se limpia");
  });

  test("reintento de confirmación pendiente: la MISMA operación con valor 1230000 y TRM 4100", async () => {
    await montar(abonoForm()); modo = "pendiente";
    await escribir(campoValor(), "1230000"); await escribir(campoTrm(), "4.100");
    await enviarFormulario();
    assert.match(norm(container.textContent), /Abono registrado; confirmación pendiente/);
    modo = "ok";
    await clic(boton("Reintentar confirmación"));
    assert.equal(registros.length, 2);
    assert.deepEqual({ valor: registros[1].valor, trm: registros[1].trm, operacion: registros[1].operacion, monedaPago: registros[1].monedaPago }, { valor: 1_230_000, trm: 4100, operacion: registros[0].operacion, monedaPago: "COP" });
  });

  test("reinicio: reescribir la TRM de otra forma pero IGUAL («4.100» → «4100») mientras el envío está en curso sí limpia; cambiarla de verdad («4.200») no", async () => {
    for (const [cambio, limpia] of [["4100", true], ["4.200", false]] as const) {
      await montar(abonoForm()); modo = "lento";
      await escribir(campoValor(), "1230000"); await escribir(campoTrm(), "4.100");
      await enviarFormulario();
      await escribir(campoTrm(), cambio);                      // cambia mientras el servidor aún no responde
      await act(async () => { liberar?.(); await Promise.resolve(); await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });
      assert.equal(registros[0].trm, 4100);
      assert.equal(campoValor().value === "", limpia, `«${cambio}» → ${limpia ? "se limpia (mismo valor)" : "se conserva (otro valor)"}`);
      await act(async () => root?.unmount()); container.remove();
    }
  });
});

describe("la moneda del pago entra en la comparación de «¿cambió el formulario?»", () => {
  test("mismo número y misma TRM pero cambiando de pesos a dólares con el envío en curso: NO se limpia (sería otro pago)", async () => {
    await montar(abonoForm()); modo = "lento";
    await escribir(campoValor(), "1230000"); await escribir(campoTrm(), "4.100");
    await enviarFormulario();
    await clic(boton("Dólares (USD)"));
    await act(async () => { liberar?.(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    assert.equal(registros[0].monedaPago, "COP");
    assert.equal(campoValor().value, "1230000", "el formulario cambió de moneda: no se limpia");
  });
});

describe("F1 — Cartera (registro) y formularios de EDICIÓN envían la TRM normalizada", () => {
  const fila = (o: Record<string, unknown> = {}) => ({
    numero_contrato: "DTM-0001", identidad: {}, cliente: "Cliente", destino: "CTG", precio_venta: 1000, estado: "confirmado", fecha_salida: "2030-03-01", moneda: "USD", pagado: 300, saldo: 700,
    abonos: [{ id: 7, fecha_abono: "2026-11-18", valor_abono: 300, forma_pago: "Transferencia", referencia: null, trm: 4100, monto_cop: 1_230_000 }], ...o,
  });
  async function abrirFila() {
    await montar(h(CarteraList, { rows: [fila()] as never, formasPago: ["Transferencia"] }));
    await clic([...container.querySelectorAll("tr")].find((t) => /DTM-0001/.test(t.textContent ?? "")) as HTMLElement);
  }

  test("Cartera, registro nuevo en pesos y en dólares: «4.100» → TRM 4100 y valor 1230000", async () => {
    await abrirFila();
    await escribir(campoValor() && container.querySelector<HTMLInputElement>('form input[type="number"]')!, "1230000");
    await escribir(container.querySelector<HTMLInputElement>('input[placeholder="COP por 1 USD"]')!, "4.100");
    await enviarFormularioCartera();
    assert.deepEqual({ valor: registros[0].valor, trm: registros[0].trm }, { valor: 1_230_000, trm: 4100 });
    await act(async () => root?.unmount()); container.remove();
    await abrirFila();
    await clic(boton("Dólares (USD)"));
    await escribir(container.querySelector<HTMLInputElement>('form input[type="number"]')!, "300");
    await escribir(container.querySelector<HTMLInputElement>('input[placeholder="COP por 1 USD"]')!, "4.100");
    await enviarFormularioCartera();
    assert.deepEqual({ valor: registros[0].valor, trm: registros[0].trm }, { valor: 1_230_000, trm: 4100 });   // montar() reinicia el registro de llamadas
  });
  async function enviarFormularioCartera() {
    const form = container.querySelector('input[placeholder="COP por 1 USD"]')!.closest("form")!;
    await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
    await act(async () => { await Promise.resolve(); });
  }

  test("edición de un pago (Cartera): escribir «4.200» o «4.100» envía trmInput 4200 / 4100; una TRM inválida («4.1») envía 0 y el servidor la rechaza (nunca 4,1 aceptado)", async () => {
    for (const [escrito, esperado] of [["4.200", 4200], ["4.100", 4100], ["4.1", 0]] as const) {
      await abrirFila();
      await clic([...container.querySelectorAll("button")].find((b) => norm(b.textContent) === "Editar") as HTMLElement);
      const trm = [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')].find((i) => i.value === "4100")!;
      await escribir(trm, escrito);
      await clic(boton("Guardar"));
      assert.equal(ediciones.at(-1)?.input.trmInput, esperado, `«${escrito}»`);
      assert.equal(ediciones.at(-1)?.input.valor, 1_230_000);
      await act(async () => root?.unmount()); container.remove();
    }
  });
});
