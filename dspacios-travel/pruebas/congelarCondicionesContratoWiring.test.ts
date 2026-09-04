import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// GUARDA CONTRA LA DIVERGENCIA — Rama B (migración 165): confirma, mirando el
// CÓDIGO FUENTE (no ejecución — reservar/actions.ts depende de Supabase real
// para correr de punta a punta), que los 3 puntos de creación de contrato
// FUERA de la cotización manual (reservarDesdeTarifarioInterno,
// reservarProgramaInterno, convertirCotizacionCarrito) de verdad invocan el
// congelado de condiciones con datos REALES de catálogo — nunca con un
// componente inventado — y siempre por el cliente `service_role` (nunca por
// `sb`, la sesión del usuario, que no tiene EXECUTE sobre el RPC).
// ───────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");
const SRC = "app/(dashboard)/dashboard/reservar/actions.ts";

test("reservar/actions.ts importa el puente de congelado desde el módulo puro (nunca reimplementa la lógica inline)", () => {
  const src = leer(SRC);
  assert.match(
    src,
    /from\s*"@\/lib\/contrato\/congelarCondicionesContrato"/,
    "no se encontró el import de lib/contrato/congelarCondicionesContrato"
  );
  for (const nombre of ["componenteHotelReal", "componentePaqueteReal", "trmReferenciaAproximada", "congelarCondicionesContratoBestEffort"]) {
    assert.ok(new RegExp(`\\b${nombre}\\b`).test(src), `no se importa/usa ${nombre}`);
  }
});

