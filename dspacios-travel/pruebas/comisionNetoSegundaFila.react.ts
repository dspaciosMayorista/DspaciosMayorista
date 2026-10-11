// Se ejecuta con npm run test:react (loader del arnés).
//
// #38 · Contrato vendido NETO (decisión del dueño, 2026-10-09):
//   · comisión B2B del aliado: ya descontada del precio. No corresponde una
//     segunda comisión B2B ni abonos B2B nuevos — tampoco a una segunda fila
//     que ya exista.
//   · comisión del ASESOR INTERNO: independiente; sí aplica y cuenta para su
//     meta. No se toca.
//   · abonos B2B HISTÓRICOS: se conservan tal cual (sin borrar, recalcular ni
//     reinterpretar); la fila queda marcada para revisión manual.
// La barrera de la base (triggers de la 205) está en
// supabase/scripts/test_205_comisiones_b2b.sql (NN1–NN8).
import { usarBD, montar, type Fila } from "./support/fechaNegocioArnes.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { registrarPagoComisionB2B } = await import("../app/(dashboard)/dashboard/comisiones/actions.ts");
const { default: ComisionesPage } = await import("../app/(dashboard)/dashboard/comisiones/page.tsx");
const { ComisionesList } = await import("../app/(dashboard)/dashboard/comisiones/ComisionesList.tsx");
const { default: LiquidacionPage } = await import("../app/(dashboard)/dashboard/liquidacion/page.tsx");
const { formatCOP } = await import("../lib/utils.ts");
after(async () => { (await import("./support/fechaNegocioArnes.ts")).dom.window.close(); });

const MES = "2026-10";
const yo: Fila = { id: "u-arnes", nombre: "Admin", rol: "administracion", tenant: "mayorista", activo: true };
const asesor: Fila = { id: "u-asesor", nombre: "Asesor Interno", rol: "venta", tenant: "mayorista", activo: true, escala_id: 1, aplica_retencion: false };
const venta = (numero: string, extra: Fila = {}): Fila => ({
  numero_contrato: numero, tenant: "mayorista", cliente: `Cliente ${numero}`, destino: "SMR", fecha_venta: `${MES}-05`,
  estado: "confirmado", asesor_firma_nombre: "Asesor Interno", precio_venta: 1_000_000, impuesto: 200_000, moneda: "COP",
  canal: "B2B", tipo_asesor: "agencia", agencia_nombre: "Agencia Uno", freelance_nombre: null,
  modo_compra: "comisionable", comision_b2b: 80_000, comision_estado: "pendiente", ...extra,
});
const comision = (id: number, numero: string, extra: Fila = {}): Fila => ({
  id, numero_contrato: numero, tenant: "mayorista", aliado: "Agencia Uno", tipo_aliado: "agencia", aliado_id: 7,
  precio_venta: 1_000_000, base_comision: 800_000, base_explicita: true, comision_valor: null, pct_comision: 0.1,
  recobro_total: 0, pct_recobro_aliado: 0, aplica_retencion: false, pct_retencion: 0, estado: "pendiente",
  descontada_en_precio: false, ...extra,
});
const NETO = { modo_compra: "neta", precio_venta: 920_000, comision_b2b: 80_000, comision_estado: "descontada" };

function semilla(conFilasB2B: boolean) {
  return {
    usuarios: [yo, asesor],
    escala_rangos: [{ escala_id: 1, pvp_desde: 0, pvp_hasta: null, pct: 5 }],
    parametros_tributarios: [],
    liquidacion_descuentos: [],
    ventas: [venta("DTM-0480", NETO), venta("DTM-0481")],
    aliados_b2b: conFilasB2B
      ? [
          comision(81, "DTM-0480", { estado: "pagada", descontada_en_precio: true }), // la B2B descontada (NETO)
          comision(82, "DTM-0480", { pct_comision: 0.05 }),                        // segunda fila B2B, sin abonos
          comision(83, "DTM-0480", { pct_comision: 0.03 }),                        // segunda fila B2B HISTÓRICA con abonos
          comision(84, "DTM-0481"),                                                // contrato comisionable (control)
        ]
      : [],
    comision_b2b_pagos: conFilasB2B
      ? [
          { id: 1, aliado_b2b_id: 83, fecha: `${MES}-02`, valor: 10_000, tenant: "mayorista" },
          { id: 2, aliado_b2b_id: 83, fecha: `${MES}-03`, valor: 14_000, tenant: "mayorista" },
        ]
      : [],
  };
}

