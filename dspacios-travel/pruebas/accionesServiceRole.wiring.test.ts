import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// GUARDA — funciones con service-role que NO deben ser Server Actions
//
// Todo `export` de un archivo "use server" es un endpoint invocable desde el
// navegador con el id de la acción. `asegurarCuentasPorPagar` (crea CxP y
// asientos) y `liberarVencidas` (cancela contratos y libera sillas) escriben
// con service-role y no autorizan: vivían exportadas en reservar/actions.ts.
// Ahora viven en lib/ (server-only, sin "use server") y las llaman solo:
//   - completarProveedores, DESPUÉS de autorizar;
//   - confirmarVenta / recalcularEstadoAbono, tras leer el contrato con la
//     sesión (RLS de ventas);
//   - el render de /dashboard/reservar y el cron con CRON_SECRET.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");
function fuentes(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(join(raiz, dir))) {
    const rel = join(dir, nombre);
    if (statSync(join(raiz, rel)).isDirectory()) salida.push(...fuentes(rel));
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(rel);
  }
  return salida;
}
const ARCHIVOS = ["app", "components", "lib"].flatMap(fuentes);
const directiva = (src: string, d: string) => new RegExp(`^\\s*["']${d}["']`).test(src.replace(/^(\s*\/\/.*\n)+/, ""));
const FUNCIONES = ["asegurarCuentasPorPagar", "liberarVencidas"];

test("ningún archivo \"use server\" exporta asegurarCuentasPorPagar ni liberarVencidas", () => {
  const hallazgos: string[] = [];
  for (const rel of ARCHIVOS) {
    const src = leer(rel);
    if (!directiva(src, "use server")) continue;
    for (const fn of FUNCIONES) {
      const exporta = new RegExp(`export\\s+(async\\s+)?function\\s+${fn}\\b`).test(src)
        || new RegExp(`export\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}`).test(src)
        || new RegExp(`export\\s+const\\s+${fn}\\b`).test(src);
      if (exporta) hallazgos.push(`${rel} exporta ${fn}`);
    }
  }
  assert.deepEqual(hallazgos, []);
});

test("los módulos nuevos son server-only y no son Server Actions", () => {
  for (const rel of ["lib/reservar/asegurarCuentasPorPagar.ts", "lib/reservar/liberarVencidas.ts"]) {
    const src = leer(rel);
    assert.ok(!directiva(src, "use server"), `${rel} no debe llevar "use server"`);
    assert.match(src, /^import "server-only";/m, `${rel} debe importar server-only`);
  }
});

test("ningún componente de cliente importa esos módulos", () => {
  const hallazgos: string[] = [];
  for (const rel of ARCHIVOS) {
    const src = leer(rel);
    if (directiva(src, "use client") && /lib\/reservar\/(asegurarCuentasPorPagar|liberarVencidas)/.test(src)) hallazgos.push(rel);
  }
  assert.deepEqual(hallazgos, []);
});

test("completarProveedores autoriza con la sesión ANTES de invocar la función con service-role", () => {
  const src = leer("app/(dashboard)/dashboard/contratos/[numero]/gestion-actions.ts");
  const ini = src.indexOf("export async function completarProveedores");
  const fin = src.indexOf("\nexport ", ini + 1);
  const cuerpo = src.slice(ini, fin);
  const iDecision = cuerpo.indexOf("autorizarCuentasPorPagarContrato(");
  const iCorte = cuerpo.indexOf("if (!decision.permitido) return");
  const iAsegurar = cuerpo.indexOf("asegurarCuentasPorPagar(");
  assert.ok(iDecision > 0 && iCorte > iDecision && iAsegurar > iCorte, "orden: decidir → cortar → asegurar");
  assert.doesNotMatch(cuerpo.slice(0, iAsegurar), /createAdminClient/, "no se toca service-role antes de decidir");
  assert.match(cuerpo, /sb\.from\("ventas"\)\.select\("tenant"\)/, "el contrato se lee con la sesión (RLS de ventas)");
});

test("confirmarVenta y recalcularEstadoAbono solo llegan a asegurar tras leer el contrato con la sesión", () => {
  const reservar = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const cv = reservar.slice(reservar.indexOf("export async function confirmarVenta"));
  // Desde la migración 197 la sesión prueba su acceso dentro de confirmar_venta
  // (SECURITY INVOKER, RLS de ventas): solo si esa RPC no devolvió error se
  // llega a asegurarCuentasPorPagar (service-role).
  const iRpc = cv.indexOf('sb.rpc("confirmar_venta"');
  const iCorte = cv.indexOf("if (error) return");
  assert.ok(iRpc > 0 && iCorte > iRpc && iCorte < cv.indexOf("asegurarCuentasPorPagar("), "confirmar con la sesión → cortar si falla → asegurar");
  const contratos = leer("app/(dashboard)/dashboard/contratos/actions.ts");
  const rc = contratos.slice(contratos.indexOf("async function recalcularEstadoAbono"));
  const iCond = rc.indexOf('if (venta?.estado === "pendiente"');
  assert.ok(iCond > 0 && iCond < rc.indexOf("asegurarCuentasPorPagar("), "solo con la venta leída por la sesión");
});

test("el cron sigue exigiendo CRON_SECRET antes de liberar, y usa el módulo de lib", () => {
  const src = leer("app/api/cron/liberar-vencidas/route.ts");
  assert.match(src, /from "@\/lib\/reservar\/liberarVencidas"/);
  const iSecreto = src.indexOf("if (!secret)");
  const iBearer = src.indexOf("Bearer ${secret}");
  const iLiberar = src.indexOf("await liberarVencidas()");
  assert.ok(iSecreto > 0 && iBearer > iSecreto && iLiberar > iBearer, "valida CRON_SECRET (falla cerrado) antes de liberar");
  const pagina = leer("app/(dashboard)/dashboard/reservar/page.tsx");
  assert.ok(!directiva(pagina, "use client"), "la página que libera al entrar es de servidor");
  assert.match(pagina, /from "@\/lib\/reservar\/liberarVencidas"/);
});
