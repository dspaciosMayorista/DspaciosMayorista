import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { destinosPorcionPublica } from "../lib/tarifario/destinosPorcion.ts";

// ─────────────────────────────────────────────────────────────────────────
// Destinos ofrecibles en el selector del motor de búsqueda de Porción
// terrestre (Vista Booking).
//
// Esta es la prueba EJECUTABLE de la unión — a diferencia de los wiring tests
// (que verifican texto fuente), acá se corre la función de verdad con un
// catálogo de fixture. La unión vive en `lib/tarifario/destinosPorcion.ts` y no
// dentro de `VistaBooking` justamente para que esto sea posible: el caso que
// motivó el cambio ("un destino que sólo existe por hoteles unidad") no se
// puede verificar mirando la forma del código, sólo su resultado.
//
// El hueco que cierra: `BuscadorBooking` resolvía sus destinos con una lista
// propia construida EXCLUSIVAMENTE con filas persona. Un destino que existía
// únicamente por ofertas unidad quedaba fuera del desplegable, así que el motor
// —que ya sabe resolverlas— no se podía invocar para ese destino desde la UI.
// La otra mitad del requisito (que ese destino llegue realmente al `<select>`
// del buscador) se verifica en `busquedaPorcionTerrestreWiring.test.ts`.
//
// Identidad por `id` (cierre del hallazgo "Hotel Prueba Odair"): cada opción
// es `{ id, nombre }`, no solo el nombre. Las filas persona no traen id
// (`tarifario_resultado` no tiene `destino_id`) — para ellas `id` queda
// `null`. Una oferta unidad SÍ conoce su `armado_paquetes.destino_id` real, y
// ese id prevalece sobre `null` para el mismo nombre.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("destinosPorcionPublica — la unión real de destinos de Porción terrestre", () => {
  test("el caso que motivó el cambio: SIN ninguna fila persona, un destino que sólo existe por hotel unidad SIGUE apareciendo, con su id", () => {
    const destinos = destinosPorcionPublica(
      [], // ni una fila persona en todo el tarifario
      [{ tipo: "porcion_terrestre", destinoNombre: "CARTAGENA", destinoId: 6 }]
    );
    assert.deepEqual(destinos, [{ id: 6, nombre: "CARTAGENA" }]);
  });

  test("con un catálogo mixto devuelve la UNIÓN: persona + unidad, deduplicada y ordenada, con el id de la oferta unidad cuando existe", () => {
    const destinos = destinosPorcionPublica(
      [
        { modulo: "porcion_terrestre", destino_nombre: "SANTA MARTA" },
        { modulo: "porcion_terrestre", destino_nombre: "CARTAGENA" },
        { modulo: "porcion_terrestre", destino_nombre: "CARTAGENA" }, // repetido entre paquetes
      ],
      [
        { tipo: "porcion_terrestre", destinoNombre: "CARTAGENA", destinoId: 6 }, // ya venía por persona (sin id) — el id de unidad prevalece
        { tipo: "porcion_terrestre", destinoNombre: "SAN ANDRES", destinoId: 7 }, // sólo unidad
      ]
    );
    // Deduplicado (CARTAGENA una sola vez) y ordenado de forma estable.
    assert.deepEqual(destinos, [
      { id: 6, nombre: "CARTAGENA" },
      { id: 7, nombre: "SAN ANDRES" },
      { id: null, nombre: "SANTA MARTA" },
    ]);
  });

  test("un destino SOLO persona (sin ninguna oferta unidad) queda con id null — nunca se inventa uno", () => {
    const destinos = destinosPorcionPublica(
      [{ modulo: "porcion_terrestre", destino_nombre: "SANTA MARTA" }],
      []
    );
    assert.deepEqual(destinos, [{ id: null, nombre: "SANTA MARTA" }]);
  });

  test("una oferta unidad SIN destinoId (paquete sin destino configurado) no rompe nada: queda id null, igual que una fila persona", () => {
    const destinos = destinosPorcionPublica(
      [],
      [{ tipo: "porcion_terrestre", destinoNombre: "CARTAGENA", destinoId: null }]
    );
    assert.deepEqual(destinos, [{ id: null, nombre: "CARTAGENA" }]);
  });

  test("sólo mezcla lo que corresponde: ni filas de otro módulo ni ofertas de otro tipo", () => {
    const destinos = destinosPorcionPublica(
      [
        { modulo: "bloqueo", destino_nombre: "NO DEBE SALIR (bloqueo)" },
        { modulo: "servicios", destino_nombre: "NO DEBE SALIR (receptivos)" },
        { modulo: "porcion_terrestre", destino_nombre: "SANTA MARTA" },
      ],
      [
        { tipo: "bloqueo", destinoNombre: "NO DEBE SALIR (unidad de bloqueo)", destinoId: 99 },
        { tipo: "porcion_terrestre", destinoNombre: "CARTAGENA", destinoId: 6 },
      ]
    );
    assert.deepEqual(destinos, [
      { id: 6, nombre: "CARTAGENA" },
      { id: null, nombre: "SANTA MARTA" },
    ]);
  });

  test("un destino sin nombre no abre una opción vacía en el desplegable", () => {
    const destinos = destinosPorcionPublica(
      [
        { modulo: "porcion_terrestre", destino_nombre: null },
        { modulo: "porcion_terrestre", destino_nombre: "" },
        { modulo: "porcion_terrestre", destino_nombre: "CARTAGENA" },
      ],
      [
        { tipo: "porcion_terrestre", destinoNombre: null },
        { tipo: "porcion_terrestre", destinoNombre: "" },
      ]
    );
    assert.deepEqual(destinos, [{ id: null, nombre: "CARTAGENA" }]);
  });

  test("sin catálogo devuelve la lista vacía (nunca `undefined` ni una opción fantasma)", () => {
    assert.deepEqual(destinosPorcionPublica([], []), []);
  });

  test("no muta las entradas (el orden del catálogo del servidor no se toca)", () => {
    const filas = [
      { modulo: "porcion_terrestre", destino_nombre: "SANTA MARTA" },
      { modulo: "porcion_terrestre", destino_nombre: "CARTAGENA" },
    ];
    const hoteles = [{ tipo: "porcion_terrestre", destinoNombre: "SAN ANDRES", destinoId: 7 }];
    destinosPorcionPublica(filas, hoteles);
    assert.deepEqual(filas.map((f) => f.destino_nombre), ["SANTA MARTA", "CARTAGENA"]);
    assert.deepEqual(hoteles.map((h) => h.destinoNombre), ["SAN ANDRES"]);
  });

  test("tolera las dos formas reales de entrada: la fila de resumen del tarifario y la oferta descubierta de Bernalo", () => {
    // Las que recibe `VistaBooking` de verdad, con las columnas que traen de
    // más (una fila de `FilaTarifario`/`FilaResumen` no es "sólo módulo y
    // destino"): la función tipa por lo mínimo que necesita, así que el exceso
    // de columnas no participa ni estorba.
    const filas = [{ paqueteId: 7, hotelId: 3, modulo: "porcion_terrestre", destino_nombre: "CARTAGENA", neto: 0 }];
    const hoteles = [{ paqueteId: 9, hotelId: 4, tipo: "porcion_terrestre", destinoNombre: "SAN ANDRES", destinoId: 7, hotelNombre: "X" }];
    const destinos = destinosPorcionPublica(filas, hoteles);
    assert.deepEqual(destinos, [
      { id: null, nombre: "CARTAGENA" },
      { id: 7, nombre: "SAN ANDRES" },
    ]);
    assert.ok(destinos.every((d) => typeof d.nombre === "string" && d.nombre.trim() !== ""));
  });

  test("`VistaBooking` NO re-implementa el filtro: delega en esta función como única fuente", () => {
    const fuenteVista = readFileSync(join(raiz, "app/tarifario/VistaBooking.tsx"), "utf8");
    assert.match(fuenteVista, /import \{ destinosPorcionPublica \} from "@\/lib\/tarifario\/destinosPorcion";/);
    assert.match(
      fuenteVista,
      /const destinosPorcion = useMemo\(\s*\n\s*\(\) => destinosPorcionPublica\(filas, hotelesBernalo\),\s*\n\s*\[filas, hotelesBernalo\]\s*\n\s*\);/
    );
    // Ni la lista vieja sólo-persona ni una segunda copia del `.filter()` a mano.
    const codigoVista = fuenteVista
      .split(/\r?\n/)
      .filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*/.test(l))
      .join("\n");
    assert.doesNotMatch(codigoVista, /destinosBuscador/);
    const filtrosInline = [...codigoVista.matchAll(/\.filter\(\(f\) => f\.modulo === "porcion_terrestre" && f\.destino_nombre\)/g)].length;
    assert.equal(filtrosInline, 0, "el filtro del catálogo persona vive sólo en destinosPorcionPublica");
  });
});
