// Se ejecuta con npm run test:react (loader del arnés + jsdom).
//
// GRUPO 8 · Fechas de emisión — reloj fijo antes y después de las 7 p. m. de
// Bogotá:
//   · `NuevoContratoForm`: la "Fecha de emisión" por defecto. Antes se calculaba
//     UNA vez al cargar el módulo (`const hoy` a nivel de archivo): además de la
//     zona UTC, una pestaña abierta desde ayer seguía proponiendo ayer.
//   · Vouchers (hotel y servicios): `contenido.emision`, que sale impreso.
import { DIA_BOGOTA, DESPUES_DEL_CORTE, MOMENTOS, montar, reloj, soltarReloj, usarBD } from "./support/fechaNegocioArnes.ts";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { NuevoContratoForm } = await import("../app/(dashboard)/dashboard/contratos/NuevoContratoForm.tsx");
const { generarVoucherHotel, generarVouchersServicios } = await import("../app/(dashboard)/dashboard/contratos/[numero]/voucher-actions.ts");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.();
  desmontar = undefined;
  soltarReloj();
});
after(async () => { (await import("./support/fechaNegocioArnes.ts")).dom.window.close(); });

const fechaEmision = (raiz: Element) => raiz.querySelector<HTMLInputElement>('input[aria-label="Fecha de emisión"]');

for (const [momento, instante] of MOMENTOS) {
  test(`contrato manual montado a las ${momento}: fecha de emisión por defecto ${DIA_BOGOTA}`, async () => {
    reloj(instante);
    usarBD();
    const m = await montar(h(NuevoContratoForm, { asesorDefault: "Asesor" }));
    desmontar = m.desmontar;
    assert.equal(fechaEmision(m.contenedor)?.value, DIA_BOGOTA);
  });
}

test("contrato manual: la fecha se calcula al montar el formulario, no al cargar el módulo", async () => {
  // El módulo ya se cargó arriba (con el reloj real). Montarlo el 5-oct debe proponer 5-oct.
  reloj("2026-10-05T15:00:00.000Z"); // 10:00 Bogotá
  usarBD();
  const m = await montar(h(NuevoContratoForm, { asesorDefault: "Asesor" }));
  desmontar = m.desmontar;
  assert.equal(fechaEmision(m.contenedor)?.value, "2026-10-05");
});

const VENTA = {
  numero_contrato: "DTM-0451", paquete_armado_id: 7, precio_venta: 100, fecha_salida: "2026-11-01", fecha_regreso: "2026-11-04",
  tipo_asesor: "interno", asesor: "Asesor", destino: "SAN ANDRES", cliente: "Cliente", pax: 2, hotel: "Hotel Sol", plan_nombre: null,
};
const semillaVoucher = () => ({
  ventas: [{ ...VENTA }],
  usuarios: [{ id: "u-arnes", rol: "superadmin" }],
  contrato_hoteles: [{ numero_contrato: "DTM-0451", orden: 0, nombre: "Hotel Sol", proveedor: "Operador Sol", fecha_ingreso: "2026-11-01", fecha_salida: "2026-11-04", alimentacion: null, acomodacion: "Doble" }],
  armado_servicios: [{ paquete_id: 7, incluido: true, servicios_adicionales: { nombre: "Traslado", categoria: "traslado", proveedores: { id: 1, nombre: "Operador Uno" } } }],
});

for (const [momento, instante] of MOMENTOS) {
  test(`vouchers generados a las ${momento}: emisión ${DIA_BOGOTA} en hotel y servicios`, async () => {
    reloj(instante);
    const bd = usarBD(semillaVoucher());
    assert.equal((await generarVoucherHotel("DTM-0451")).ok, true);
    assert.equal((await generarVouchersServicios("DTM-0451")).ok, true);
    const vouchers = bd.filas("vouchers");
    assert.deepEqual(vouchers.map((v) => v.tipo).sort(), ["hotel", "traslado"]);
    for (const v of vouchers) {
      assert.equal((v.contenido as { emision: string }).emision, DIA_BOGOTA, `emisión del voucher ${v.tipo}`);
    }
  });
}

test("voucher regenerado después del corte conserva fechas de viaje (solo la emisión es 'hoy')", async () => {
  reloj(DESPUES_DEL_CORTE);
  const bd = usarBD(semillaVoucher());
  await generarVoucherHotel("DTM-0451");
  const c = bd.filas("vouchers")[0].contenido as { emision: string; fechaIngreso: string };
  assert.equal(c.emision, DIA_BOGOTA);
  assert.match(c.fechaIngreso, /1 de noviembre de 2026/);
});
