// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// #126-A — campos del pago de un contrato en USD: cada pago pide SU TRM (sin valor por defecto), muestra cuántos USD acredita y el saldo que queda;
// el pago nativo en USD acredita lo digitado. Componente REAL en jsdom; los importes esperados están hechos a mano (ejemplo del dueño).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- asignación deliberada de globals de jsdom.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle;
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
after(() => dom.window.close());

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = React;
const { CamposPagoUsd, valorCopDelPago } = await import("../components/contrato/PagoUsdCampos.tsx");

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
type Modo = "cop" | "usd";
async function montar(p: { modo: Modo; valor: string; trm: string; saldo?: number }) {
  const cont = document.createElement("div"); document.body.appendChild(cont);
  const root = createRoot(cont);
  await act(async () => { root.render(h(CamposPagoUsd, { modo: p.modo, onModo: () => {}, valor: p.valor, onValor: () => {}, trm: p.trm, onTrm: () => {}, saldo: p.saldo }) as never); });
  return { cont, cerrar: async () => { await act(async () => root.unmount()); cont.remove(); } };
}
const previa = (c: HTMLElement) => norm(c.querySelector('[data-testid="vista-previa-pago-usd"]')?.textContent);

describe("#126-A — campos del pago en USD", () => {
  test("pide la TRM de ESTE pago (sin valor por defecto) y ofrece pesos o dólares", async () => {
    const m = await montar({ modo: "cop", valor: "", trm: "", saldo: 1000 });
    assert.match(norm(m.cont.textContent), /TRM de este pago/);
    assert.match(norm(m.cont.textContent), /Cada pago usa su propia TRM/);
    assert.equal((m.cont.querySelector('input[placeholder="COP por 1 USD"]') as HTMLInputElement).value, "", "la TRM no viene prellenada");
    assert.deepEqual([...m.cont.querySelectorAll('[role="group"] button')].map((b) => norm(b.textContent)), ["Pesos (COP)", "Dólares (USD)"]);
    assert.equal(m.cont.querySelector('[data-testid="vista-previa-pago-usd"]'), null, "sin valor no hay vista previa");
    await m.cerrar();
  });

  test("ejemplo del dueño, primer pago: COP 1.230.000 a TRM 4.100 acredita USD 300 y deja saldo USD 700", async () => {
    const m = await montar({ modo: "cop", valor: "1230000", trm: "4100", saldo: 1000 });
    const t = previa(m.cont);
    assert.match(t, /Acredita USD\s?\$?300/);
    assert.match(t, /saldo después del pago: USD\s?\$?700/);
    await m.cerrar();
  });

  test("segundo pago con OTRA TRM: COP 2.940.000 a 4.200 acredita USD 700 y el saldo queda en 0", async () => {
    const m = await montar({ modo: "cop", valor: "2940000", trm: "4200", saldo: 700 });
    const t = previa(m.cont);
    assert.match(t, /Acredita USD\s?\$?700/);
    assert.match(t, /saldo después del pago: USD\s?\$?0/);
    assert.doesNotMatch(t, /supera el saldo/);
    await m.cerrar();
  });

  test("TRM ausente o inválida: avisa en vez de calcular con una tasa inventada", async () => {
    for (const trm of ["", "0", "-4100", "1", "4.1"]) {
      const m = await montar({ modo: "cop", valor: "1230000", trm, saldo: 1000 });
      assert.match(previa(m.cont), /TRM/, `TRM «${trm}» debe avisar`);
      assert.doesNotMatch(previa(m.cont), /Acredita/);
      await m.cerrar();
    }
  });

  test("pago en dólares: acredita exactamente lo digitado y muestra el equivalente en pesos a esa TRM; el exceso se avisa", async () => {
    const m = await montar({ modo: "usd", valor: "300", trm: "4100", saldo: 1000 });
    const t = previa(m.cont);
    assert.match(t, /Acredita USD\s?\$?300/);
    assert.match(t, /equivale a \$\s?1\.230\.000 a esa TRM/);
    assert.match(norm(m.cont.textContent), /no cambia los USD acreditados/);
    await m.cerrar();
    const e = await montar({ modo: "usd", valor: "800", trm: "4100", saldo: 700 });
    assert.match(previa(e.cont), /supera el saldo/);
    await e.cerrar();
  });

  test("valor enviado al servidor: COP tal cual; USD nativo = USD × TRM a centavos; sin TRM válida no se envía nada", () => {
    assert.equal(valorCopDelPago("cop", "1230000", "4100"), "1230000");
    assert.equal(valorCopDelPago("usd", "300", "4100"), "1230000");
    assert.equal(valorCopDelPago("usd", "243.9", "4100"), "999990");   // 243,9 × 4.100 = 999.990
    assert.equal(valorCopDelPago("usd", "300", ""), "");
    assert.equal(valorCopDelPago("usd", "300", "1"), "");
  });
});
