// Corrección del NETO vigente de #38 (entrega A de #30): precio PVP/NETO,
// comisión B2B (descontada o cobrable), documento del contrato, ediciones que
// no cambian la modalidad, estado de cuenta, facturación, rentabilidad y
// regresión de #38. La liquidación del asesor sobre el PVP original es de la
// entrega B (pruebas/liquidacionAsesorNeto.test.ts).
//
// Regla del dueño (2026-10-10): el comprador B2B elige PVP (paga el total; su
// comisión se liquida aparte) o NETO (paga PVP − su comisión, ya descontada).
// Contrato, estado de cuenta y facturación usan el TOTAL EXIGIBLE elegido.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { esVentaNetoDescontada, desgloseNetoB2B } from "@/lib/finanzas/netoB2B";
import { presentacionValoresContrato } from "@/lib/contrato/presentacionValores";
import { netoTotalExigibleDeContrato } from "@/lib/contrato/netoContrato.server";
import { planComisionReserva } from "@/lib/reservar/comisionReserva";
import { comisionParaRentabilidad, esComisionDescontada, type FilaComisionB2B } from "@/lib/finanzas/comisionB2B";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

// Venta de referencia: PVP 2.000.000, BNC (impuesto) 400.000, aliado al 10 %.
// base B2B = 1.600.000 → comisión 160.000 → NETO = 1.840.000.
const PVP = 2_000_000;
const BNC = 400_000;
const PCT = 0.1;

function ventaDesdePlan(modo: "neta" | "comisionable" | null) {
  const r = planComisionReserva({ modoCompra: modo, precioVenta: PVP, impuesto: BNC, pct: PCT });
  assert.ok(r.ok);
  return {
    precio_venta: r.plan.precioFinal,
    impuesto: BNC,
    comision_b2b: r.plan.comision,
    comision_estado: r.plan.comisionEstado,
    modo_compra: r.plan.modoCompra,
  };
}

// ── Precio PVP / NETO (regresión #38: el plan no cambia) ────────────────────

test("plan #38 sin cambios: PVP cobra el total, NETO descuenta la comisión sobre PVP − BNC", () => {
  const pvp = ventaDesdePlan("comisionable");
  assert.equal(pvp.precio_venta, PVP);
  assert.equal(pvp.comision_b2b, 160_000);
  assert.equal(pvp.comision_estado, "pendiente");

  const neto = ventaDesdePlan("neta");
  assert.equal(neto.precio_venta, 1_840_000);
  assert.equal(neto.comision_b2b, 160_000);
  assert.equal(neto.comision_estado, "descontada");

  const interno = ventaDesdePlan(null);
  assert.equal(interno.precio_venta, PVP);
  assert.equal(interno.comision_b2b, null);
  assert.equal(interno.comision_estado, null);
});

test("desglose NETO: PVP original = total exigible + descuento, sin perder un peso", () => {
  const d = desgloseNetoB2B(ventaDesdePlan("neta"));
  assert.deepEqual(d, { pvpOriginal: PVP, descuentoComision: 160_000, totalExigible: 1_840_000 });
  assert.equal(d!.pvpOriginal - d!.descuentoComision, d!.totalExigible);
});

test("desglose: solo NETO descontado; PVP con comisión pendiente y venta directa no tienen desglose", () => {
  assert.equal(desgloseNetoB2B(ventaDesdePlan("comisionable")), null);
  assert.equal(desgloseNetoB2B(ventaDesdePlan(null)), null);
  assert.equal(desgloseNetoB2B(null), null);
  assert.equal(esVentaNetoDescontada({ comision_estado: "pendiente" }), false);
  assert.equal(esVentaNetoDescontada({ comision_estado: "descontada" }), true);
});

test("desglose tolera numéricos como texto (PostgREST numeric) y comisión nula", () => {
  assert.deepEqual(
    desgloseNetoB2B({ precio_venta: "1840000", comision_b2b: "160000", comision_estado: "descontada" }),
    { pvpOriginal: 2_000_000, descuentoComision: 160_000, totalExigible: 1_840_000 },
  );
  assert.deepEqual(
    desgloseNetoB2B({ precio_venta: 1_840_000, comision_b2b: null, comision_estado: "descontada" }),
    { pvpOriginal: 1_840_000, descuentoComision: 0, totalExigible: 1_840_000 },
  );
});

