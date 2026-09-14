// ─────────────────────────────────────────────────────────────────────────
// Contador monotónico de "nonce" para `AddonsIntent` (`CartContext.tsx`) —
// extraído a un módulo PURO para poder probar con ejecución REAL que nunca
// se reinicia, sin importar cuántas veces se limpie `addonsIntent` entre
// clics (`pruebas/addonsNonce.test.ts`). Lo usa `CartDrawer.tsx`, que
// mantiene UNA sola instancia por componente en un `useRef`.
//
// Causa del defecto que este módulo corrige: `CartDrawer` derivaba el
// siguiente nonce de `addonsIntent?.nonce ?? 0` — un valor de ESTADO del
// CartContext que `BuscadorReceptivos` limpia a `null` en cuanto CONSUME el
// intent (`onConsumedInitial` → `setAddonsIntent(null)`, ver
// `VistaBooking.tsx`). Como esa limpieza ocurre ANTES del siguiente clic del
// botón "+ Agregar servicios/tours", `addonsIntent` ya volvía a estar en
// `null` cuando se calculaba el siguiente nonce, así que el SEGUNDO clic
// también producía `nonce: 1` — el mismo valor que `nonceConsumidoRef`
// (dentro de `BuscadorReceptivos`) ya había marcado como consumido, y el
// segundo intent se descartaba en silencio (la búsqueda nunca se disparaba
// de nuevo).
//
// Este contador vive FUERA del estado compartido (`addonsIntent`), en su
// propia instancia por componente — nunca lee ni depende de `addonsIntent`,
// así que sobrevive a que ese estado vuelva a `null` cuantas veces sea. No
// usa `Date.now()`/`Math.random()` (no determinístico, y rompería la
// ejecución bajo `node --test`): un entero simple basta, porque la única
// garantía que necesita el consumidor (`nonceConsumidoRef` en
// `BuscadorReceptivos.tsx`) es "distinto del último nonce procesado", nunca
// un identificador globalmente único.
// ─────────────────────────────────────────────────────────────────────────

export type ContadorAddonsNonce = { siguiente(): number };

export function crearContadorAddonsNonce(): ContadorAddonsNonce {
  let ultimo = 0;
  return {
    siguiente(): number {
      ultimo += 1;
      return ultimo;
    },
  };
}
