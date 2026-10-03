// W7 (diseño §6.8), migración 197: confirmar una venta y sus sillas es UNA
// transacción de la base (`confirmar_venta`). Ni confirmarVenta ni
// recalcularEstadoAbono escriben ventas o sillas por separado ni "compensan"
// con una segunda petición. W8: convertirCotizacionCarrito ya no tiene
// respaldo al cliente de sesión. (El comportamiento de la función SQL se
// prueba en supabase/scripts/test_confirmar_venta.sql.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const leer = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
function cuerpo(src: string, firma: string): string {
  const i = src.indexOf(firma);
  assert.ok(i >= 0, firma);
  const fin = [src.indexOf("\nexport ", i + firma.length), src.indexOf("\nasync function ", i + firma.length)]
    .filter((x) => x > 0).sort((a, b) => a - b)[0];
  return src.slice(i, fin);
}
const reservar = leer("../app/(dashboard)/dashboard/reservar/actions.ts");
const contratos = leer("../app/(dashboard)/dashboard/contratos/actions.ts");

test("confirmarVenta: una sola RPC confirmar_venta; sin UPDATE de ventas/sillas ni compensación", () => {
  const c = cuerpo(reservar, "export async function confirmarVenta(");
  assert.match(c, /sb\.rpc\("confirmar_venta", \{ p_numero: numeroContrato \}\)/);
  assert.doesNotMatch(c, /from\("ventas"\)|from\("sillas"\)/, "no lee ni escribe ventas/sillas por fuera de la transacción");
  assert.doesNotMatch(c, /createAdminClient|SUPABASE_SERVICE_ROLE_KEY/, "ya no depende de la clave de servicio");
});

test("recalcularEstadoAbono: confirma con la misma RPC y propaga el error; registrar/actualizar abono lo informan", () => {
  const c = cuerpo(contratos, "async function recalcularEstadoAbono(");
  assert.match(c, /const \{ error: eConf \} = await sb\.rpc\("confirmar_venta", \{ p_numero: numeroContrato \}\);\s*if \(eConf\) return \{ ok: false/);
  assert.doesNotMatch(c, /\.update\(\{ estado: "confirmado" \}\)|\.update\(\{ estado: "pendiente" \}\)|from\("sillas"\)/, "sin UPDATE suelto ni compensación");
  for (const firma of ["export async function registrarAbono(", "export async function actualizarAbono("]) {
    assert.match(cuerpo(contratos, firma), /const conf = await recalcularEstadoAbono\(sb, numeroContrato\);\s*if \(!conf\.ok\) \{/, firma);
  }
});

test("EstadoVenta muestra el error de confirmarVenta", () => {
  const c = leer("../app/(dashboard)/dashboard/contratos/[numero]/EstadoVenta.tsx");
  assert.match(c, /const r = await confirmarVenta\(numero\); if \(!r\.ok\) setErr\(/);
});

test("el ayudante de la ronda anterior (dos peticiones con compensación) ya no existe", () => {
  assert.equal(existsSync(new URL("../lib/reservar/confirmarSillas.ts", import.meta.url)), false);
  assert.doesNotMatch(reservar + contratos, /confirmarSillasContrato|clavePresente/);
});

test("W8 convertirCotizacionCarrito: la clave se exige ANTES de crear el cliente admin; sin respaldo de sesión", () => {
  const c = cuerpo(reservar, "export async function convertirCotizacionCarrito(");
  assert.doesNotMatch(c, /SUPABASE_SERVICE_ROLE_KEY \? createAdminClient\(\) : sb/);
  const iClave = c.indexOf("if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {");
  const iAdmin = c.indexOf("const admin = createAdminClient();");
  const iEscritura = c.search(/\.(insert|update|upsert|delete)\(/);
  assert.ok(iClave > 0 && iAdmin > iClave, "la clave se comprueba antes de crear el cliente");
  assert.ok(iEscritura > iAdmin, "y antes de cualquier escritura");
});
