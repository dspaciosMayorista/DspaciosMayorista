// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom).
//
// GRUPO 1 · Pagos a proveedor — reloj fijo antes y después de las 7 p. m. de
// Bogotá. Código REAL de punta a punta: `PagosList` (módulo Pagos), el panel de
// pago de la pestaña Proveedores del contrato (`GestionTabs`), la Server Action
// `registrarPagoProveedor` y `lib/contabilidad/asientos.ts` contra la BD en
// memoria del arnés. Debe salir la MISMA fecha en el formulario, en
// `cxp_pagos.fecha` y en el asiento del pago.
import { DIA_BOGOTA, DESPUES_DEL_CORTE, MOMENTOS, asientos, botonConTexto, clic, enviar, escribir, esperar, montar, reloj, soltarReloj, usarBD } from "./support/fechaNegocioArnes.ts";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { PagosList } = await import("../app/(dashboard)/dashboard/pagos/PagosList.tsx");
const { GestionTabs } = await import("../app/(dashboard)/dashboard/contratos/[numero]/GestionTabs.tsx");
const { registrarPagoProveedor } = await import("../app/(dashboard)/dashboard/pagos/actions.ts");
const h = React.createElement;

const CXP = {
  id: 5, numero_contrato: "DTM-0451", proveedor: "Hotel Sol", tipo_proveedor: "hotel", servicio: "Hotel Sol",
  valor_total: 1_000_000, moneda: "COP", tenant: "mayorista",
};
const semilla = () => ({ cuentas_por_pagar: [{ ...CXP }] });

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.();
  desmontar = undefined;
  soltarReloj();
});
after(async () => { (await import("./support/fechaNegocioArnes.ts")).dom.window.close(); });

const fechaPago = (raiz: Element) => raiz.querySelector<HTMLInputElement>('input[aria-label="Fecha del pago"]');
// El campo de valor del MISMO formulario que la fecha (la página tiene otros
// campos numéricos antes: IVA, retención, alta de proveedor…).
const valorPago = (raiz: Element) =>
  fechaPago(raiz)?.closest("form, div.flex-wrap")?.querySelector<HTMLInputElement>('input[type="number"]') ?? null;

for (const [momento, instante] of MOMENTOS) {
  test(`Pagos (módulo) a las ${momento}: formulario, cxp_pagos y asiento con ${DIA_BOGOTA}`, async () => {
    reloj(instante);
    const bd = usarBD(semilla());
    const fila = {
      ...CXP, fecha_obligacion: null, fecha_vencimiento: "2026-10-10", aplica_retencion: null, pct_retencion: null,
      clasificacion: "costo" as const, base_gravable: null, iva_proveedor: null, pagos: [], pagado: 0, retenido: 0, saldo: 1_000_000,
    };
    const m = await montar(h(PagosList, { rows: [fila], proveedores: [], catalogo: [], ivaPct: 0.19 }));
    desmontar = m.desmontar;
    await clic([...m.contenedor.querySelectorAll("tr")].find((t) => t.textContent?.includes("DTM-0451")), "la fila de la cuenta");
    assert.equal(fechaPago(m.contenedor)?.value, DIA_BOGOTA, "fecha por defecto del formulario");

    await escribir(valorPago(m.contenedor)!, "300000");
    await enviar(fechaPago(m.contenedor)!.closest("form"));
    await esperar(() => bd.filas("cxp_pagos").length > 0);

    const [pago] = bd.filas("cxp_pagos");
    assert.equal(pago?.fecha, DIA_BOGOTA, "cxp_pagos.fecha");
    const [asiento] = asientos(bd, "pago_proveedor");
    assert.equal(asiento?.fecha, DIA_BOGOTA, "asiento del pago = fecha del pago");
    assert.equal(asiento?.referencia, `pago:5:${pago.id}`);
  });

  test(`Contrato → Proveedores a las ${momento}: el panel de pago propone ${DIA_BOGOTA} y lo guarda igual`, async () => {
    reloj(instante);
    const bd = usarBD(semilla());
    const m = await montar(h(GestionTabs, {
      numero: "DTM-0451", precioVenta: 3_000_000, impuesto: 0, clienteNombre: "Cliente", clienteDocumento: "CC 1",
      asesorNombre: "Asesor", asesorPct: 0, verFinanzas: true,
      costos: { costo_hotel: 1_000_000, costo_aereo: 0, costo_receptivo: 0, costo_asistencia: 0, otros_costos: 0 },
      abonos: [], cuotas: [], totalPagado: 0, comisionesB2B: [], facturas: [], formasPago: [],
      cuentasPorPagar: [{
        id: 5, proveedor: "Hotel Sol", servicio: "Hotel Sol", valor_total: 1_000_000, base_gravable: null, iva_proveedor: null,
        fecha_vencimiento: "2026-10-10", aplica_retencion: false, pct_retencion: 0, moneda: "COP", pagos: [], retenido: 0,
      }],
    }));
    desmontar = m.desmontar;
    await clic(botonConTexto(m.contenedor, "Proveedores"), "la pestaña Proveedores");
    // Abrir el panel de pago de la cuenta (botón de estado Pendiente · saldo).
    await clic(botonConTexto(m.contenedor, /Pendiente/), "el botón de estado de la cuenta");
    assert.equal(fechaPago(m.contenedor)?.value, DIA_BOGOTA, "fecha por defecto del panel");

    await escribir(valorPago(m.contenedor)!, "200000");
    await clic(botonConTexto(m.contenedor, "Registrar pago"), "Registrar pago");
    await esperar(() => bd.filas("cxp_pagos").length > 0);
    assert.equal(bd.filas("cxp_pagos")[0]?.fecha, DIA_BOGOTA, "cxp_pagos.fecha");
    assert.equal(asientos(bd, "pago_proveedor")[0]?.fecha, DIA_BOGOTA, "asiento del pago");
  });
}

test("fecha elegida a mano a las 19:30 Bogotá: el pago y su asiento la conservan", async () => {
  reloj(DESPUES_DEL_CORTE);
  const bd = usarBD(semilla());
  const r = await registrarPagoProveedor(5, 150_000, "2026-09-12");
  assert.deepEqual(r, { ok: true });
  assert.equal(bd.filas("cxp_pagos")[0].fecha, "2026-09-12");
  assert.equal(asientos(bd, "pago_proveedor")[0].fecha, "2026-09-12");
});

test("la Server Action sin fecha (llamada directa) usa el día de Bogotá a las 19:30", async () => {
  reloj(DESPUES_DEL_CORTE);
  const bd = usarBD(semilla());
  await registrarPagoProveedor(5, 150_000, "");
  assert.equal(bd.filas("cxp_pagos")[0].fecha, DIA_BOGOTA);
  assert.equal(asientos(bd, "pago_proveedor")[0].fecha, DIA_BOGOTA);
});
