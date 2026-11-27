// Se ejecuta con npm run test:react:resto (loader del arnés).
// Movimientos históricos de un record: operación real guardada, fecha+hora de Bogotá, datos ausentes explícitos. Datos sintéticos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const { HistorialMovimientos } = await import("../app/(dashboard)/dashboard/vuelos/[id]/HistorialMovimientos.tsx");
const { agruparHistorial } = await import("../lib/vuelos/historial.ts");
import type { MovimientoFila } from "../lib/vuelos/historial.ts";

const RECORDS = { 1: "AAA111", 2: "BBB222", 3: "CCC333" };
const html = (filas: MovimientoFila[], bloqueoId = 1) =>
  renderToStaticMarkup(createElement(HistorialMovimientos as ComponentType<Record<string, unknown>>, { historial: agruparHistorial(filas), bloqueoId, recordPorId: RECORDS }));
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&quot;/g, "\"").replace(/\s+/g, " ");
const base = { motivo: null, registrado_por: "Javier", contrato_manual: null, numero_contrato: null };

test("retiro cuyo motivo menciona otro record: se muestra como retiro, sin destino ni cupos de destino", () => {
  const t = texto(html([{ ...base, id: 1, tipo: "retiro_cupo", operacion_id: "o1", fecha_movimiento: "2026-11-24T04:30:00+00:00", bloqueo_origen_id: 1, bloqueo_destino_id: null,
    numero_silla_origen: 4, motivo: "Se trasladó al record BBB222", cupos_origen_antes: 8, cupos_origen_despues: 7 }]));
  assert.match(t, /Retiro de cupo/);
  assert.doesNotMatch(t, /Traslado|Entraron|Salieron|hacia BBB222|desde BBB222/);
  assert.match(t, /Record destino No aplica/);
  assert.match(t, /Cupos origen \(antes → después\) 8 → 7/);
  assert.match(t, /Cupos destino \(antes → después\) No aplica/);
  assert.match(t, /Motivo \(texto libre\): “Se trasladó al record BBB222”/);
  assert.match(t, /Registrado por Javier/);
  assert.match(t, /Sillas de origen #4/);
});

test("fecha y hora en Bogotá, con límites de día (UTC-5, sin importar la zona del servidor)", () => {
  const f = (id: number, fecha: string): MovimientoFila => ({ ...base, id, tipo: "retiro_cupo", operacion_id: `o${id}`, fecha_movimiento: fecha, bloqueo_origen_id: 1, bloqueo_destino_id: null, numero_silla_origen: id });
  const t = texto(html([f(1, "2026-11-24T04:59:00Z"), f(2, "2026-11-24T05:00:00Z"), f(3, "2026-12-31T23:30:00-05:00"), f(4, "2027-01-01T04:59:59Z")]));
  assert.match(t, /23\/11\/2026 23:59 \(hora de Bogotá\)/);
  assert.match(t, /24\/11\/2026 00:00 \(hora de Bogotá\)/);
  assert.match(t, /31\/12\/2026 23:30 \(hora de Bogotá\)/);
  assert.match(t, /31\/12\/2026 23:59/); // 04:59:59Z del 1-ene-2027 sigue siendo 31-dic en Bogotá
  // Más reciente primero.
  assert.ok(t.indexOf("31/12/2026 23:59") < t.indexOf("31/12/2026 23:30") && t.indexOf("31/12/2026 23:30") < t.indexOf("24/11/2026 00:00") && t.indexOf("24/11/2026 00:00") < t.indexOf("23/11/2026 23:59"));
});

test("traslado real: origen/destino guardados, inventario antes/después, sillas y detalle por silla", () => {
  const fila = (id: number, so: number, sd: number): MovimientoFila => ({ ...base, id, tipo: "traslado_cupo", operacion_id: "op", fecha_movimiento: "2026-10-05T15:00:00Z", bloqueo_origen_id: 1, bloqueo_destino_id: 2,
    numero_silla_origen: so, numero_silla_destino: sd, cupos_origen_antes: 10, cupos_origen_despues: 8, cupos_destino_antes: 6, cupos_destino_despues: 8 });
  const filas = [fila(1, 10, 8), fila(2, 9, 7)];
  const t = texto(html(filas));
  assert.match(t, /Traslado de cupos libres/);
  assert.match(t, /05\/10\/2026 10:00/);
  assert.match(t, /Cantidad 2 sillas/);
  assert.match(t, /Record origen AAA111/);
  assert.match(t, /Record destino BBB222/);
  assert.match(t, /Cupos origen \(antes → después\) 10 → 8/);
  assert.match(t, /Cupos destino \(antes → después\) 6 → 8/);
  assert.match(t, /Sillas de origen #9, #10/);
  assert.match(t, /Detalle por silla \(2\)/);
  assert.match(t, /Silla #10 → #8/);
  assert.match(t, /Silla #9 → #7/);
  // Visto desde el destino se lee como entrada.
  assert.match(texto(html(filas, 2)), /Entraron 2 cupo\(s\) libre\(s\) desde AAA111/);
});

test("fila anterior a la 194 sin datos: todo lo ausente dice «No guardado» y no se deduce nada del motivo", () => {
  const t = texto(html([{ id: 9, tipo: null, operacion_id: null, motivo: "pasó al record CCC333", fecha_movimiento: "2026-01-02T12:00:00Z", registrado_por: null, bloqueo_origen_id: 1, bloqueo_destino_id: null }]));
  assert.match(t, /Movimiento anterior \(tipo no guardado\)/);
  assert.match(t, /no se guardó su tipo ni su destino/);
  assert.match(t, /Registrado por No guardado/);
  assert.match(t, /Record destino No guardado/);
  assert.match(t, /Cupos origen \(antes → después\) No guardado/);
  assert.match(t, /Sillas de origen No guardado/);
  assert.doesNotMatch(t, /Cambio entre records|hacia CCC333/);
  assert.match(t, /02\/01\/2026 07:00/);
});

test("sin movimientos: mensaje vacío; diseño compacto en móvil (2 columnas) y amplio desde lg (4)", () => {
  assert.match(texto(html([])), /Sin movimientos de sillas registrados/);
  const h = html([{ ...base, id: 1, tipo: "retiro_cupo", operacion_id: "o", fecha_movimiento: "2026-10-05T15:00:00Z", bloqueo_origen_id: 1, bloqueo_destino_id: null }]);
  assert.match(h, /grid-cols-2[^"]*lg:grid-cols-4/);
});
