// Genera visual/historial.html (componente REAL + CSS compilado del build) con datos sintéticos; Edge headless lo captura a 3 anchos.
// Uso: node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs --experimental-loader ./pruebas/support/reactLoader.mjs docs/tecnico/evidence-block1-r8/visual/render_historial.react.ts
import { createElement, type ComponentType } from "react";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { renderToStaticMarkup } = await import("react-dom/server");
const { HistorialMovimientos } = await import("../../../../app/(dashboard)/dashboard/vuelos/[id]/HistorialMovimientos.tsx");
const { agruparHistorial } = await import("../../../../lib/vuelos/historial.ts");

const b = { motivo: null, registrado_por: "Javier", contrato_manual: null, numero_contrato: null };
const filas = [
  { ...b, id: 1, tipo: "traslado_cupo", operacion_id: "t", fecha_movimiento: "2026-10-05T15:00:00Z", bloqueo_origen_id: 1, bloqueo_destino_id: 2, numero_silla_origen: 10, numero_silla_destino: 8, cupos_origen_antes: 10, cupos_origen_despues: 8, cupos_destino_antes: 6, cupos_destino_despues: 8, motivo: "Cupos libres para el grupo de octubre" },
  { ...b, id: 2, tipo: "traslado_cupo", operacion_id: "t", fecha_movimiento: "2026-10-05T15:00:00Z", bloqueo_origen_id: 1, bloqueo_destino_id: 2, numero_silla_origen: 9, numero_silla_destino: 7, cupos_origen_antes: 10, cupos_origen_despues: 8, cupos_destino_antes: 6, cupos_destino_despues: 8, motivo: "Cupos libres para el grupo de octubre" },
  { ...b, id: 3, tipo: "retiro_cupo", operacion_id: "r", fecha_movimiento: "2026-11-24T04:30:00+00:00", bloqueo_origen_id: 1, bloqueo_destino_id: null, numero_silla_origen: 4, motivo: "Se trasladó al record BBB222 (texto libre, no es un traslado)", cupos_origen_antes: 8, cupos_origen_despues: 7 },
  { ...b, id: 4, tipo: "mover_con_cupo", operacion_id: "m", fecha_movimiento: "2026-11-02T20:15:00Z", bloqueo_origen_id: 2, bloqueo_destino_id: 1, numero_silla_origen: 3, numero_silla_destino: 11, numero_contrato: "DTM-0451", cupos_origen_antes: 8, cupos_origen_despues: 7, cupos_destino_antes: 7, cupos_destino_despues: 8 },
  { id: 5, tipo: null, operacion_id: null, motivo: "pasó al record CCC333", fecha_movimiento: "2026-01-02T12:00:00Z", registrado_por: null, bloqueo_origen_id: 1, bloqueo_destino_id: null },
] as never[];
const cuerpo = renderToStaticMarkup(createElement(HistorialMovimientos as ComponentType<Record<string, unknown>>, { historial: agruparHistorial(filas), bloqueoId: 1, recordPorId: { 1: "AAA111", 2: "BBB222", 3: "CCC333" } }));
const dir = ".next/static/chunks";
const css = readdirSync(dir).filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
writeFileSync("docs/tecnico/evidence-block1-r8/visual/historial.html",
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><script>const w=new URLSearchParams(location.search).get("w");if(w)document.addEventListener("DOMContentLoaded",()=>{document.body.style.width=w+"px";document.body.style.boxSizing="border-box"})</script></head><body class="bg-gray-50 p-3"><section class="rounded-xl border border-gray-200 bg-white p-4"><p class="mb-1 text-sm font-semibold text-gray-700">Movimientos históricos</p><p class="mb-2 text-xs text-gray-400">Trazabilidad de traslados, pasajeros movidos y cupos retirados. No son cupos ni se venden.</p>${cuerpo.replaceAll("<details", "<details open")}</section></body></html>`);
console.log("ok", cuerpo.length);
