// Se ejecuta con npm run test:react (loader del arnés).
//
// GRUPO 5 · Fecha de emisión ante la DIAN (`marcarDian`) y GRUPO 6 · Cuentas
// por pagar fuera de los archivos compartidos: alta/edición manual de CxP en el
// contrato (gestion-actions), CxP completadas automáticamente
// (asegurarCuentasPorPagar) y asientos de CxP reintentados por la
// reconciliación financiera (reconciliacion-actions). Reloj fijo antes y
// después de las 7 p. m. de Bogotá; Server Actions y asientos REALES contra la
// BD en memoria del arnés.
//
// Fuera de alcance aquí (archivos compartidos con otras sesiones, pendientes):
// reservar/actions.ts y contratos/actions.ts.
import { DIA_BOGOTA, DESPUES_DEL_CORTE, MOMENTOS, asientos, reloj, soltarReloj, usarBD } from "./support/fechaNegocioArnes.ts";
import { fechaNegocio } from "../lib/fechaNegocio.ts";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";
process.env.CRON_SECRET = "secreto-de-prueba";

const { marcarDian } = await import("../app/(dashboard)/dashboard/contabilidad/facturacion/actions.ts");
const { crearCuentaPorPagar, actualizarCuentaPorPagar } = await import("../app/(dashboard)/dashboard/contratos/[numero]/gestion-actions.ts");
const { asegurarCuentasPorPagar } = await import("../lib/reservar/asegurarCuentasPorPagar.ts");
const { reconciliarFinancieroPendienteCron } = await import("../app/(dashboard)/dashboard/reservar/reconciliacion-actions.ts");

afterEach(() => soltarReloj());

const VENTA = {
  numero_contrato: "DTM-0451", tenant: "mayorista", moneda: "COP", hotel: "Hotel Sol", aerolinea: "Avianca",
  plazo: "2026-10-15", fecha_salida: "2026-11-01",
  costo_hotel: 1_000_000, costo_aereo: 800_000, costo_receptivo: 0, costo_asistencia: 0, otros_costos: 0,
};

// Usuario del arnés (u-arnes) con rol contable: el que marca la emisión DIAN.
const CONTABLE = { id: "u-arnes", nombre: "Contabilidad", rol: "administracion", activo: true, tenant: "mayorista" };
const FACTURA_VIGENTE = { tenant: "mayorista", origen: "facturacion", referencia: "facturacion:DTM-0451", fecha: "2026-09-01" };

// 208: marcar DIAN es la RPC `marcar_dian_factura`. Este manejador reproduce SU
// contrato (migración 208): agencia del contrato (F4402), factura vigente (F4435),
// marca definitiva (F4434), dian_fecha = día de negocio y updated_at = instante.
// El SQL real (incluida fecha_negocio()) se prueba en Postgres: test_208_facturacion.sql.
function rpcDian(bdRef: { bd?: ReturnType<typeof usarBD> }) {
  const err = (code: string, message: string) => ({ __error: { code, message } });
  return {
    marcar_dian_factura: (a: Record<string, unknown>) => {
      const bd = bdRef.bd!;
      const v = bd.filas("ventas").find((x) => x.numero_contrato === a.p_numero);
      if (!v) return err("F4404", "FIN_CONTRATO_INEXISTENTE: el contrato no existe.");
      if (v.tenant !== a.p_tenant) return err("F4402", `FIN_OTRA_AGENCIA: el contrato es de la agencia ${String(v.tenant)}.`);
      const cfg = bd.filas("contrato_facturacion").find((x) => x.numero_contrato === a.p_numero);
      if (!a.p_emitida) {
        if (cfg?.dian_emitida) return err("F4434", "FIN_DIAN_INMUTABLE: la marca no se deshace.");
        return { estado: "sin_cambios" };
      }
      const vigente = bd.filas("asientos_contables").filter((x) => x.referencia === `facturacion:${String(a.p_numero)}`);
      const f = vigente.filter((x) => x.origen === "facturacion").length, r = vigente.filter((x) => x.origen === "facturacion_reversion").length;
      if (!cfg || f <= r) return err("F4435", "FIN_DIAN_SIN_FACTURA: no tiene factura vigente.");
      if (cfg.dian_emitida) return { estado: "sin_cambios" };
      Object.assign(cfg, { dian_emitida: true, dian_fecha: fechaNegocio(), updated_at: new Date().toISOString() });
      return { estado: "marcada" };
    },
  };
}
const conFactura = (extra: Record<string, unknown[]> = {}) => {
  const ref: { bd?: ReturnType<typeof usarBD> } = {};
  ref.bd = usarBD(
    { ventas: [{ ...VENTA }], usuarios: [CONTABLE], asientos_contables: [{ ...FACTURA_VIGENTE }],
      contrato_facturacion: [{ numero_contrato: "DTM-0451", irt: 0, ingreso_propio: 1_800_000, dian_emitida: false, dian_fecha: null }], ...extra } as never,
    rpcDian(ref),
  );
  return ref.bd;
};

