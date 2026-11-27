// #13 — Aviso de compra por vencer en la campana global: permisos del destinatario, destino del enlace y texto con plazo a hoy (Bogotá). Puro.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ROLES_AVISO_COMPRA, hrefCompra, puedeVerAvisosCompra, textoCompra } from "../lib/avisos/compraAviso.ts";
import { textoAviso } from "../lib/avisos/presentacion.ts";

describe("#13 aviso en la campana", () => {
  test("solo quienes pueden ESCRIBIR paquetes lo ven: superadmin, gerencia, administración y operaciones; no venta, vuelos, aliados ni sin rol", () => {
    assert.deepEqual([...ROLES_AVISO_COMPRA], ["superadmin", "gerencia", "administracion", "operaciones"]);
    for (const rol of ["superadmin", "gerencia", "administracion", "operaciones"]) assert.equal(puedeVerAvisosCompra(rol), true, rol);
    for (const rol of ["venta", "control_vuelo", "agencia", "freelance", "cliente_final", "", null, undefined]) assert.equal(puedeVerAvisosCompra(rol), false, String(rol));
  });
  test("el enlace lleva a la pantalla de ESA vigencia; con datos incompletos cae al listado, nunca a una ruta inventada", () => {
    assert.equal(hrefCompra({ ventana_tipo: "paquete", ventana_ref: 11 }), "/dashboard/paquetes/11?tab=config");
    assert.equal(hrefCompra({ ventana_tipo: "salida_dinamica", ventana_ref: 12 }), "/dashboard/paquetes/12?tab=vuelos");
    assert.equal(hrefCompra({ ventana_tipo: "empaquetado", ventana_ref: 5 }), "/dashboard/vuelos/empaquetados/5");
    assert.equal(hrefCompra({ ventana_tipo: "paquete_total", ventana_ref: 8 }), "/dashboard/paquetes/total/8");
    assert.equal(hrefCompra({ ventana_tipo: "otra", ventana_ref: 1 }), "/dashboard/paquetes");
    assert.equal(hrefCompra({ ventana_tipo: "paquete", ventana_ref: null }), "/dashboard/paquetes");
    assert.equal(hrefCompra({}), "/dashboard/paquetes");
  });
  test("el texto calcula el plazo a la fecha de HOY en cada sondeo (hoy = 2026-11-25)", () => {
    const f = (fin: string) => ({ ventana_tipo: "paquete", ventana_ref: 1, ventana_titulo: "Cartagena 4N", compra_fin: fin });
    assert.equal(textoCompra(f("2026-11-25"), "2026-11-25"), "Compra por vencer · paquete: Cartagena 4N · Vence hoy (25/11/2026)");
    assert.equal(textoCompra(f("2026-11-26"), "2026-11-25"), "Compra por vencer · paquete: Cartagena 4N · Vence mañana (26/11/2026)");
    assert.equal(textoCompra(f("2026-11-30"), "2026-11-25"), "Compra por vencer · paquete: Cartagena 4N · Vence en 5 días (30/11/2026)");
    assert.equal(textoCompra(f("2026-11-24"), "2026-11-25"), "Compra por vencer · paquete: Cartagena 4N · Venció (24/11/2026)", "si el archivo diario aún no lo retiró, no dice que vence");
    assert.match(textoCompra({ compra_fin: null, ventana_titulo: null }, "2026-11-25"), /una vigencia de compra/);
    assert.match(textoCompra({ ventana_tipo: "empaquetado", ventana_titulo: "MDE - CTG - MDE", compra_fin: "2026-11-29" }, "2026-11-25"), /^Compra por vencer · empaquetado: MDE - CTG - MDE · Vence en 4 días \(29\/11\/2026\)$/);
    assert.match(textoCompra({ ventana_tipo: "salida_dinamica", ventana_titulo: "X", compra_fin: "2026-11-28" }, "2026-11-25"), /· salida dinámica: X/);
    assert.match(textoCompra({ ventana_tipo: "paquete_total", ventana_titulo: "T", compra_fin: "2026-11-26" }, "2026-11-25"), /· paquete dinámico total: T/);
  });
  test("textoAviso conserva los tipos existentes (344: la alerta de compra ya no es un tipo de la campana; su texto lo compone textoCompra en el área de ALERTAS)", () => {
    assert.equal(textoAviso("soporte_pago_nuevo", "00-0451"), "Nuevo soporte de pago en el contrato 00-0451");
    assert.equal(textoAviso("soporte_pago_reemplazado", "00-0451"), "Se reemplazó un soporte de pago en el contrato 00-0451");
    assert.equal(textoAviso("solicitud_contrato", "COT-1"), "Solicitud de contrato de un aliado: cotización COT-1");
  });
});
