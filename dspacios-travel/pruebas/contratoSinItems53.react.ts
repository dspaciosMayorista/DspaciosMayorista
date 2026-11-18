// Se ejecuta con el cargador del arnés (ver «test:react»). #53 · el DOCUMENTO real (ContratoDocumento renderizado a HTML), no solo sus funciones puras:
//   · contrato histórico del importador de Minorista (precio registrado y NINGÚN ítem): ya no imprime «Total $0» / «Saldo $0»;
//   · F4: un acuerdo de mínimo se muestra aunque el contrato no tenga condiciones congeladas (sin inventar condiciones ni restricciones);
//   · F5: con la lectura del acuerdo fallida no se imprime ningún mínimo, solo el aviso;
//   · un contrato con ítems conserva EXACTAMENTE su presentación de siempre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { formatMoneda } = await import("../lib/utils.ts");

const venta = (extra: Record<string, unknown> = {}) => ({
  numero_contrato: "MIN-00-0901", cliente: "Titular Importado", cliente_documento: "123456", cliente_direccion: null, cliente_telefono: null, asesor: "Asesor Importado", asesor_firma_nombre: "Asesor Importado",
  asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "activo", fecha_emision: "2026-09-05", fecha_salida: "2026-12-10", pax: 2, plan_nombre: null, tours_traslados: null,
  asistencia_medica: null, moneda: "COP", tenant: "minorista", tipo_asesor: null, agencia_nombre: null, freelance_nombre: null, precio_venta: 3_000_000, ...extra,
});
const item = (extra: Record<string, unknown> = {}) => ({ id: 1, numero_contrato: "MIN-00-0901", descripcion: "Paquete Cartagena", adultos: 2, ninos: 0, tarifa_adulto: 1_500_000, tarifa_nino: 0, orden: 0, modo_precio: "por_persona", valor_total: null, ...extra });
const sinCondiciones = { hayCondiciones: false, moneda: "COP", filas: [], restringidas: [], huboRestriccionOriginal: false, resumen: null, minimoAcordado: null, minimoNoVerificable: false };

function render(over: Record<string, unknown>) {
  const props = { venta: venta(), pasajeros: [], hoteles: [], vuelos: [], items: [], totalPagado: 1_000_000, agencia: AGENCIA_PRUEBA, condiciones: null, habitacionesBernalo: [], netoTotalExigible: null, ...over };
  const html = renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, props));
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
}
const $ = (n: number) => formatMoneda(n, "COP").replace(/ /g, " ");

test("histórico SIN ítems y con precio registrado: total = precio registrado, saldo descuenta lo pagado y se avisa (nunca $0)", () => {
  const t = render({});
  assert.ok(t.includes(`Total del contrato ${$(3_000_000)}`), t.slice(t.indexOf("Valores y Pagos"), t.indexOf("Valores y Pagos") + 200));
  assert.ok(t.includes(`Total pagado ${$(1_000_000)}`));
  assert.ok(t.includes(`Saldo pendiente ${$(2_000_000)}`));
  assert.ok(!t.includes(`Total del contrato ${$(0)}`), "ya no imprime el total en cero");
  assert.match(t, /Este contrato no tiene detalle de ítems \(registro histórico\): el total es el precio de venta registrado, sin desglose\./);
});

test("sin ítems y SIN precio registrado: no se inventa nada (sigue en cero y sin aviso)", () => {
  const t = render({ venta: venta({ precio_venta: 0 }), totalPagado: 0 });
  assert.ok(t.includes(`Total del contrato ${$(0)}`));
  assert.doesNotMatch(t, /no tiene detalle de ítems/);
});

test("con ítems el documento conserva su presentación de siempre (total = suma de ítems, sin aviso)", () => {
  const t = render({ items: [item()] });
  assert.ok(t.includes(`Total del contrato ${$(3_000_000)}`));
  assert.ok(t.includes(`Saldo pendiente ${$(2_000_000)}`));
  assert.doesNotMatch(t, /no tiene detalle de ítems/);
  // Si el precio registrado difiere de la suma de ítems, NO se sustituye: mandan los ítems (comportamiento previo).
  const dif = render({ venta: venta({ precio_venta: 9_999_999 }), items: [item()] });
  assert.ok(dif.includes(`Total del contrato ${$(3_000_000)}`));
});

test("F4 · acuerdo de mínimo SIN condiciones congeladas: el documento lo muestra y no inventa condiciones ni restricciones", () => {
  const condiciones = { ...sinCondiciones, minimoAcordado: { texto: "Pago mínimo para confirmar: $200.000 COP (mínimo acordado)", minimoConfirmar: { regla: "acuerdo", minimo: 200_000, moneda: "COP", trm: null } } };
  const t = render({ venta: venta({ estado: "pendiente" }), items: [item()], condiciones });
  assert.match(t, /Pago mínimo para confirmar: \$200\.000 COP \(mínimo acordado\)/);
  assert.doesNotMatch(t, /Condiciones de pago/);
  // Corrección del dueño 2026-11-18: ya confirmado, el aviso accionable desaparece (la regla de confirmación no cambia).
  assert.doesNotMatch(render({ items: [item()], condiciones }), /Pago mínimo para confirmar/);
});

test("F5 · lectura del acuerdo fallida: no se imprime ningún mínimo, solo el aviso de que no está disponible", () => {
  const condiciones = { ...sinCondiciones, minimoNoVerificable: true };
  const t = render({ venta: venta({ estado: "pendiente" }), items: [item()], condiciones });
  assert.match(t, /Pago mínimo para confirmar: no disponible en este momento/);
  assert.doesNotMatch(t, /\(mínimo acordado\)/);
  assert.doesNotMatch(render({ items: [item()], condiciones }), /no disponible en este momento/, "confirmado: sin aviso");
});

test("sin acuerdo y sin condiciones el documento no agrega ninguna línea de mínimo (como antes)", () => {
  const t = render({ items: [item()], condiciones: sinCondiciones });
  assert.doesNotMatch(t, /Pago mínimo/);
});
