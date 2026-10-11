// Parte Node de test_205_secuencia_despliegue.sh (no correr suelto).
//
// Recibe las filas de aliados_b2b tal como quedaron en la base local tras la
// secuencia real (código viejo → 205 → código viejo aún desplegado → código
// nuevo) y compara, fila por fila:
//   · "importe anterior": calcComisionB2B de origin/main (el archivo REAL de
//     la base del PR, extraído con git show), con los mismos argumentos que
//     le pasaban las pantallas viejas;
//   · "importe nuevo": calcularComisionFila del código nuevo;
//   · el espejo SQL comision_b2b_total() que viene en el JSON.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { calcularComisionFila, type FilaComisionB2B } from "@/lib/finanzas/comisionB2B";

type Fila = FilaComisionB2B & { caso: string; total_sql: number; esperado: string };

const filas = JSON.parse(readFileSync(process.env.FILAS_205!, "utf8")) as Fila[];
const viejo = (await import(pathToFileURL(resolve(process.env.FINANZAS_VIEJO!)).href)) as {
  calcComisionB2B: (i: Record<string, unknown>) => { totalPagar: number };
};

let fallos = 0;
for (const f of filas) {
  const anterior = viejo.calcComisionB2B({
    precioVenta: f.precio_venta, baseComisionable: f.base_comision, pctComision: f.pct_comision,
    recobroTotal: f.recobro_total, pctRecobroAliado: f.pct_recobro_aliado,
    aplicaRetencion: f.aplica_retencion, pctRetencion: f.pct_retencion,
  }).totalPagar;
  const nuevo = calcularComisionFila(f).totalPagar;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  let ok: boolean;
  let detalle: string;
  if (f.esperado === "igual") {
    ok = r2(anterior) === r2(nuevo) && r2(nuevo) === r2(Number(f.total_sql));
    detalle = `anterior=${r2(anterior)} nuevo=${r2(nuevo)} sql=${r2(Number(f.total_sql))}`;
  } else {
    // Fila creada por el código nuevo: su propia semántica (p. ej. base 0 = 0).
    ok = r2(nuevo) === Number(f.esperado) && r2(Number(f.total_sql)) === Number(f.esperado);
    detalle = `nuevo=${r2(nuevo)} sql=${r2(Number(f.total_sql))} esperado=${f.esperado} (el código viejo habría leído ${r2(anterior)})`;
  }
  console.log(`${ok ? "OK   " : "FALLO"} ${f.caso} · base_explicita=${f.base_explicita ?? "NULL"} · ${detalle}`);
  if (!ok) fallos++;
}
if (filas.length === 0) { console.log("FALLO no llegaron filas"); fallos++; }
console.log(fallos === 0 ? `TODO OK (${filas.length} filas)` : `FALLOS: ${fallos}`);
process.exit(fallos === 0 ? 0 : 1);
