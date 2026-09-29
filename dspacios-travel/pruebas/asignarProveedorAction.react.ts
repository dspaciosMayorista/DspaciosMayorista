// Se ejecuta con npm run test:react (loader TSX/esbuild), no con test:unit.
// Prueba de la Server Action REAL `dashboard/pagos/actions.ts`
// (asignarProveedorCuentaPorPagar), simulando SOLO sus dependencias externas
// (createClient + revalidatePath + asientos) con stubs configurados por el
// reactLoader. Verifica el GUARD del servidor, que el test de interacción de
// PagosList no cubre porque allí la acción está stubeada:
//   1. Nombre inexistente en `proveedores` → error, sin update de la CxP.
//   2. Nombre existente   → update con el nombre y los datos del catálogo
//      (omitiendo lo nulo), conservando el contrato actual, y revalida.
//   3. Falla la consulta al catálogo → error, sin update de la CxP.
// Además se cubre el guard de nombre vacío (contrato mínimo de la función).
import { test } from "node:test";
import assert from "node:assert/strict";
import { __setClient } from "./support/stubs/supabaseServerStub.mjs";
import { __revalidadas, __resetRevalidadas } from "./support/stubs/nextCacheStub.mjs";

const { asignarProveedorCuentaPorPagar } = await import("../app/(dashboard)/dashboard/pagos/actions.ts");

type FilaCatalogo = {
  nombre: string;
  tipo: string | null;
  aplica_retencion: boolean | null;
  pct_retencion: number | null;
};

type LlamadaUpdate = { vals: Record<string, unknown>; col: string; val: unknown };
const llamadas = { proveedoresRead: [] as Array<{ col: string; val: unknown }>, updates: [] as LlamadaUpdate[] };

function resetLlamadas() {
  llamadas.proveedoresRead.length = 0;
  llamadas.updates.length = 0;
}

// Cliente Supabase simulado que registra la lectura del catálogo y los updates
// a `cuentas_por_pagar` (nunca se inventa: solo tablas/cadenas que usa la action).
function supabaseDe(fx: { fila?: FilaCatalogo | null; errorCatalogo?: { message: string } | null; errorUpdate?: { message: string } | null }) {
  return {
    from(table: string) {
      if (table === "proveedores") {
        return {
          select() { return this; },
          eq(col: string, val: unknown) { llamadas.proveedoresRead.push({ col, val }); return this; },
          async maybeSingle() { return { data: fx.fila ?? null, error: fx.errorCatalogo ?? null }; },
        };
      }
      if (table === "cuentas_por_pagar") {
        return {
          update(vals: Record<string, unknown>) {
            return {
              eq(col: string, val: unknown) {
                llamadas.updates.push({ vals, col, val });
                return Promise.resolve({ data: null, error: fx.errorUpdate ?? null });
              },
            };
          },
        };
      }
      throw new Error(`supabaseDe: tabla inesperada "${table}"`);
    },
  };
}

function configurar(fx: Parameters<typeof supabaseDe>[0]) {
  resetLlamadas();
  __resetRevalidadas();
  __setClient(supabaseDe(fx));
}

test("nombre inexistente en el catálogo: error y NUNCA se llama update a cuentas_por_pagar", async () => {
  configurar({ fila: null });
  const r = await asignarProveedorCuentaPorPagar(7, "Proveedor Que No Existe");
  assert.deepEqual(r, { ok: false, error: "Ese proveedor no está en el catálogo." });
  assert.deepEqual(llamadas.proveedoresRead, [{ col: "nombre", val: "Proveedor Que No Existe" }], "sí consulta el catálogo");
  assert.deepEqual(llamadas.updates, [], "no debe tocar cuentas_por_pagar");
  assert.deepEqual(__revalidadas(), [], "no revalida si no asignó");
});

test("nombre existente: actualiza con el nombre y los datos del catálogo (contrato intacto) y revalida", async () => {
  configurar({ fila: { nombre: "Hotel Beta", tipo: "hotel", aplica_retencion: true, pct_retencion: 0.025 } });
  const r = await asignarProveedorCuentaPorPagar(5, "Hotel Beta");
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(llamadas.updates, [{
    vals: { proveedor: "Hotel Beta", tipo_proveedor: "hotel", aplica_retencion: true, pct_retencion: 0.025 },
    col: "id", val: 5,
  }], "update con nombre + datos del catálogo, filtrado por id de la CxP");
  assert.deepEqual(__revalidadas(), ["/dashboard/pagos"], "revalida la ruta de pagos tras asignar");
});

test("los campos nulos del catálogo se omiten y el booleano false sí se propaga", async () => {
  configurar({ fila: { nombre: "Agencia X", tipo: null, aplica_retencion: false, pct_retencion: null } });
  const r = await asignarProveedorCuentaPorPagar(9, "Agencia X");
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(llamadas.updates[0]!.vals, { proveedor: "Agencia X", aplica_retencion: false });
});

test("falla la consulta al catálogo: resultado de error y NO actualiza la CxP", async () => {
  configurar({ fila: null, errorCatalogo: { message: "consulta al catálogo falló" } });
  const r = await asignarProveedorCuentaPorPagar(5, "Hotel Beta");
  assert.equal(r.ok, false);
  assert.equal(r.error, "Ese proveedor no está en el catálogo.", "hay resultado de error verificable");
  assert.deepEqual(llamadas.updates, [], "no debe actualizar cuentas_por_pagar si falló el catálogo");
  assert.deepEqual(__revalidadas(), [], "no revalida si no asignó");
});

test("nombre vacío/solo espacios: guard temprano sin tocar el catálogo", async () => {
  configurar({ fila: null });
  const r = await asignarProveedorCuentaPorPagar(5, "   ");
  assert.deepEqual(r, { ok: false, error: "Elige un proveedor." });
  assert.deepEqual(llamadas.proveedoresRead, [], "ni siquiera consulta el catálogo con nombre vacío");
  assert.deepEqual(llamadas.updates, []);
});