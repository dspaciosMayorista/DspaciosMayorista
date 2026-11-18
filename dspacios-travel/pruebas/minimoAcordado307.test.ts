import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolverCondicionesContrato } from "../lib/contrato/condicionesContrato.ts";
import { interpretarLecturaAcuerdo, reglaConfirmacion, type AcuerdoMinimo } from "../lib/contrato/reglaConfirmacion.ts";

// #53 (307) · regresiones de la revisión de Codex F3, F4 y F5 sobre lo que PRESENTAN el documento y la ficha, y sobre la lectura del acuerdo.
// (F1 y F2 —identidad, clasificación y reuso— son de base de datos: supabase/scripts/test_307_minimo_vencimiento_voucher.sh.)
function leer(rel: string): string { return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n"); }

const fila = (monto: number, moneda = "COP", trm: number | null = 1) => ({
  id: 1, tipo_componente: "hotel", referencia_externa: null, orden: 0, valor_componente: monto, condicion_pago_tipo: "normal", condicion_pago_pct_aplicable: null,
  condicion_pago_dias_saldo: null, condicion_pago_fecha_limite: null, monto_exigido: monto, restriccion_comercial: "normal", moneda, trm,
});

describe("F3 · la moneda de COBRO del acuerdo no se mezcla con la moneda CONGELADA de la condición", () => {
  // Condición congelada del hotel: USD 300 a TRM 4.000. El contrato se COBRA en COP: total 4.000.000.
  const rows = [fila(300, "USD", 4000)] as never;
  const ctx = (acuerdo: AcuerdoMinimo | null) => ({ monedaContrato: "COP", precioVenta: 4_000_000, acuerdo });
  test("porcentaje 30 %: 1.200.000 COP (antes salía «1.200.000 USD»)", () => {
    const r = resolverCondicionesContrato(rows, [], ctx({ tipo: "porcentaje", porcentaje: 0.3 }));
    assert.deepEqual({ ...r.resumen!.minimoConfirmar }, { regla: "acuerdo", minimo: 1_200_000, moneda: "COP", trm: null });
    assert.match(r.resumen!.texto, /\$1\.200\.000 COP \(mínimo acordado\)/);
    assert.doesNotMatch(r.resumen!.texto, /USD/);
  });
  test("importe 1.200.000 COP: es ese importe en COP, no «el total en USD»", () => {
    const r = resolverCondicionesContrato(rows, [], ctx({ tipo: "importe", importe: 1_200_000, moneda: "COP" }));
    assert.deepEqual({ ...r.resumen!.minimoConfirmar }, { regla: "acuerdo", minimo: 1_200_000, moneda: "COP", trm: null });
  });
  test("importe expresado en OTRA moneda que la de cobro: se exige el total de cobro (falla cerrado, igual que la base), en COP", () => {
    const r = resolverCondicionesContrato(rows, [], ctx({ tipo: "importe", importe: 300, moneda: "USD" }));
    assert.deepEqual({ ...r.resumen!.minimoConfirmar }, { regla: "acuerdo", minimo: 4_000_000, moneda: "COP", trm: null });
  });
  test("total (100 %): el total de cobro en COP", () => {
    const r = resolverCondicionesContrato(rows, [], ctx({ tipo: "total" }));
    assert.deepEqual({ ...r.resumen!.minimoConfirmar }, { regla: "acuerdo", minimo: 4_000_000, moneda: "COP", trm: null });
  });
  test("cobro en USD con condición congelada en COP: el acuerdo se expresa en USD", () => {
    const r = resolverCondicionesContrato([fila(1_200_000, "COP", 1)] as never, [], { monedaContrato: "USD", precioVenta: 1000, acuerdo: { tipo: "porcentaje", porcentaje: 0.5 } });
    assert.deepEqual({ ...r.resumen!.minimoConfirmar }, { regla: "acuerdo", minimo: 500, moneda: "USD", trm: null });
  });
  test("SIN acuerdo la condición congelada conserva SU moneda (USD 300 a TRM 4.000), como antes", () => {
    const r = resolverCondicionesContrato(rows, [], ctx(null));
    assert.deepEqual({ ...r.resumen!.minimoConfirmar }, { regla: "condicion_congelada", minimo: 300, moneda: "USD", trm: 4000 });
  });
  test("la tabla por componente sigue mostrando la moneda congelada (USD) aunque el acuerdo esté en COP", () => {
    const r = resolverCondicionesContrato(rows, [], ctx({ tipo: "porcentaje", porcentaje: 0.3 }));
    assert.equal(r.filas[0].moneda, "USD");
  });
});

describe("F4 · un acuerdo explícito se muestra aunque el contrato NO tenga condiciones congeladas", () => {
  const ctx = (acuerdo: AcuerdoMinimo | null, precioVenta: number | null = 1_000_000) => ({ monedaContrato: "COP", precioVenta, acuerdo });
  test("sin filas y con acuerdo 20 %: hay minimoAcordado (200.000 COP) y NO se inventan condiciones ni restricciones", () => {
    const r = resolverCondicionesContrato([], [], ctx({ tipo: "porcentaje", porcentaje: 0.2 }));
    assert.equal(r.hayCondiciones, false, "no hay snapshot: no se inventa una sección de condiciones");
    assert.deepEqual(r.filas, []);
    assert.deepEqual(r.restringidas, []);
    assert.equal(r.huboRestriccionOriginal, false);
    assert.equal(r.resumen, null);
    assert.equal(r.minimoAcordado?.minimoConfirmar.minimo, 200_000);
    assert.match(r.minimoAcordado!.texto, /\$200\.000 COP \(mínimo acordado\)/);
  });
  test("sin filas y sin acuerdo: nada que mostrar (comportamiento histórico intacto)", () => {
    const r = resolverCondicionesContrato([], [], ctx(null));
    assert.equal(r.minimoAcordado, null);
    assert.equal(r.hayCondiciones, false);
    assert.equal(r.minimoNoVerificable, false);
  });
  test("sin filas, con acuerdo pero sin total de cobro: no se inventa un monto", () => {
    assert.equal(resolverCondicionesContrato([], [], ctx({ tipo: "total" }, null)).minimoAcordado, null);
    assert.equal(resolverCondicionesContrato([], [], ctx({ tipo: "total" }, 0)).minimoAcordado, null);
  });
  test("acuerdo en importe/total sin filas", () => {
    assert.equal(resolverCondicionesContrato([], [], ctx({ tipo: "total" })).minimoAcordado?.minimoConfirmar.minimo, 1_000_000);
    assert.equal(resolverCondicionesContrato([], [], ctx({ tipo: "importe", importe: 350_000, moneda: "COP" })).minimoAcordado?.minimoConfirmar.minimo, 350_000);
  });
  test("el documento imprimible (y el PDF, que es el mismo componente) lo renderiza fuera de la sección de condiciones", () => {
    const d = leer("components/contrato/ContratoDocumento.tsx");
    assert.match(d, /condiciones\?\.minimoAcordado && !\(condiciones\.hayCondiciones && condiciones\.filas\.length > 0\)/);
    assert.match(d, /condiciones\.minimoAcordado\.texto/);
  });
  test("las TRES páginas del documento pasan el acuerdo a la resolución (interna, por número y pública por token)", () => {
    for (const p of ["app/(dashboard)/dashboard/contratos/[numero]/page.tsx", "app/contrato/[numero]/page.tsx", "app/c/[token]/page.tsx"]) {
      assert.match(leer(p), /acuerdo: acuerdoMinimo\.estado === "acuerdo" \? acuerdoMinimo\.acuerdo : null, minimoNoVerificable: acuerdoMinimo\.estado === "error"/, p);
    }
  });
});

describe("F5 · fallo de lectura ≠ ausencia verificada", () => {
  test("interpretarLecturaAcuerdo: error de lectura → error (jamás «ausente»)", () => {
    assert.deepEqual(interpretarLecturaAcuerdo({ data: null, error: { message: "boom" } }), { estado: "error", motivo: "boom" });
    assert.equal(interpretarLecturaAcuerdo({ data: null, error: {} }).estado, "error");
  });
  test("ausencia VERIFICADA: la base respondió sin fila → ausente", () => {
    assert.deepEqual(interpretarLecturaAcuerdo({ data: null, error: null }), { estado: "ausente" });
  });
  test("fila presente → acuerdo; fila que no se entiende → error (falla cerrado)", () => {
    assert.deepEqual(interpretarLecturaAcuerdo({ data: { tipo: "porcentaje", porcentaje: "0.8000", importe: null, moneda: null }, error: null }), { estado: "acuerdo", acuerdo: { tipo: "porcentaje", porcentaje: 0.8 } });
    assert.equal(interpretarLecturaAcuerdo({ data: { tipo: "rara", porcentaje: null, importe: null, moneda: null }, error: null }).estado, "error");
    assert.equal(interpretarLecturaAcuerdo({ data: { tipo: "porcentaje", porcentaje: 0, importe: null, moneda: null }, error: null }).estado, "error");
  });
  test("la lectura de servidor distingue los tres estados (clave ausente y excepciones son ERROR)", () => {
    const s = leer("lib/contrato/acuerdoMinimo.ts");
    assert.match(s, /Promise<LecturaAcuerdo>/);
    assert.match(s, /if \(!process\.env\.SUPABASE_SERVICE_ROLE_KEY\) return \{ estado: "error"/);
    assert.match(s, /catch \(e\)[\s\S]{0,120}estado: "error"/);
    assert.match(s, /interpretarLecturaAcuerdo\(\{ data: r\.data, error: r\.error \}\)/);
    assert.doesNotMatch(s.replace(/\/\/.*/g, ""), /return null/, "ya no existe la rama que confundía fallo y ausencia");
  });
  test("con la lectura fallida el resolvedor NO publica ningún mínimo (ni el de las condiciones) y lo marca como no verificable", () => {
    const rows = [fila(300_000)] as never;
    const r = resolverCondicionesContrato(rows, [], { monedaContrato: "COP", precioVenta: 1_000_000, acuerdo: null, minimoNoVerificable: true });
    assert.equal(r.resumen, null);
    assert.equal(r.minimoAcordado, null);
    assert.equal(r.minimoNoVerificable, true);
    assert.equal(r.filas.length, 1, "los componentes congelados son hechos y se conservan");
    const sin = resolverCondicionesContrato([], [], { monedaContrato: "COP", precioVenta: 1_000_000, acuerdo: { tipo: "total" }, minimoNoVerificable: true });
    assert.equal(sin.minimoAcordado, null, "tampoco se muestra un acuerdo cuando la lectura se declaró fallida");
    assert.equal(sin.minimoNoVerificable, true);
  });
  test("ausencia verificada: la condición congelada sigue mandando y NO hay aviso de no verificable", () => {
    const r = resolverCondicionesContrato([fila(300_000)] as never, [], { monedaContrato: "COP", precioVenta: 1_000_000, acuerdo: null, minimoNoVerificable: false });
    assert.equal(r.resumen!.minimoConfirmar.regla, "condicion_congelada");
    assert.equal(r.minimoNoVerificable, false);
  });
  test("el ejemplo de Codex: acuerdo 80 % + condición vieja 30 %: con lectura buena 800.000, y con lectura fallida NUNCA se sustituye por 300.000", () => {
    const ok = reglaConfirmacion({ totalCobro: 1_000_000, monedaCobro: "COP", condiciones: [{ monto_exigido: 300_000, moneda: "COP", trm: 1 }], acuerdo: { tipo: "porcentaje", porcentaje: 0.8 } });
    assert.equal(ok.minimo, 800_000);
    const fallo = resolverCondicionesContrato([fila(300_000)] as never, [], { monedaContrato: "COP", precioVenta: 1_000_000, minimoNoVerificable: true });
    assert.equal(fallo.resumen, null, "no aparece 300.000 como si fuera el mínimo");
  });
  test("el plan de cobro NO se genera ni se guarda tras un fallo de lectura: el error corta ANTES de calcular, borrar o insertar cuotas", () => {
    const c = leer("app/(dashboard)/dashboard/contratos/[numero]/cobros-actions.ts");
    const f = c.slice(c.indexOf("export async function generarPlanCobro"), c.indexOf("// #53 (307): fija el mínimo"));
    const iError = f.indexOf('lecturaAcuerdo.estado === "error"');
    assert.ok(iError > 0, "hay una guarda por fallo de lectura");
    assert.ok(iError < f.indexOf("reglaConfirmacion("), "la guarda va antes de calcular el mínimo");
    assert.ok(iError < f.indexOf("planDeCuotas("), "…antes de armar las cuotas");
    assert.ok(iError < f.indexOf('from("cuotas").delete()'), "…y antes de borrar el plan anterior");
    assert.ok(iError < f.indexOf('from("cuotas").insert'), "…y antes de guardar uno nuevo");
    assert.match(f, /acuerdo: lecturaAcuerdo\.estado === "acuerdo" \? lecturaAcuerdo\.acuerdo : null/);
  });
  test("el documento avisa que el mínimo no está disponible en vez de mostrar uno sustituto", () => {
    const d = leer("components/contrato/ContratoDocumento.tsx");
    assert.match(d, /condiciones\?\.minimoNoVerificable/);
    assert.match(d, /Pago mínimo para confirmar: no disponible en este momento/);
  });
});
