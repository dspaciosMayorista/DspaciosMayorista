import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3D Bernalo — verificación por inspección de la UI (`EditorPax`,
// `app/tarifario/VistaBooking.tsx`) y de la Server Action de re-validación
// (`app/tarifario/ocupacionBernaloActions.ts`). Ninguno de los dos es
// ejecutable bajo `node --test` (JSX/Supabase/Next, sin testing-library en
// este repo) — mismo criterio que el resto de wiring tests del proyecto:
// se verifica el código FUENTE real, no un render simulado.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuenteVistaBooking = readFileSync(join(raiz, "app/tarifario/VistaBooking.tsx"), "utf8");
const fuenteAction = readFileSync(join(raiz, "app/tarifario/ocupacionBernaloActions.ts"), "utf8");

function sinComentarios(fuente: string): string {
  return fuente.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l)).join("\n");
}
const codigoVistaBooking = sinComentarios(fuenteVistaBooking);
const codigoAction = sinComentarios(fuenteAction);

// Extrae el cuerpo de `function EditorPax({...}: {...}) { ... }` balanceando
// llaves reales (mismo criterio brace-depth-aware que el resto del repo,
// ver `pruebas/serviciosPaqueteWiring.test.ts`).
function cuerpoFuncion(fuenteCompleta: string, ancla: string): string {
  const idx = fuenteCompleta.indexOf(ancla);
  assert.ok(idx > -1, `no se encontró "${ancla}"`);
  let profundidadParen = 0;
  let idxLlaveInicial = -1;
  for (let i = idx; i < fuenteCompleta.length; i++) {
    const ch = fuenteCompleta[i];
    if (ch === "(") profundidadParen++;
    else if (ch === ")") profundidadParen--;
    else if (ch === "{" && profundidadParen === 0) { idxLlaveInicial = i; break; }
  }
  assert.ok(idxLlaveInicial > -1, `no se encontró el "{" del cuerpo tras "${ancla}"`);
  let profundidad = 0;
  for (let i = idxLlaveInicial; i < fuenteCompleta.length; i++) {
    if (fuenteCompleta[i] === "{") profundidad++;
    else if (fuenteCompleta[i] === "}") {
      profundidad--;
      if (profundidad === 0) return fuenteCompleta.slice(idx, i + 1);
    }
  }
  throw new Error(`no se encontró el cierre del cuerpo de "${ancla}"`);
}

const cuerpoEditorPax = cuerpoFuncion(fuenteVistaBooking, "function EditorPax({");

