// Se ejecuta con npm run test:react (loader del arnés).
//
// #90 · «Promociones» de la ficha del hotel: un resultado vacío válido NO es un error de consulta.
// Vacío válido → «Sin reglas» y administración habilitada. Error al consultar → aviso claro, sin «Sin reglas» y administración deshabilitada.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const { HotelPromociones } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/HotelPromociones.tsx");

type Props = { hotelId: number; reglas: unknown[]; errorCarga?: boolean };
const html = (p: Props) => renderToStaticMarkup(createElement(HotelPromociones as ComponentType<Props>, p));

describe("HotelPromociones: vacío válido vs error de carga", () => {
  test("sin filas y sin error: «Sin reglas», formulario habilitado", () => {
    const h = html({ hotelId: 72, reglas: [] });
    assert.match(h, /Sin reglas/);
    assert.doesNotMatch(h, /No se pudieron cargar/);
    assert.doesNotMatch(h, /<fieldset[^>]* disabled=""/);
  });
  test("error de consulta: aviso claro, sin «Sin reglas», formulario deshabilitado y botón de recarga", () => {
    const h = html({ hotelId: 72, reglas: [], errorCarga: true });
    assert.match(h, /role="alert"[^>]*>No se pudieron cargar las promociones de este hotel/);
    assert.doesNotMatch(h, /Sin reglas/);
    assert.match(h, /<fieldset[^>]* disabled=""/);
    assert.match(h, /Reintentar/);
  });
  test("con error no se listan reglas ni acciones de edición aunque lleguen filas", () => {
    const h = html({ hotelId: 72, reglas: [{ id: 1, tipo: "ebb", umbral: 30, pct: 18, activa: true }], errorCarga: true });
    assert.doesNotMatch(h, /Desactivar|Eliminar|Editar/);
  });
  test("con reglas y sin error se listan con su acción", () => {
    const h = html({ hotelId: 72, reglas: [{ id: 1, tipo: "ebb", umbral: 30, pct: 18, activa: true }, { id: 2, tipo: "long_stay", umbral: 4, pct: 25, activa: false }] });
    assert.match(h, /30 días o más antes del check-in/);
    assert.match(h, /4 noches o más/);
    assert.match(h, /\(inactiva\)/);
    assert.match(h, /Desactivar/);
    assert.match(h, /Activar/);
  });
});

test("la página distingue error de vacío: pasa errorCarga desde el error de la consulta", () => {
  const src = readFileSync(new URL("../app/(dashboard)/dashboard/producto/hoteles/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(src, /error: errorReglas/);
  assert.match(src, /errorCarga=\{!!errorReglas\}/);
});
