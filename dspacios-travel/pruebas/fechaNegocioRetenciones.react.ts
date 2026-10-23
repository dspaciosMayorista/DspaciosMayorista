// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom).
//
// GRUPO 2 · Retenciones a proveedores — reloj fijo antes y después de las
// 7 p. m. de Bogotá del 30-sep (último día del mes, así que también se prueba
// el MES de declaración a la DIAN). Flujo REAL: `RetencionesClient` (buscar
// contrato → calculadora → Registrar), las Server Actions de retenciones y el
// asiento de `lib/contabilidad/asientos.ts`, contra la BD en memoria del arnés.
import { DIA_BOGOTA, DESPUES_DEL_CORTE, MOMENTOS, asientos, botonConTexto, clic, escribir, esperar, montar, reloj, soltarReloj, usarBD } from "./support/fechaNegocioArnes.ts";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { RetencionesClient } = await import("../app/(dashboard)/dashboard/contabilidad/retenciones/RetencionesClient.tsx");
const { registrarRetencion } = await import("../app/(dashboard)/dashboard/contabilidad/retenciones/actions.ts");
const h = React.createElement;

const semilla = () => ({
  cuentas_por_pagar: [{
    id: 9, numero_contrato: "DTM-0451", tenant: "mayorista", proveedor: "Hotel Sol", tipo_proveedor: "hotel",
    servicio: "Hotel Sol", valor_total: 1_000_000, moneda: "COP", aplica_retencion: true, pct_retencion: 0.035,
  }],
});

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.();
  desmontar = undefined;
  soltarReloj();
});
after(async () => { (await import("./support/fechaNegocioArnes.ts")).dom.window.close(); });

const campo = (raiz: Element, etiqueta: string) => raiz.querySelector<HTMLInputElement>(`input[aria-label="${etiqueta}"]`);

for (const [momento, instante] of MOMENTOS) {
  test(`a las ${momento} del 30-sep: práctica ${DIA_BOGOTA}, mes 2026-09, y el asiento con la misma fecha`, async () => {
    reloj(instante);
    const bd = usarBD(semilla());
    const m = await montar(h(RetencionesClient, { contratos: ["DTM-0451"] }));
    desmontar = m.desmontar;

    await escribir(m.contenedor.querySelector<HTMLInputElement>('input[placeholder="ej. 00-0451"]')!, "DTM-0451");
    await clic(botonConTexto(m.contenedor, /Buscar/), "Buscar");
    await esperar(() => campo(m.contenedor, "Fecha en que se practicó") != null);

    assert.equal(campo(m.contenedor, "Fecha en que se practicó")?.value, DIA_BOGOTA, "fecha de práctica por defecto");
    assert.equal(campo(m.contenedor, "Mes a declarar (DIAN)")?.value, "2026-09", "mes de declaración por defecto");

    await clic(botonConTexto(m.contenedor, "Registrar"), "Registrar");
    await esperar(() => bd.filas("retenciones_cxp").length > 0);
    const [ret] = bd.filas("retenciones_cxp");
    assert.equal(ret?.fecha_practica, DIA_BOGOTA, "retenciones_cxp.fecha_practica");
    assert.equal(ret?.mes_declaracion, "2026-09", "retenciones_cxp.mes_declaracion");
    assert.equal(asientos(bd, "retencion")[0]?.fecha, DIA_BOGOTA, "asiento de la retención");
  });
}

test("fechas elegidas a mano a las 19:30 Bogotá: se guardan tal cual (práctica y mes)", async () => {
  reloj(DESPUES_DEL_CORTE);
  const bd = usarBD(semilla());
  const r = await registrarRetencion({ cuentaId: 9, valor: 35_000, baseGravable: 1_000_000, fechaPractica: "2026-10-01", mesDeclaracion: "2026-10" });
  assert.deepEqual(r, { ok: true });
  assert.equal(bd.filas("retenciones_cxp")[0].fecha_practica, "2026-10-01");
  assert.equal(bd.filas("retenciones_cxp")[0].mes_declaracion, "2026-10");
  assert.equal(asientos(bd, "retencion")[0].fecha, "2026-10-01");
});