describe("EditorPax — hotel 'persona' conserva la salida anterior (regla 9)", () => {
  test("el prop modeloTarifario es opcional, default null — los 2 call sites de hoteles 'persona' no lo pasan (queda en el flujo legado)", () => {
    // Fase 3E agregó un TERCER call site (HotelBernaloCotizarModal) que SÍ
    // pasa modeloTarifario="unidad" — ver pruebas/ocupacionBernaloUI3EWiring.test.ts.
    // Los 2 call sites de hoteles "persona" que ya existían en Fase 3D siguen
    // exactamente igual, sin el prop nuevo.
    assert.match(cuerpoEditorPax, /modeloTarifario\s*=\s*null/);
    const llamadas = [...fuenteVistaBooking.matchAll(/<EditorPax\s/g)];
    assert.equal(llamadas.length, 3, "2 call sites de hoteles persona + 1 de HotelBernaloCotizarModal (Fase 3E)");
    let sinModelo = 0;
    for (const m of llamadas) {
      const bloque = fuenteVistaBooking.slice(m.index, m.index + 400);
      if (!/modeloTarifario=/.test(bloque)) sinModelo++;
    }
    assert.equal(sinModelo, 2, "los 2 call sites de hoteles persona no deben pasar modeloTarifario");
  });

  test("el bloque JSX legado (flat: cantidad de menores + edadesTxt.map) sigue presente TAL CUAL, dentro de la rama !esBernalo", () => {
    assert.match(cuerpoEditorPax, /muestraMenores\s*&&/);
    assert.match(cuerpoEditorPax, /edadesTxt\.map\(/);
    assert.match(cuerpoEditorPax, /setCantidadMenores\(Number\(e\.target\.value\)\)/);
    assert.match(cuerpoEditorPax, /Cantidad de menores<\/label>/);
  });

  test("el botón/lógica de 'Agregar al carrito' (onAgregar, flujo de precio legado) sigue intacto para !esBernalo", () => {
    assert.match(cuerpoEditorPax, /onClick=\{agregar\}\s+disabled=\{!puede\}/);
    assert.match(cuerpoEditorPax, /onAgregar\(habitaciones, ninos, ninos2, infantes, pax, precio, edades\)/);
  });
});

describe("EditorPax — captura por habitación cuando modeloTarifario === 'unidad'", () => {
  test("una habitación sin menores: el campo 'Cantidad de menores' de esa fila parte en 0 y no hay campos de edad hasta que se declare al menos 1", () => {
    assert.match(cuerpoEditorPax, /value=\{edadesHab\.length\}/);
    assert.match(cuerpoEditorPax, /edadesHab\.map\(\(v, i\) => \{/);
  });

  test('etiqueta exacta "Edad del menor N" por habitación (una fila/sección compacta por habitación física)', () => {
    assert.match(cuerpoEditorPax, /Edad del menor \{i \+ 1\}/);
    assert.match(cuerpoEditorPax, /habitacionesUI\.map\(\(h, idx\) => \{/);
  });

  test("mensajes de error se muestran JUNTO a la habitación incompleta (por habitación, no un solo mensaje global)", () => {
    assert.match(cuerpoEditorPax, /erroresPorHabitacion\.get\(h\.id\)/);
    assert.match(cuerpoEditorPax, /erroresHab\.length > 0/);
  });

  test("cambiar la cantidad/edades de una habitación usa las funciones puras de sincronización (nunca reimplementa el prorrateo a mano)", () => {
    assert.match(cuerpoEditorPax, /sincronizarHabitaciones\(/);
    assert.match(cuerpoEditorPax, /ajustarCantidadEdadesHabitacion\(/);
    assert.match(cuerpoEditorPax, /establecerEdad\(/);
  });

  test("el preview EN VIVO usa la misma función de validación que el servidor (no reimplementa reglas de edad aparte)", () => {
    assert.match(cuerpoEditorPax, /validarHabitacionesOcupacion\(payloadBernalo\)/);
  });

  test("no llama a computarReserva ni al orquestador de Fase 3C desde el componente", () => {
    assert.doesNotMatch(codigoVistaBooking, /computarReserva/);
    assert.doesNotMatch(codigoVistaBooking, /orquestarCotizacionAlojamientoBernalo|resolverYCotizarAlojamientoBernalo/);
  });

  test("el botón de Bernalo llama al servidor, nunca re-usa 'agregar()' del flujo legado", () => {
    // Fase 3E reemplazó el botón "Validar ocupación" (solo formato, Fase 3D)
    // por "Cotizar" (cotización real, `cotizarAlojamientoBernaloPublico`) —
    // ver pruebas/ocupacionBernaloUI3EWiring.test.ts para el detalle
    // completo de esa transición. Esta prueba solo confirma que SIGUE sin
    // reusar `agregar()`/`onAgregar` del flujo legado.
    assert.doesNotMatch(cuerpoEditorPax, /onClick=\{agregar\}[\s\S]{0,80}esBernalo/);
    assert.match(cuerpoEditorPax, /await cotizarAlojamientoBernaloPublico\(\{/);
  });
});

describe("app/tarifario/ocupacionBernaloActions.ts — server re-valida, reutiliza Fase 3A/3D, no cotiza", () => {
  test('es una Server Action ("use server")', () => {
    assert.match(fuenteAction.split(/\r?\n/).slice(0, 3).join("\n"), /"use server"/);
  });

  test("reutiliza validarHabitacionesOcupacion (Fase 3D) y adaptarOcupacionDesdeReservar (Fase 3A, Caso C) — no reimplementa validación", () => {
    assert.match(codigoAction, /import\s*\{[\s\S]*validarHabitacionesOcupacion[\s\S]*\}\s*from\s*"@\/lib\/reservar\/ocupacionPorHabitacion"/);
    assert.match(codigoAction, /import\s*\{[\s\S]*adaptarOcupacionDesdeReservar[\s\S]*\}\s*from\s*"@\/lib\/calc\/ocupacionHabitacion"/);
    assert.match(codigoAction, /validarHabitacionesOcupacion\(input\.habitaciones\)/);
    assert.match(codigoAction, /adaptarOcupacionDesdeReservar\(\{/);
    assert.match(codigoAction, /habitacionesExplicitas:/);
  });

  test("no cotiza (no llama cotizarHabitaciones) ni llama al orquestador/guardias — se detiene en el contrato canónico", () => {
    assert.doesNotMatch(codigoAction, /cotizarHabitaciones/);
    assert.doesNotMatch(codigoAction, /computarReserva/);
    assert.doesNotMatch(codigoAction, /orquestarCotizacionAlojamientoBernalo|resolverYCotizarAlojamientoBernalo/);
  });

  test("no toca Supabase (validación puramente de forma, sin consultas)", () => {
    const lineasImport = fuenteAction.split(/\r?\n/).filter((l) => /^\s*import\b/.test(l));
    assert.doesNotMatch(lineasImport.join("\n"), /supabase/i);
    assert.doesNotMatch(codigoAction, /createClient|createAdminClient/);
  });
});