test("una venta directa con descuento comercial sigue siendo PVP, nunca NETO B2B", () => {
  // Precio rebajado a mano en una venta interna: sin comision_estado no hay NETO.
  const directa = { precio_venta: 1_700_000, impuesto: BNC, comision_b2b: null, comision_estado: null };
  assert.equal(esVentaNetoDescontada(directa), false);
  assert.equal(desgloseNetoB2B(directa), null);
  assert.equal(presentacionValoresContrato({ totalItems: 1_700_000, totalPagado: 0, netoTotalExigible: null }).mostrarValoresItems, true);
});

// ── Documento del contrato: un NETO nunca muestra ni cobra el PVP ───────────

test("documento: un contrato que no es NETO conserva total y saldo por suma de ítems", () => {
  assert.deepEqual(
    presentacionValoresContrato({ totalItems: 2_000_000, totalPagado: 500_000, netoTotalExigible: null }),
    { total: 2_000_000, saldo: 1_500_000, mostrarValoresItems: true },
  );
  assert.deepEqual(
    presentacionValoresContrato({ totalItems: 2_000_000, totalPagado: 500_000 }),
    { total: 2_000_000, saldo: 1_500_000, mostrarValoresItems: true },
  );
});

test("documento NETO: total y saldo del total exigible, valores por ítem ocultos", () => {
  const p = presentacionValoresContrato({ totalItems: PVP, totalPagado: 840_000, netoTotalExigible: 1_840_000 });
  assert.deepEqual(p, { total: 1_840_000, saldo: 1_000_000, mostrarValoresItems: false });
  assert.notEqual(p.total, PVP);
  // Pagado el total exigible, el saldo es 0 (antes quedaban 160.000 "por pagar").
  assert.equal(presentacionValoresContrato({ totalItems: PVP, totalPagado: 1_840_000, netoTotalExigible: 1_840_000 }).saldo, 0);
  // Pagado de más nunca da saldo negativo.
  assert.equal(presentacionValoresContrato({ totalItems: PVP, totalPagado: 1_900_000, netoTotalExigible: 1_840_000 }).saldo, 0);
  // Un NETO en 0 sigue siendo NETO (no cae a la suma de ítems).
  assert.equal(presentacionValoresContrato({ totalItems: PVP, totalPagado: 0, netoTotalExigible: 0 }).total, 0);
});

function clienteFalso(respuesta: { data: unknown; error: unknown }) {
  const llamadas: { tabla: string; columnas: string; filtro: [string, unknown] | null }[] = [];
  const cliente = {
    from(tabla: string) {
      const reg = { tabla, columnas: "", filtro: null as [string, unknown] | null };
      llamadas.push(reg);
      const q = {
        select(c: string) { reg.columnas = c; return q; },
        eq(col: string, val: unknown) { reg.filtro = [col, val]; return q; },
        maybeSingle: async () => respuesta,
      };
      return q;
    },
  };
  return { cliente: cliente as unknown as Parameters<typeof netoTotalExigibleDeContrato>[1], llamadas };
}

test("modalidad del contrato: devuelve solo el total exigible de un NETO y nunca la comisión", async () => {
  const { cliente, llamadas } = clienteFalso({ data: { precio_venta: "1840000", comision_estado: "descontada" }, error: null });
  assert.equal(await netoTotalExigibleDeContrato("DTM-0900", cliente), 1_840_000);
  assert.deepEqual(llamadas, [{ tabla: "ventas", columnas: "precio_venta, comision_estado", filtro: ["numero_contrato", "DTM-0900"] }]);
  assert.doesNotMatch(llamadas[0].columnas, /comision_b2b|impuesto|costo/);
});

test("modalidad del contrato: PVP o contrato inexistente → null (documento de siempre)", async () => {
  assert.equal(await netoTotalExigibleDeContrato("DTM-1", clienteFalso({ data: { precio_venta: 2_000_000, comision_estado: "pendiente" }, error: null }).cliente), null);
  assert.equal(await netoTotalExigibleDeContrato("DTM-2", clienteFalso({ data: { precio_venta: 2_000_000, comision_estado: null }, error: null }).cliente), null);
  assert.equal(await netoTotalExigibleDeContrato("DTM-3", clienteFalso({ data: null, error: null }).cliente), null);
});

test("modalidad del contrato: si la lectura falla, no adivina (no vuelve a imprimir el PVP)", async () => {
  await assert.rejects(
    netoTotalExigibleDeContrato("DTM-4", clienteFalso({ data: null, error: { message: "timeout" } }).cliente),
    /No se pudo determinar la modalidad del contrato DTM-4/,
  );
});

