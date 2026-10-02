// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom).
//
// GRUPO 3 · Abonos a comisiones B2B y GRUPO 4 · Movimientos de pagos (fuera de
// contrato) — reloj fijo antes y después de las 7 p. m. de Bogotá. Componentes
// y Server Actions REALES contra la BD en memoria del arnés.
import { DIA_BOGOTA, DESPUES_DEL_CORTE, MOMENTOS, botonConTexto, clic, escribir, esperar, montar, reloj, soltarReloj, usarBD } from "./support/fechaNegocioArnes.ts";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { ComisionesList } = await import("../app/(dashboard)/dashboard/comisiones/ComisionesList.tsx");
const { registrarPagoComisionB2B } = await import("../app/(dashboard)/dashboard/comisiones/actions.ts");
const { MovimientosClient } = await import("../app/(dashboard)/dashboard/contabilidad/movimientos/MovimientosClient.tsx");
const { guardarMovimiento } = await import("../app/(dashboard)/dashboard/contabilidad/movimientos/actions.ts");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.();
  desmontar = undefined;
  soltarReloj();
});
after(async () => { (await import("./support/fechaNegocioArnes.ts")).dom.window.close(); });

const fecha = (raiz: Element) => raiz.querySelector<HTMLInputElement>('input[aria-label="Fecha"]');
const numeroJunto = (raiz: Element) =>
  fecha(raiz)?.closest("div.flex-wrap, div.grid")?.querySelector<HTMLInputElement>('input[type="number"]') ?? null;

// ── Grupo 3 · comisiones B2B ───────────────────────────────────────────────
const COMISION = {
  id: 31, numero_contrato: "DTM-0451", cliente: "Cliente", aliado: "Agencia Uno", nit: null, tipoAliado: "agencia",
  pct_comision: 0.1, totalComision: 300_000, retencion: 0, totalPagar: 300_000, estado: "pendiente", fecha_pago: null, pagos: [],
};
const semillaComision = () => ({ aliados_b2b: [{ id: 31, tenant: "mayorista", numero_contrato: "DTM-0451" }] });

for (const [momento, instante] of MOMENTOS) {
  test(`comisión B2B a las ${momento}: el abono propone y guarda ${DIA_BOGOTA}`, async () => {
    reloj(instante);
    const bd = usarBD(semillaComision());
    const m = await montar(h(ComisionesList, { rows: [COMISION] }));
    desmontar = m.desmontar;
    await clic(botonConTexto(m.contenedor, /Registrar abono/), "Registrar abono");
    assert.equal(fecha(m.contenedor)?.value, DIA_BOGOTA, "fecha por defecto del abono a la comisión");

    await escribir(numeroJunto(m.contenedor)!, "100000");
    // Texto exacto: el botón que despliega el panel dice "Registrar abono →".
    await clic(botonConTexto(m.contenedor, "Registrar abono"), "el botón Registrar abono del panel");
    await esperar(() => bd.filas("comision_b2b_pagos").length > 0);
    assert.equal(bd.filas("comision_b2b_pagos")[0]?.fecha, DIA_BOGOTA, "comision_b2b_pagos.fecha");
  });
}

test("comisión B2B: fecha manual a las 19:30 se respeta; sin fecha → día de Bogotá", async () => {
  reloj(DESPUES_DEL_CORTE);
  const bd = usarBD(semillaComision());
  await registrarPagoComisionB2B(31, 50_000, "2026-09-02");
  await registrarPagoComisionB2B(31, 50_000, "");
  assert.deepEqual(bd.filas("comision_b2b_pagos").map((p) => p.fecha), ["2026-09-02", DIA_BOGOTA]);
});

// ── Grupo 4 · movimientos ──────────────────────────────────────────────────
for (const [momento, instante] of MOMENTOS) {
  test(`movimiento nuevo a las ${momento}: propone y guarda ${DIA_BOGOTA}`, async () => {
    reloj(instante);
    const bd = usarBD();
    const m = await montar(h(MovimientosClient, { rows: [] }));
    desmontar = m.desmontar;
    await clic(botonConTexto(m.contenedor, "+ Agregar"), "+ Agregar");
    assert.equal(fecha(m.contenedor)?.value, DIA_BOGOTA, "fecha por defecto del movimiento");

    await escribir(m.contenedor.querySelector<HTMLInputElement>('input[placeholder="Arriendo, papelería, reintegro…"]')!, "Papelería");
    await escribir(numeroJunto(m.contenedor)!, "45000");
    await clic(botonConTexto(m.contenedor, "Guardar"), "Guardar");
    await esperar(() => bd.filas("contabilidad_movimientos").length > 0);
    assert.equal(bd.filas("contabilidad_movimientos")[0]?.fecha, DIA_BOGOTA, "contabilidad_movimientos.fecha");
  });
}

test("movimiento EXISTENTE a las 19:30: el editor conserva su fecha (no la reemplaza por hoy)", async () => {
  reloj(DESPUES_DEL_CORTE);
  usarBD();
  const fila = { id: 4, fecha: "2026-08-15", tipo: "egreso" as const, concepto: "Arriendo", tercero: "", categoria: "", medioPago: "", valor: 900_000, comprobante: "", observacion: "" };
  const m = await montar(h(MovimientosClient, { rows: [fila] }));
  desmontar = m.desmontar;
  await clic(m.contenedor.querySelector('button[title="Editar"]'), "Editar");
  assert.equal(fecha(m.contenedor)?.value, "2026-08-15");
});

test("movimientos: Server Action sin fecha → día de Bogotá; con fecha → tal cual", async () => {
  reloj(DESPUES_DEL_CORTE);
  const bd = usarBD();
  const base = { tipo: "egreso" as const, concepto: "Caja menor", tercero: "", categoria: "", medioPago: "", valor: 1000, comprobante: "", observacion: "" };
  await guardarMovimiento({ ...base, fecha: "" });
  await guardarMovimiento({ ...base, fecha: "2026-09-29" });
  assert.deepEqual(bd.filas("contabilidad_movimientos").map((f) => f.fecha), [DIA_BOGOTA, "2026-09-29"]);
});
