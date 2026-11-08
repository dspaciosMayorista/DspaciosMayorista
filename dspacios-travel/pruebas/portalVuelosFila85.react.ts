// #85 — presentación de «Ver vuelos». Se ejecuta con test:react (loader TSX). FIXTURES LOCALES inventados.
import { test } from "node:test";
import assert from "node:assert/strict";
const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { FilaVuelosContrato } = await import("../components/portal/VuelosContrato.tsx");

const tramo = (o: Record<string, unknown>) => ({
  clave: "a", direccion: "ida", aerolinea: "AvianX", origen: "Medellín", destino: "Cartagena", fuente: null,
  contratado: { numeroVuelo: "AV100", fecha: "2026-12-01", horaSalida: "08:00", horaLlegada: "09:10" }, ausentes: [],
  vinculo: "sin_vinculo", comparacion: null, comparados: [], sinDatoOperativo: [], registrado: {}, diferencias: [], ...o,
});
const html = (datos: unknown) => renderToStaticMarkup(React.createElement("table", null, React.createElement("tbody", null, React.createElement(FilaVuelosContrato, { datos: datos as never }))));

test("sin vuelos registrados (lectura correcta): no hay fila ni «Ver vuelos»", () => {
  assert.equal(html({ tramos: [], incompleto: false }).includes("Ver vuelos"), false);
  assert.equal(html({ tramos: [], incompleto: false }).includes("<tr"), false);
});

test("lectura fallida o ausente: aviso breve, no «Ver vuelos» ni «sin vuelos»", () => {
  for (const d of [{ tramos: [], incompleto: true }, undefined]) {
    const h = html(d);
    assert.match(h, /No se pudieron cargar los vuelos\./);
    assert.equal(h.includes("Ver vuelos"), false);
  }
});

test("origen: etiqueta solo si está acreditado; sin explicaciones técnicas de vínculo", () => {
  const h = html({ tramos: [tramo({ vinculo: "acreditado", fuente: "bloqueo", comparacion: "completa" }), tramo({ clave: "b", direccion: "suelto" })], incompleto: false });
  assert.match(h, /Ver vuelos/);
  assert.equal((h.match(/Bloqueo/g) ?? []).length, 1);
  assert.doesNotMatch(h, /Manual|Empaquetado|cotejar|vínculo|tramo suelto/i);
  assert.match(h, /Coincide con el horario registrado/);
});

test("diferencias de horario conservan su aviso; comprobación fallida solo un aviso corto", () => {
  const h = html({ tramos: [tramo({ vinculo: "acreditado", fuente: "empaquetado", comparacion: "diferente", diferencias: ["horaSalida"], registrado: { horaSalida: "09:30" } }), tramo({ clave: "c", vinculo: "no_comprobada" })], incompleto: false });
  assert.match(h, /El último horario registrado en D&#x27;spacios es distinto|El último horario registrado en D'spacios es distinto/);
  assert.match(h, /09:30/);
  assert.match(h, /Empaquetado/);
  assert.match(h, /No se pudo comprobar el horario registrado\./);
});
