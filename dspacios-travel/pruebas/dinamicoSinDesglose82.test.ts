// #82 — el cliente ve hotel, alimentación, habitaciones, viajeros, vuelo y servicios y UN total; nunca el desglose por componente.
// El cálculo (liquidarPaquete) y los componentes guardados para costos/CxP no se tocan: solo deja de viajar `lineas` al navegador.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

test("la acción pública, la página y el componente del checkout no envían ni muestran líneas por componente", () => {
  for (const f of ["actions.ts", "page.tsx", "CheckoutDinamico.tsx"]) {
    const s = sinComentarios(leer(`app/tarifario/checkout/dinamico/${f}`));
    assert.doesNotMatch(s, /\blineas\b|desglose-dinamico|liq\.lineas/, `${f} no debe exponer líneas`);
  }
  assert.match(leer("app/tarifario/checkout/dinamico/CheckoutDinamico.tsx"), /data-testid="total-dinamico"/);
});

test("el documento del cliente lleva un único ítem con el total guardado", async () => {
  const { itemsDocumento } = await import("../lib/paqueteDinamico/cotizacion.ts");
  const items = itemsDocumento(2_345_000, "CARTAGENA", "2026-12-01", "2026-12-04", "2 adultos");
  assert.equal(items.length, 1);
  assert.equal(items[0].valor, 2_345_000);
  assert.doesNotMatch(items[0].descripcion, /Vuelo ·|Paquete ·|Hotel ·/);
});
