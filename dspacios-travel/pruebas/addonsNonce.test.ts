import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { crearContadorAddonsNonce } from "../lib/cart/addonsNonce.ts";

// ─────────────────────────────────────────────────────────────────────────
// Pruebas EJECUTABLES (no wiring) del contador monotónico de nonce para
// `AddonsIntent` — ver la cabecera de `lib/cart/addonsNonce.ts` para la
// causa completa del defecto corregido.
//
// Resumen de la causa: `CartDrawer` derivaba el siguiente nonce de
// `addonsIntent?.nonce ?? 0` — un valor de ESTADO que `BuscadorReceptivos`
// limpia a `null` en cuanto CONSUME el intent (`onConsumedInitial` →
// `setAddonsIntent(null)`). Como esa limpieza ocurre antes del SIGUIENTE
// clic del botón "+ Agregar servicios/tours", `addonsIntent` ya estaba en
// `null` de nuevo al calcular el próximo nonce, así que el segundo clic
// volvía a producir `nonce: 1` — el mismo valor que `nonceConsumidoRef`
// (dentro de `BuscadorReceptivos`) ya había marcado como consumido, y el
// segundo intent se descartaba en silencio (nunca disparaba una nueva
// búsqueda).
//
// `simularConsumoReceptivos()` (abajo) replica EXACTAMENTE el algoritmo de
// deduplicación de `BuscadorReceptivos.tsx` (comparar contra
// `nonceConsumidoRef.current`, guardar el nonce ANTES de aplicar, e ignorar
// `initial === null`) — ese mismo algoritmo se verifica por inspección de
// fuente en `pruebas/addonsIntentWiring.test.ts` ("existe nonceConsumidoRef…"
// y "el efecto de consumo NO llama setState/buscar directo…"), así que una
// divergencia entre esta réplica y el componente real quedaría cubierta por
// ese archivo, no por este.
// ─────────────────────────────────────────────────────────────────────────

function simularConsumoReceptivos() {
  let nonceConsumidoRef: number | null = null;
  let busquedasEjecutadas = 0;
  const consumidos: number[] = [];
  function recibirIntent(intent: { nonce: number } | null) {
    if (!intent) return; // igual que `if (!initial) return;` en BuscadorReceptivos
    if (nonceConsumidoRef === intent.nonce) return; // dedup — igual que el componente real
    nonceConsumidoRef = intent.nonce; // se guarda ANTES de "aplicar", igual que el componente real
    consumidos.push(intent.nonce);
    busquedasEjecutadas += 1; // aplicarPrefillRef.current(initial) dispara buscar() una sola vez
  }
  return {
    recibirIntent,
    consumidos: () => [...consumidos],
    busquedasEjecutadas: () => busquedasEjecutadas,
  };
}

describe("crearContadorAddonsNonce — primer/segundo/tercer clic producen 1, 2, 3", () => {
  test("primer clic produce nonce 1", () => {
    const contador = crearContadorAddonsNonce();
    assert.equal(contador.siguiente(), 1);
  });

  test("tras 'consumir y limpiar addonsIntent' (el contador no participa de esa limpieza), el segundo clic produce nonce 2", () => {
    const contador = crearContadorAddonsNonce();
    contador.siguiente(); // primer clic → 1
    // Simula lo que hace VistaBooking/BuscadorReceptivos entre clics: limpiar
    // el intent a `null` (`setAddonsIntent(null)`). El contador vive en su
    // propio `useRef` de CartDrawer, ajeno a ese estado — nada que llamar acá.
    const segundoNonce = contador.siguiente();
    assert.equal(segundoNonce, 2);
  });

  test("tercer clic produce nonce 3", () => {
    const contador = crearContadorAddonsNonce();
    contador.siguiente();
    contador.siguiente();
    assert.equal(contador.siguiente(), 3);
  });

  test("secuencia completa de 5 clics es estrictamente monotónica (1..5), sin importar cuántas limpiezas intermedias se simulen", () => {
    const contador = crearContadorAddonsNonce();
    const nonces = Array.from({ length: 5 }, () => contador.siguiente());
    assert.deepEqual(nonces, [1, 2, 3, 4, 5]);
  });

  test("limpiar el intent (simulado) NO reinicia el contador: dos instancias independientes no se pisan entre sí, y una sola instancia nunca vuelve a 1", () => {
    const contador = crearContadorAddonsNonce();
    contador.siguiente(); // 1
    contador.siguiente(); // 2
    // "Limpiar" no es una operación del contador — no existe un método reset.
    // Confirmamos la ausencia deliberada: el contrato del tipo no ofrece
    // ninguna forma de retroceder.
    assert.equal("reset" in contador, false);
    assert.equal(contador.siguiente(), 3); // sigue avanzando, nunca vuelve a 1
  });
});