for (const [momento, instante] of MOMENTOS) {
  test(`DIAN a las ${momento}: dian_fecha = ${DIA_BOGOTA}; updated_at sigue siendo el instante UTC; la marca no se deshace`, async () => {
    reloj(instante);
    const bd = conFactura();
    assert.deepEqual(await marcarDian("DTM-0451", true), { ok: true });
    const [f] = bd.filas("contrato_facturacion");
    assert.equal(f.dian_fecha, DIA_BOGOTA, "fecha de emisión ante la DIAN");
    assert.equal(f.updated_at, instante, "timestamp sin truncar ni convertir");
    // 208: la marca DIAN es definitiva; el rechazo llega a la pantalla con su código.
    const d = await marcarDian("DTM-0451", false);
    assert.equal(d.ok, false);
    assert.equal((d as { code?: string }).code, "F4434");
    assert.match((d as { error: string }).error, /la marca no se deshace/);
    assert.equal(bd.filas("contrato_facturacion")[0].dian_fecha, DIA_BOGOTA, "la fecha de emisión sigue intacta");
  });

  test(`DIAN a las ${momento}: sin factura vigente se rechaza (F4435) y no crea configuración; otra agencia (F4402)`, async () => {
    reloj(instante);
    const ref: { bd?: ReturnType<typeof usarBD> } = {};
    ref.bd = usarBD({ ventas: [{ ...VENTA }], usuarios: [CONTABLE] }, rpcDian(ref));
    const r = await marcarDian("DTM-0451", true);
    assert.equal(r.ok, false);
    assert.equal((r as { code?: string }).code, "F4435");
    assert.equal(ref.bd.filas("contrato_facturacion").length, 0, "no se creó configuración");
    // Contrato de otra agencia: la acción lo rechaza antes de llamar la RPC (tenant activo = mayorista).
    const b2 = usarBD({ ventas: [{ ...VENTA, tenant: "minorista" }], usuarios: [CONTABLE] }, rpcDian({}));
    const o = await marcarDian("DTM-0451", true);
    assert.equal(o.ok, false);
    assert.match((o as { error: string }).error, /es de la agencia minorista; cambia a esa agencia/);
    assert.equal(b2.llamadasRpc.length, 0, "ni siquiera se llamó la RPC");
  });

  test(`CxP manual del contrato a las ${momento}: el asiento al crear y al editar lleva ${DIA_BOGOTA}`, async () => {
    reloj(instante);
    const bd = usarBD({ ventas: [{ ...VENTA }] });
    await crearCuentaPorPagar({
      numeroContrato: "DTM-0451", proveedor: "Hotel Sol", tipoProveedor: "hotel", servicio: "Hotel Sol",
      valorTotal: 1_000_000, fechaVencimiento: "2026-10-20", aplicaRetencion: false, pctRetencion: 0,
    });
    const [cxp] = bd.filas("cuentas_por_pagar");
    assert.equal(cxp.fecha_vencimiento, "2026-10-20", "la fecha de vencimiento elegida no se toca");
    assert.equal(asientos(bd, "cxp")[0]?.fecha, DIA_BOGOTA, "asiento al crear");

    await actualizarCuentaPorPagar({
      id: Number(cxp.id), numeroContrato: "DTM-0451", proveedor: "Hotel Sol", servicio: "Hotel Sol",
      valorTotal: 1_100_000, fechaVencimiento: "2026-10-21",
    });
    const cx = asientos(bd, "cxp");
    assert.equal(cx.length, 1, "la edición reemplaza el asiento, no lo duplica");
    assert.equal(cx[0].fecha, DIA_BOGOTA, "asiento al editar");
  });

  test(`CxP completadas automáticamente a las ${momento}: fecha_obligacion y asientos con ${DIA_BOGOTA}`, async () => {
    reloj(instante);
    const bd = usarBD({
      ventas: [{ ...VENTA }],
      contrato_hoteles: [{ numero_contrato: "DTM-0451", nombre: "Hotel Sol", proveedor: "Operador Sol", orden: 0 }],
      contrato_vuelos: [{ numero_contrato: "DTM-0451", aerolinea: "Avianca", orden: 0 }],
    });
    const r = await asegurarCuentasPorPagar("DTM-0451");
    assert.equal(r.creadas, 2, "hotel + aéreo");
    for (const c of bd.filas("cuentas_por_pagar")) {
      assert.equal(c.fecha_obligacion, DIA_BOGOTA, `fecha_obligacion de ${c.tipo_proveedor}`);
      assert.equal(c.fecha_vencimiento, "2026-10-15", "el vencimiento sigue saliendo del plazo del contrato");
    }
    assert.deepEqual(asientos(bd, "cxp").map((a) => a.fecha), [DIA_BOGOTA, DIA_BOGOTA]);
  });

  test(`reconciliación (cron) a las ${momento}: el asiento de una CxP que no lo tenía lleva ${DIA_BOGOTA}`, async () => {
    reloj(instante);
    const bd = usarBD({
      cuentas_por_pagar: [{ id: 77, numero_contrato: "DTM-0451", tenant: "mayorista", tipo_proveedor: "hotel", proveedor: "Hotel Sol", servicio: "Hotel Sol", valor_total: 500_000, fecha_obligacion: "2026-09-01" }],
    });
    const r = await reconciliarFinancieroPendienteCron("secreto-de-prueba");
    assert.equal(r.ok, true);
    const [a] = asientos(bd, "cxp");
    assert.equal(a?.referencia, "cxp:77");
    assert.equal(a?.fecha, DIA_BOGOTA, "asiento reintentado");
  });
}

test("después del corte, una CxP con vencimiento elegido a mano conserva esa fecha", async () => {
  reloj(DESPUES_DEL_CORTE);
  const bd = usarBD({ ventas: [{ ...VENTA }] });
  await crearCuentaPorPagar({
    numeroContrato: "DTM-0451", proveedor: "Avianca", tipoProveedor: "aereo", servicio: "Aéreo",
    valorTotal: 800_000, fechaVencimiento: "2026-10-01", aplicaRetencion: false, pctRetencion: 0,
  });
  assert.equal(bd.filas("cuentas_por_pagar")[0].fecha_vencimiento, "2026-10-01");
});
