import { createElement, type ComponentType } from "react";
const { renderToStaticMarkup } = await import("react-dom/server");
const { HistorialMovimientos } = await import("../../../../app/(dashboard)/dashboard/vuelos/[id]/HistorialMovimientos.tsx");
const { agruparHistorial } = await import("../../../../lib/vuelos/historial.ts");
const f = (id: number) => ({ id, tipo: "traslado_cupo", operacion_id: "t", motivo: null, registrado_por: "Javier", fecha_movimiento: "2026-10-05T15:00:00Z", bloqueo_origen_id: 1, bloqueo_destino_id: 2, numero_silla_origen: id, numero_silla_destino: id + 100, cupos_origen_antes: 10, cupos_origen_despues: 8, cupos_destino_antes: 6, cupos_destino_despues: 8 }) as never;
const len = (n: number) => renderToStaticMarkup(createElement(HistorialMovimientos as ComponentType<Record<string, unknown>>, { historial: agruparHistorial(Array.from({ length: n }, (_, i) => f(i + 1))), bloqueoId: 1, recordPorId: { 1: "AAA111", 2: "BBB222" } })).length;
console.log("1 seat", len(1), "2 seats", len(2), "10 seats", len(10));
