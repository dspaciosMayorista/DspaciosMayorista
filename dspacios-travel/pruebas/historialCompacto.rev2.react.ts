// Rev2 B1-01 — historial de movimientos COMPACTO. Se ejecuta con npm run test:react:rev2 (glob *.rev2.react.ts). Datos sintéticos.
// Esperado (derivado del pedido del dueño, no de la implementación): la página no debe crecer con cada movimiento; la información sigue completa (Bogotá, operación guardada, quién, motivo rotulado, detalle por silla).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const { HistorialMovimientos, VISIBLES_AL_ABRIR } = await import("../app/(dashboard)/dashboard/vuelos/[id]/HistorialMovimientos.tsx");
const { agruparHistorial } = await import("../lib/vuelos/historial.ts");
import type { MovimientoFila } from "../lib/vuelos/historial.ts";

const RECORDS = { 1: "AAA111", 2: "BBB222" };
const html = (filas: MovimientoFila[]) => renderToStaticMarkup(createElement(HistorialMovimientos as ComponentType<Record<string, unknown>>, { historial: agruparHistorial(filas), bloqueoId: 1, recordPorId: RECORDS }));
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&quot;/g, "\"").replace(/\s+/g, " ");
const base = { motivo: null, registrado_por: "Javier", contrato_manual: null, numero_contrato: null };
// n retiros de un cupo, uno por día (un solo día = una sola operación), el más reciente es el de mayor id.
const retiros = (n: number): MovimientoFila[] => Array.from({ length: n }, (_, i) => ({
  ...base, id: i + 1, tipo: "retiro_cupo", operacion_id: `o${i + 1}`, fecha_movimiento: `2026-11-${String(10 + i).padStart(2, "0")}T15:00:00Z`,
  bloqueo_origen_id: 1, bloqueo_destino_id: null, numero_silla_origen: 20 - i, cupos_origen_antes: 20 - i, cupos_origen_despues: 19 - i,
  motivo: i === 0 ? "Se trasladó al record BBB222" : null,
}));
const cuenta = (h: string, re: RegExp) => (h.match(re) ?? []).length;

test("8 movimientos: solo 5 a la vista y 3 tras UN pliegue «Ver 3 movimientos anteriores»; cada movimiento nace CERRADO", () => {
  const h = html(retiros(8));
  assert.equal(VISIBLES_AL_ABRIR, 5);
  assert.equal(cuenta(h, /data-testid="movimiento-historial"/g), 8, "ninguno se pierde");
  const ant = h.indexOf('data-testid="movimientos-anteriores"');
  assert.ok(ant > 0);
  assert.equal(cuenta(h.slice(0, ant), /data-testid="movimiento-historial"/g), 5);
  assert.equal(cuenta(h.slice(ant), /data-testid="movimiento-historial"/g), 3);
  assert.match(texto(h), /Ver 3 movimientos anteriores/);
  assert.match(texto(h), /8 movimientos, del más reciente al más antiguo/);
  assert.doesNotMatch(h, /<details[^>]*\sopen[\s=>]/, "ningún <details> viene abierto");
  // Antes (lista plana) no había <details> por movimiento: aquí hay uno por movimiento + el pliegue exterior.
  assert.ok(cuenta(h, /<details/g) >= 9);
});

test("la fila cerrada ya dice qué pasó y cuándo (Bogotá); el detalle completo está dentro de su <details>", () => {
  const h = html(retiros(2));
  const primero = h.slice(h.indexOf("<li"), h.indexOf("</summary>"));
  const t = texto(primero);
  assert.match(t, /Retiro de cupo/);
  assert.match(t, /11\/11\/2026 10:00 \(hora de Bogotá\)/); // 15:00Z = 10:00 Bogotá, más reciente primero
  assert.doesNotMatch(primero, /Registrado por|Motivo/, "el detalle NO va en la fila cerrada");
  const todo = texto(h);
  assert.match(todo, /Registrado por Javier/);
  assert.match(todo, /Motivo \(texto libre\): “Se trasladó al record BBB222”/);
});

test("el motivo que nombra otro record sigue siendo texto libre: nada se infiere como traslado", () => {
  const t = texto(html(retiros(8)));
  assert.doesNotMatch(t, /Traslado de cupos|hacia BBB222|desde BBB222|Entraron|Salieron/);
  assert.match(t, /Record destino No aplica/);
});

test("hasta 5 movimientos no hay pliegue exterior; 0 movimientos conserva el mensaje vacío", () => {
  assert.doesNotMatch(html(retiros(5)), /movimientos-anteriores/);
  assert.match(texto(html(retiros(1))), /1 movimiento, del más reciente/);
  assert.match(texto(html([])), /Sin movimientos de sillas registrados/);
});

test("detalle por silla de un traslado sigue disponible (anidado) y las sillas/cupos se muestran con sus límites", () => {
  const f = (id: number, so: number, sd: number): MovimientoFila => ({ ...base, id, tipo: "traslado_cupo", operacion_id: "op", fecha_movimiento: "2026-10-05T15:00:00Z", bloqueo_origen_id: 1, bloqueo_destino_id: 2, numero_silla_origen: so, numero_silla_destino: sd, cupos_origen_antes: 12, cupos_origen_despues: 10, cupos_destino_antes: 6, cupos_destino_despues: 8 });
  const t = texto(html([f(1, 10, 8), f(2, 9, 7)]));
  assert.match(t, /Salieron 2 cupo\(s\) libre\(s\) hacia BBB222/);
  assert.match(t, /Detalle por silla \(2\)/);
  assert.match(t, /Silla #10 → #8/);
  assert.match(t, /Cupos origen \(antes → después\) 12 → 10/);
  assert.match(t, /Cupos destino \(antes → después\) 6 → 8/);
});

test("tarjeta compacta: en móvil el detalle usa 2 columnas y desde lg 4; la fila cerrada se envuelve (flex-wrap) sin desbordar", () => {
  const h = html(retiros(1));
  assert.match(h, /grid-cols-2[^"]*lg:grid-cols-4/);
  assert.match(h, /flex-wrap/);
  assert.match(h, /break-words/);
});