describe("crearContadorAddonsNonce — cada instancia es independiente (una por componente montado)", () => {
  test("dos contadores independientes no comparten estado", () => {
    const a = crearContadorAddonsNonce();
    const b = crearContadorAddonsNonce();
    assert.equal(a.siguiente(), 1);
    assert.equal(a.siguiente(), 2);
    assert.equal(b.siguiente(), 1); // b arranca en 1 sin importar el avance de a
  });
});

describe("Integración contador + consumidor (réplica de BuscadorReceptivos) — 3 intents, 3 búsquedas, cero duplicadas", () => {
  test("3 clics con nulling intermedio → 3 nonces distintos (1,2,3), cada uno consumido exactamente una vez, 3 búsquedas", () => {
    const contador = crearContadorAddonsNonce();
    const receptor = simularConsumoReceptivos();

    const nonce1 = contador.siguiente();
    receptor.recibirIntent({ nonce: nonce1 });
    receptor.recibirIntent(null); // BuscadorReceptivos → onConsumedInitial → setAddonsIntent(null)

    const nonce2 = contador.siguiente();
    receptor.recibirIntent({ nonce: nonce2 });
    receptor.recibirIntent(null);

    const nonce3 = contador.siguiente();
    receptor.recibirIntent({ nonce: nonce3 });
    receptor.recibirIntent(null);

    assert.deepEqual([nonce1, nonce2, nonce3], [1, 2, 3]);
    assert.deepEqual(receptor.consumidos(), [1, 2, 3]);
    assert.equal(receptor.busquedasEjecutadas(), 3);
  });

  test("re-render con el MISMO intent (mismo nonce, sin limpiar de por medio) no dispara una segunda búsqueda", () => {
    const receptor = simularConsumoReceptivos();
    receptor.recibirIntent({ nonce: 1 });
    receptor.recibirIntent({ nonce: 1 });
    receptor.recibirIntent({ nonce: 1 });
    assert.equal(receptor.busquedasEjecutadas(), 1);
    assert.deepEqual(receptor.consumidos(), [1]);
  });

  test("con el contador viejo (derivado de addonsIntent?.nonce ?? 0) el segundo clic habría repetido nonce 1 y se habría perdido — regresión que este contador corrige", () => {
    // Réplica del comportamiento ANTERIOR (defectuoso), solo para documentar
    // el contraste: `addonsIntent` vuelve a `null` entre clics (recibido como
    // parámetro, no como variable reasignada — evita que TS estreche su tipo
    // a `null` por análisis de flujo), así que el nonce derivado de él
    // siempre daba 1.
    function nonceDerivadoDelViejoAddonsIntent(actual: { nonce: number } | null): number {
      return (actual?.nonce ?? 0) + 1;
    }
    const receptor = simularConsumoReceptivos();

    const nonceViejo1 = nonceDerivadoDelViejoAddonsIntent(null);
    receptor.recibirIntent({ nonce: nonceViejo1 });
    // BuscadorReceptivos limpia el intent tras consumirlo (setAddonsIntent(null)):

    const nonceViejo2 = nonceDerivadoDelViejoAddonsIntent(null); // vuelve a dar 1 — el bug
    receptor.recibirIntent({ nonce: nonceViejo2 });

    assert.equal(nonceViejo1, 1);
    assert.equal(nonceViejo2, 1); // el defecto: el "segundo clic" repite el nonce del primero
    assert.equal(receptor.busquedasEjecutadas(), 1); // por eso el segundo intent se perdía en silencio
  });
});