test("documento: ContratoDocumento calcula total/saldo NETO y prorratea los importes visibles", () => {
  const src = leer("components/contrato/ContratoDocumento.tsx");
  assert.match(src, /presentacionValoresContrato\(\{\s*totalItems: totalVisibleContratoItems\(items\),\s*totalPagado,\s*netoTotalExigible,\s*\}\)/);
  assert.doesNotMatch(src, /const total = totalVisibleContratoItems\(items\);/, "volvió a sumar los ítems a PVP como total");
  assert.match(src, /valoresNetosDocumento\(items, total\)/);
  assert.match(src, /const mostrarDesglose = mostrarValoresItems \|\| valoresNetos !== null/);
  assert.doesNotMatch(src, /Valor total acordado para el paquete/);
});

test("documento interno: la modalidad se consulta DESPUÉS de autorizar el contrato y viaja al documento", () => {
  const src = leer("app/contrato/[numero]/page.tsx");
  const iNotFound = src.indexOf("if (!venta) notFound();");
  const iNeto = src.indexOf("netoTotalExigibleDeContrato(numero)");
  assert.ok(iNotFound > 0 && iNeto > iNotFound, "la consulta service-role va después de la autorización por RLS");
  assert.match(src, /netoTotalExigible=\{netoTotalExigible\}/);
});

test("documento por enlace compartido: usa el total exigible de la fila que ya leyó", () => {
  const src = leer("app/c/[token]/page.tsx");
  assert.match(src, /netoTotalExigible=\{desgloseNetoB2B\(venta\)\?\.totalExigible \?\? null\}/);
});

test("documentos de cotización: solo reciben el total exigible NETO de una venta B2B asistida (#102), nunca el de un contrato ni la comisión", () => {
  // Antes de #102 una cotización nunca era NETO y estos documentos no recibían `netoTotalExigible`. Ahora una cotización B2B asistida en NETO
  // lo recibe, y únicamente a través del dato externo-seguro `detalle.b2bExterno` (derivado del plan congelado al cotizar).
  for (const rel of ["app/cot/[token]/page.tsx", "app/cotizacion/[id]/page.tsx"]) {
    const src = leer(rel);
    assert.match(src, /netoTotalExigible=\{netoTotalExigible\}/, rel);
    assert.match(src, /const netoTotalExigible = netoTotalExigibleDeDetalle\(d\.b2bExterno\);/, rel);
    // No usan ninguna fuente de contrato ni de comisión: el PVP original y la comisión del aliado no pueden llegar al documento.
    assert.doesNotMatch(src, /netoTotalExigibleDeContrato|desgloseNetoB2B|esVentaNetoDescontada|comision_b2b|leerPlanB2BDePayload|b2bAsistido/, rel);
  }
  // El enlace público no lee `payload` (datos personales y términos internos): su consulta no cambió.
  assert.match(leer("app/cot/[token]/page.tsx"), /\.select\("codigo, detalle, vigencia_hasta(, tenant)?"\)/);
});

// ── Ediciones posteriores: la modalidad no cambia sola ──────────────────────

test("igualar precio a la suma de ítems está bloqueado en NETO (borraría el descuento)", () => {
  const src = leer("app/(dashboard)/dashboard/contratos/[numero]/contenido-actions.ts");
  const ini = src.indexOf("export async function sincronizarPrecioVenta");
  const cuerpo = src.slice(ini);
  const iGuarda = cuerpo.indexOf("esVentaNetoDescontada(venta)");
  const iUpdate = cuerpo.indexOf('.update({ precio_venta: total');
  assert.ok(iGuarda > 0 && iUpdate > iGuarda, "la guarda NETO va antes de reescribir precio_venta");
  assert.match(cuerpo, /if \(ventaError\) return \{ ok: false, error: ventaError\.message \};/);
});

test("editar la cabecera no cambia el tipo de venta de un contrato NETO", () => {
  const src = leer("app/(dashboard)/dashboard/contratos/actions.ts");
  const ini = src.indexOf("export async function actualizarVenta");
  const cuerpo = src.slice(ini, src.indexOf("async function recalcularEstadoAbono"));
  const iGuarda = cuerpo.indexOf("netoTotalExigibleDeContrato(numero)");
  const iUpdate = cuerpo.indexOf('.from("ventas")\n    .update(') >= 0 ? cuerpo.indexOf('.from("ventas")\n    .update(') : cuerpo.indexOf('.from("ventas")\r\n    .update(');
  assert.ok(iGuarda > 0 && iUpdate > iGuarda, "la guarda va antes del update");
  assert.match(cuerpo, /\.from\("ventas_basica"\)\s*\.select\("tipo_asesor"\)/);
  assert.match(cuerpo, /Contrato vendido en NETO: el tipo de venta/);
});