type FilaVista = { id: number; estado: string; totalPagar: number | null; pagos: unknown[]; enNeto?: boolean };
function filasDeComisiones(el: unknown): FilaVista[] {
  const buscar = (n: unknown): FilaVista[] | null => {
    if (!n || typeof n !== "object") return null;
    const props = (n as { props?: { rows?: FilaVista[]; children?: unknown } }).props;
    if (props?.rows) return props.rows;
    const hijos = props?.children;
    for (const h of Array.isArray(hijos) ? hijos : [hijos]) {
      const r = buscar(h);
      if (r) return r;
    }
    return null;
  };
  const r = buscar(el);
  assert.ok(r, "no se encontró <ComisionesList rows>");
  return r;
}

test("B2B: en un contrato NETO no se abona la segunda fila (ni la histórica con abonos), aunque se llame la acción directo", async () => {
  const bd = usarBD(semilla(true));
  for (const id of [82, 83, 81]) {
    const r = await registrarPagoComisionB2B(id, 5_000, `${MES}-09`);
    assert.equal(r.ok, false, `fila ${id}`);
    assert.match((r as { error: string }).error, /neta/);
  }
  assert.equal(bd.filas("comision_b2b_pagos").length, 2, "no entró ningún abono nuevo");
  // Control: en un contrato comisionable el abono B2B sigue entrando.
  assert.equal((await registrarPagoComisionB2B(84, 5_000, `${MES}-09`)).ok, true);
  assert.equal(bd.filas("comision_b2b_pagos").length, 3);
});

test("ABONOS HISTÓRICOS: la segunda fila B2B con abonos los conserva tal cual; queda en revisión manual, sin saldo por pagar", async () => {
  usarBD(semilla(true));
  const filas = filasDeComisiones(await ComisionesPage());
  const f = (id: number) => filas.find((x) => x.id === id)!;
  assert.equal(f(81).estado, "descontada");
  assert.equal(f(82).estado, "revision_neto");
  assert.equal(f(83).estado, "revision_neto");
  assert.equal(f(83).pagos.length, 2, "sus dos abonos se siguen mostrando");
  assert.equal(f(83).totalPagar, 24_000, "su total no se recalcula (800.000 × 3 %)");
  assert.equal(f(84).estado, "pendiente", "el contrato comisionable no cambia");

  // Totales: la fila en revisión no es saldo pendiente ni se ofrece para abonar.
  const m = await montar(React.createElement(ComisionesList, { rows: filas as never }));
  const texto = m.contenedor.textContent ?? "";
  await m.desmontar();
  assert.match(texto, /revisión manual/);
  assert.ok(texto.includes(formatCOP(80_000)), "pendiente por pagar = solo la del contrato comisionable");
  assert.ok(!texto.includes(formatCOP(80_000 + 40_000)), "no suma la segunda fila NETO como pendiente");
});

test("ASESOR INTERNO: el contrato NETO cuenta para su liquidación y su meta igual, con o sin filas/abonos B2B", async () => {
  const liquidacion = async (conFilasB2B: boolean) => {
    usarBD(semilla(conFilasB2B));
    const el = await LiquidacionPage({ searchParams: Promise.resolve({ mes: MES }) });
    const buscar = (n: unknown): { nombre: string; contratos: number; pvp: number; base: number; bruta: number }[] | null => {
      if (!n || typeof n !== "object") return null;
      const p = (n as { props?: { filas?: unknown; children?: unknown } }).props;
      if (p?.filas) return p.filas as never;
      const hijos = p?.children;
      for (const h of Array.isArray(hijos) ? hijos : [hijos]) { const r = buscar(h); if (r) return r; }
      return null;
    };
    const filas = buscar(el);
    assert.ok(filas, "no se encontró <LiquidacionTable filas>");
    return filas.find((x) => x.nombre === "Asesor Interno")!;
  };
  const sin = await liquidacion(false);
  const con = await liquidacion(true);
  assert.deepEqual(con, sin, "las filas y abonos B2B no alteran la comisión del asesor");
  assert.equal(con.contratos, 2, "el contrato NETO cuenta para su meta");
  assert.equal(con.pvp, 920_000 + 1_000_000);
  assert.equal(con.base, 720_000 + 800_000);
  assert.equal(con.bruta, Math.round(1_520_000 * 0.05));
});
