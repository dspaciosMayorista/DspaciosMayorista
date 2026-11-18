import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { totalCobroConvertido, validarEleccionCobro } from "../lib/finanzas/cobro.ts";
import { reglaConfirmacion } from "../lib/contrato/reglaConfirmacion.ts";

// #53 · cifras que quien revisa verá en el paso «moneda de cobro» de la cotización USD (oferta #63 de USD 1.000) y el mínimo acordado del 30 % resultante.
// La interfaz usa EXACTAMENTE estas funciones (CotizacionAcciones.tsx): la vista previa y la validación son las del servidor.
const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("la vista previa sigue a la TRM que se escribe: 4.000 → COP 4.000.000; 4.100 → COP 4.100.000", () => {
  assert.equal(totalCobroConvertido(1000, "USD", "COP", 4000), 4_000_000);
  assert.equal(totalCobroConvertido(1000, "USD", "COP", 4100), 4_100_000);
});

test("sin TRM válida no hay vista previa (no se inventa ni se usa la del día)", () => {
  for (const trm of [null, undefined, 0, -1, Number.NaN]) assert.equal(totalCobroConvertido(1000, "USD", "COP", trm as never), null);
  assert.equal(totalCobroConvertido(1000, "USD", "USD", 4000), null, "misma moneda: no hay conversión");
});

test("la elección es OBLIGATORIA y EXPRESA: sin moneda se rechaza, y cobrar en COP exige la TRM de cobro", () => {
  assert.equal(validarEleccionCobro({ monedaOferta: "USD", monedaCobro: null, trmCobro: null, esInterno: true }).ok, false);
  assert.equal(validarEleccionCobro({ monedaOferta: "USD", monedaCobro: "COP", trmCobro: null, esInterno: true }).ok, false);
  const ok = validarEleccionCobro({ monedaOferta: "USD", monedaCobro: "COP", trmCobro: "4000", esInterno: true });
  assert.deepEqual(ok, { ok: true, monedaCobro: "COP", trmCobro: 4000 });
});

test("el acuerdo del 30 % sobre el total de COBRO congelado: COP 1.200.000 (TRM 4.000) o COP 1.230.000 (TRM 4.100)", () => {
  const minimo = (trm: number) => reglaConfirmacion({ totalCobro: totalCobroConvertido(1000, "USD", "COP", trm)!, monedaCobro: "COP", condiciones: [], acuerdo: { tipo: "porcentaje", porcentaje: 0.3 } });
  assert.deepEqual(minimo(4000), { regla: "acuerdo", minimo: 1_200_000, moneda: "COP", trm: null });
  assert.deepEqual(minimo(4100), { regla: "acuerdo", minimo: 1_230_000, moneda: "COP", trm: null });
});

test("la interfaz NO preselecciona la moneda ni la TRM de cobro (campos vacíos hasta que la persona elige y escribe)", () => {
  for (const f of ["app/(dashboard)/dashboard/cotizaciones/[id]/CotizacionAcciones.tsx", "app/(dashboard)/dashboard/cotizaciones/[id]/ConvertirCarritoBtn.tsx"]) {
    const s = leer(f);
    assert.match(s, /const \[monedaCobro, setMonedaCobro\] = useState(<[^>]*>)?\(""\)/, f);
    assert.match(s, /const \[trmCobro, setTrmCobro\] = useState\(""\)/, f);
  }
});