// ── NETO sin doble pago de comisión (regresión #38) ────────────────────────

const fila = (extra: Partial<FilaComisionB2B> = {}): FilaComisionB2B => ({
  id: 1, numero_contrato: "DTM-0900", precio_venta: PVP, base_comision: PVP - BNC, base_explicita: true,
  comision_valor: null, pct_comision: PCT, recobro_total: 0, pct_recobro_aliado: 0,
  aplica_retencion: false, pct_retencion: 0, estado: "pagada", descontada_en_precio: true, ...extra,
});

test("NETO: la comisión descontada no vuelve a restarse en rentabilidad ni se cobra", () => {
  assert.equal(esComisionDescontada(fila(), "descontada"), true);
  assert.equal(comisionParaRentabilidad(fila(), "descontada"), 0);
  // PVP comisionable: la comisión sí es costo (se paga aparte).
  const cobrable = fila({ estado: "pendiente", descontada_en_precio: false });
  assert.equal(comisionParaRentabilidad(cobrable, "pendiente"), 160_000);
});

test("rentabilidad NETO = PVP con comisión aparte: el margen no depende de la modalidad", () => {
  const costo = 1_200_000;
  const neto = ventaDesdePlan("neta");
  const utilNeto = neto.precio_venta - costo - comisionParaRentabilidad(fila(), neto.comision_estado);
  const pvp = ventaDesdePlan("comisionable");
  const utilPvp = pvp.precio_venta - costo - comisionParaRentabilidad(fila({ estado: "pendiente", descontada_en_precio: false }), pvp.comision_estado);
  assert.equal(utilNeto, utilPvp);
});

// ── Estado de cuenta y facturación: total exigible, sin la comisión ─────────

test("estado de cuenta: valor y saldo salen de precio_venta (total exigible) y no lee la comisión", () => {
  const src = leer("lib/cuenta/estado.ts");
  // 235: el total es el de COBRO (`cobroDeVenta`): sin conversión es exactamente precio_venta (el total exigible, NETO incluido).
  assert.match(src, /const cobro = cobroDeVenta\(v\);\s+const precio = cobro\.total;/);
  assert.match(src, /saldo: Math\.max\(precio - acum, 0\)/);
  const select = src.match(/\.from\("ventas"\)\s*\.select\("([^"]+)"\)/);
  assert.ok(select, "lee ventas");
  assert.doesNotMatch(select![1], /comision|modo_compra|impuesto/, "el documento externo no necesita la comisión");
});

test("facturación: la base es precio_venta (total exigible), nunca PVP + comisión", () => {
  const src = leer("app/(dashboard)/dashboard/contabilidad/facturacion/page.tsx");
  assert.match(src, /precio_venta: \(Number\(v\.precio_venta\) \|\| 0\) \* factor/);
  assert.doesNotMatch(src, /comision_b2b/);
});

// ── Ficha del contrato: la UI no ofrece editar importes de un NETO ──────────

test("ficha: en NETO el precio y el tipo de venta son de solo lectura y no se ofrece editar servicios", () => {
  const form = leer("app/(dashboard)/dashboard/contratos/[numero]/EditarVentaForm.tsx");
  assert.match(form, /onChange=\{set\("precioVenta"\)\} disabled=\{modalidadNeto\}/);
  assert.match(form, /onChange=\{set\("tipoAsesor"\)\} className=\{selCls\} disabled=\{modalidadNeto\}/);
  const page = leer("app/(dashboard)/dashboard/contratos/[numero]/page.tsx");
  assert.match(page, /modalidadNeto=\{esVentaNetoDescontada\(fin\)\}/);
  assert.match(page, /venta\.estado === "pendiente" && puedeEditar && !esNeto && \(\s*<ServiciosContratoEditor/);
  // Sin acceso financiero la modalidad sale de la frontera service-role, y
  // solo después de que la RLS autorizó el contrato (la consulta de la ficha).
  assert.ok(page.indexOf("netoTotalExigibleDeContrato(numero)") > page.indexOf("const fin = verFinanzas"));
});