test("reservarDesdeTarifarioInterno: congela con componenteHotelReal/componentePaqueteReal, admin service_role, best-effort", () => {
  const src = leer(SRC);
  const start = src.indexOf("async function reservarDesdeTarifarioInterno");
  const end = src.indexOf("export async function crearCotizacion(");
  assert.ok(start !== -1 && end !== -1 && end > start, "no se pudo delimitar reservarDesdeTarifarioInterno");
  const fn = src.slice(start, end);

  // Debe estar gateado por SUPABASE_SERVICE_ROLE_KEY (mismo criterio que el
  // resto del archivo para todo uso de createAdminClient()).
  assert.match(fn, /if\s*\(process\.env\.SUPABASE_SERVICE_ROLE_KEY\)\s*\{[\s\S]*componenteHotelReal/, "el congelado no está gateado por SUPABASE_SERVICE_ROLE_KEY antes de usar componenteHotelReal");

  // Usa el cliente admin (service_role), NUNCA `sb` (sesión), para el RPC.
  assert.match(fn, /congelarCondicionesContratoBestEffort\(adminCond,/, "reservarDesdeTarifarioInterno no llama al congelado con el cliente admin (service_role)");
  assert.doesNotMatch(fn, /congelarCondicionesContratoBestEffort\(sb,/, "reservarDesdeTarifarioInterno llamó al congelado con `sb` (sesión) — el RPC solo acepta service_role");

  // Rama mutuamente excluyente: hotel real vs paquete real (nunca ambas a la
  // vez, nunca un componente inventado a mano).
  assert.match(fn, /!esServicios\s*&&\s*meta\.fecha_ida\s*&&\s*meta\.fecha_regreso/, "reservarDesdeTarifarioInterno no distingue esServicios antes de elegir hotel vs paquete");
  assert.match(fn, /componenteHotelReal\(adminCond,\s*\{/, "no se arma el componente hotel desde datos reales (componenteHotelReal)");
  assert.match(fn, /componentePaqueteReal\(adminCond,\s*\{/, "no se arma el componente paquete desde datos reales (componentePaqueteReal)");
  assert.match(fn, /hotelId:\s*input\.hotelId/, "el componente hotel no usa input.hotelId real");
  assert.match(fn, /paqueteId:\s*input\.paqueteId/, "el componente paquete no usa input.paqueteId real");

  // El valor congelado es el precio REAL del contrato (precioFinal), nunca
  // un valor inventado ni el bruto antes del descuento de comisión B2B neta.
  assert.match(fn, /valor:\s*precioFinal/, "el componente no usa precioFinal (el precio real ya ajustado por B2B) como valor");
});

test("reservarProgramaInterno: la SELECT de programas trae las 4 columnas de condición y congela con componenteDePrograma", () => {
  const src = leer(SRC);
  const start = src.indexOf("async function reservarProgramaInterno");
  assert.notEqual(start, -1, "no se encontró reservarProgramaInterno");
  const fn = src.slice(start);

  assert.match(
    fn,
    /\.from\("programas"\)\s*\.select\("[^"]*condicion_pago_tipo[^"]*condicion_pago_pct_inicial[^"]*condicion_pago_dias_saldo[^"]*restriccion_comercial[^"]*"\)/,
    "la SELECT de programas no trae las 4 columnas de condición de pago de la migración 164"
  );
  assert.match(fn, /componenteDePrograma\(prog,\s*\{/, "reservarProgramaInterno no arma el componente con componenteDePrograma(prog, …) usando la fila real ya traída");
  assert.match(fn, /congelarCondicionesContratoBestEffort\(adminCond,/, "reservarProgramaInterno no llama al congelado con el cliente admin (service_role)");
  assert.doesNotMatch(fn, /congelarCondicionesContratoBestEffort\(sb,/, "reservarProgramaInterno llamó al congelado con `sb` (sesión)");
  assert.match(fn, /valor:\s*precioVenta/, "el componente de programa no usa el precioVenta real calculado");
});

test("convertirCotizacionCarrito: congela UNA vez por contrato (grupo), acumulando un componente hotel por cada ítem real", () => {
  const src = leer(SRC);
  const start = src.indexOf("export async function convertirCotizacionCarrito");
  const end = src.indexOf("export async function actualizarVigenciaCotizacion(");
  assert.ok(start !== -1 && end !== -1 && end > start, "no se pudo delimitar convertirCotizacionCarrito");
  const fn = src.slice(start, end);

  // Acumulador declarado DENTRO del loop de grupos (uno por numero_contrato),
  // no compartido entre grupos — cada contrato congela solo sus propios ítems.
  assert.match(fn, /const\s+componentesCondicion:\s*ComponenteSnapshot\[\]\s*=\s*\[\]/, "no se declaró el acumulador componentesCondicion");

  // Dentro del loop por hotel (hIdx), arma el componente con el hotelId de
  // ESE ítem — nunca uno fijo ni el del primer hotel del grupo.
  assert.match(fn, /componenteHotelReal\(admin,\s*\{\s*\n\s*hotelId:\s*it\.hotelId/, "el componente hotel del carrito no usa it.hotelId (el hotel real de ESE ítem)");
  assert.match(fn, /valor:\s*comp\.precioVenta/, "el componente hotel del carrito no usa comp.precioVenta (el PVP real de ESE ítem)");

  // El congelado se llama UNA vez, después del loop de hoteles Y del bloque
  // de tours (para incluirlos en el mismo snapshot), con el número YA
  // generado del grupo — nunca dentro del loop por hotel (evitaría duplicar
  // filas al reintentar el no-op del RPC innecesariamente por ítem).
  const idxLoopFin = fn.indexOf("// Tours: quedan como ítem visible");
  const idxCongelado = fn.indexOf("congelarCondicionesContratoBestEffort(admin,");
  assert.ok(idxLoopFin !== -1, "no se encontró el bloque de tours");
  assert.ok(idxCongelado > idxLoopFin, "el congelado del carrito se llama ANTES del bloque de tours — no incluiría sus componentes");
  assert.match(fn, /congelarCondicionesContratoBestEffort\(admin,\s*\{\s*\n\s*numeroContrato:\s*numero,/, "el congelado del carrito no usa el numero_contrato del grupo actual");
});

test("ningún punto de congelado pasa un usuarioId que no venga de sb.auth.getUser() real (nunca inventado/hardcodeado)", () => {
  const src = leer(SRC);
  const bloques = src.split("congelarCondicionesContratoBestEffort(");
  assert.ok(bloques.length >= 4, "se esperaban al menos 3 llamadas a congelarCondicionesContratoBestEffort (una por punto de creación de contrato)");
  for (let i = 1; i < bloques.length; i++) {
    const ventana = bloques[i].slice(0, 400);
    assert.match(ventana, /usuarioId:\s*usuarioCond\.id/, `llamada #${i} a congelarCondicionesContratoBestEffort no usa usuarioId: usuarioCond.id`);
  }
});
