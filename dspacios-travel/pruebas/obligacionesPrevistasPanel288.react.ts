// Se ejecuta con npm run test:react. #75 · 288 — las obligaciones PREVISTAS se distinguen de las exigibles en la pantalla.
import { test } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { ObligacionesPrevistasPanel } = await import("../components/contrato/ObligacionesPrevistasPanel.tsx");
const h = React.createElement;

test("el panel rotula las previstas como «aún no exigibles», explica cuándo nacen y suma el total previsto", () => {
  const html = renderToStaticMarkup(h(ObligacionesPrevistasPanel, { filas: [
    { clave: "cxp:1:hotel", servicio: "Hotel", proveedor: "Hotel X", tipo_proveedor: "hotel", valor_total: 500000, moneda: "COP" },
    { clave: "cxp:2:aereo", servicio: "Tiquetes", proveedor: null, tipo_proveedor: "aereo", valor_total: 300000, moneda: "COP" },
  ] }));
  assert.match(html, /Obligaciones previstas — aún no exigibles/);
  assert.match(html, /al confirmar el contrato/);
  assert.match(html, /Sin especificar/);
  assert.match(html, /Total previsto/);
  assert.match(html, /800\.000/);
});

test("sin previstas no pinta nada (un contrato confirmado o histórico queda como siempre)", () => {
  assert.equal(renderToStaticMarkup(h(ObligacionesPrevistasPanel, { filas: [] })), "");
});
