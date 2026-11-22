// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// #126-A (Codex ronda 2): los reportes no llaman «pesos recibidos» al equivalente CONTABLE de un abono recibido en dólares.
//  · Flujo de caja (componente real): la base «Caja» suma pesos + equivalente, pero lo dice y lo cuantifica; la base «Esperado» no lleva nota.
//  · Conciliaciones (fuente): el abono en dólares se rotula como tal y no como «Abono cartera» de pesos.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const { act } = React;
const { FlujoCajaClient } = await import("../app/(dashboard)/dashboard/flujo-caja/FlujoCajaClient.tsx");

const mes = new Date().toISOString().slice(0, 7);
const contratos = [
  { numero_contrato: "00-9001", fecha_salida: `${mes}-20`, fecha_venta: `${mes}-02`, estado: "confirmado", precio_venta: 4_100_000, costo_total: 0, cobrado: 2_940_000, cobradoDolaresEquivalente: 1_230_000, pagado: 0 },
  { numero_contrato: "00-9002", fecha_salida: `${mes}-21`, fecha_venta: `${mes}-03`, estado: "confirmado", precio_venta: 1_000_000, costo_total: 0, cobrado: 500_000, pagado: 0 },
];
async function montar() {
  const cont = document.createElement("div"); document.body.appendChild(cont);
  const root = createRoot(cont);
  await act(async () => { root.render(React.createElement(FlujoCajaClient, { contratos, fijosDefault: 0, movimientos: [] }) as never); });
  return { cont, cerrar: async () => { await act(async () => root.unmount()); cont.remove(); } };
}
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const cambiarBase = async (cont: HTMLElement, etiqueta: RegExp) => {
  const b = [...cont.querySelectorAll("button")].find((x) => etiqueta.test(norm(x.textContent)))!;
  await act(async () => { b.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
};

describe("#126-A · flujo de caja: pesos recibidos vs equivalente contable de dólares", () => {
  test("base «Caja»: el ingreso suma pesos + equivalente, y una nota cuantifica el equivalente como NO pesos recibidos", async () => {
    const { cont, cerrar } = await montar();
    await cambiarBase(cont, /^Caja/);
    const nota = cont.querySelector('[data-testid="nota-equivalente-dolares"]');
    assert.ok(nota, "debe avisar");
    assert.match(norm(nota!.textContent), /\$\s?1\.230\.000/);
    assert.match(norm(nota!.textContent), /equivalente contable/);
    assert.match(norm(nota!.textContent), /no son pesos recibidos/);
    assert.match(norm(cont.textContent), /pesos recibidos en cartera más, si hay, el equivalente contable/);
    assert.match(norm(cont.textContent), /\$\s?4\.670\.000/, "2.940.000 + 1.230.000 + 500.000 en el total de ingresos");
    await cerrar();
  });
  test("base «Esperado»: sin nota (no usa abonos); y sin dólares recibidos no aparece ninguna nota", async () => {
    const { cont, cerrar } = await montar();
    assert.equal(cont.querySelector('[data-testid="nota-equivalente-dolares"]'), null);
    await cerrar();
  });
});

describe("#126-A · conciliaciones: el abono recibido en dólares no se presenta como abono en pesos", () => {
  const src = readFileSync(new URL("../app/(dashboard)/dashboard/contabilidad/conciliaciones/page.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  test("la consulta trae moneda_pago y el ítem rotula «Abono cartera (dólares)» con USD recibidos y «equivalente contable»", () => {
    assert.match(src, /select\("id, numero_contrato, fecha_abono, valor_abono, monto_cop, moneda_pago,/);
    assert.match(src, /moneda_pago === "USD"/);
    assert.match(src, /"Abono cartera \(dólares\)"/);
    assert.match(src, /recibidos \(equivalente contable en pesos\)/);
  });
});
