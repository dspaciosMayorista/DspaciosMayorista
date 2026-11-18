// #53 (307) · hallazgo F1 de la auditoría integrada: el stub de «@/lib/voucher/pagoCompleto» de reactLoader.mjs negaba el pago SIEMPRE, también en las corridas de acciones reales
// (PG_ACCIONES_REALES=1), y ocultaba el acceso pagado del aliado. Esta prueba fija el alcance correcto del stub, sin leer el texto del archivo: ejecuta la resolución del loader.
//   · pruebas React aisladas (sin PG_ACCIONES_REALES): sigue el stub que falla CERRADO (nunca «pagado»);
//   · acciones reales (PG_ACCIONES_REALES=1): se resuelve el módulo REAL lib/voucher/pagoCompleto.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const RAIZ = process.cwd();
const LOADER = pathToFileURL(join(RAIZ, "pruebas", "support", "reactLoader.mjs")).href;
const REAL = pathToFileURL(join(RAIZ, "lib", "voucher", "pagoCompleto.ts")).href;
const ESPECIFICADOR = "@/lib/voucher/pagoCompleto";
const PADRE = pathToFileURL(join(RAIZ, "lib", "portal", "b2bPortalServidor.ts")).href;
const sinSiguiente = () => { throw new Error("no debía delegar al resolver siguiente"); };

async function resolver(realista: boolean) {
  const anterior = process.env.PG_ACCIONES_REALES;
  if (realista) process.env.PG_ACCIONES_REALES = "1"; else delete process.env.PG_ACCIONES_REALES;
  try {
    // La bandera se lee al cargar el módulo: una consulta distinta fuerza una instancia nueva por modo.
    const m = await import(`${LOADER}?modo=${realista ? "real" : "aislado"}`);
    return (await m.resolve(ESPECIFICADOR, { parentURL: PADRE }, sinSiguiente)) as { url: string };
  } finally {
    if (anterior === undefined) delete process.env.PG_ACCIONES_REALES; else process.env.PG_ACCIONES_REALES = anterior;
  }
}

test("F1: en las pruebas React aisladas el pago completo sigue siendo el stub que falla cerrado", async () => {
  const r = await resolver(false);
  assert.match(r.url, /pagoCompletoStub\.mjs$/);
});

test("F1: con acciones reales (PG_ACCIONES_REALES=1) se usa el módulo REAL de pago completo, no el stub", async () => {
  const r = await resolver(true);
  assert.equal(r.url, REAL);
  assert.doesNotMatch(r.url, /Stub/);
});
