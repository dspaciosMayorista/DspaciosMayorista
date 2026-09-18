import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  conPrioridadOptimista,
  sinPrioridadOptimista,
  reconciliarPrioridades,
  prioridadEfectivaDe,
  prioridadesOcupadasDe,
  type FilaPrioridadServidor,
} from "../lib/tarifario/prioridadOptimista.ts";

// ─────────────────────────────────────────────────────────────────────────
// Autosave optimista de "hotel recomendado": la reconciliación con las props
// del servidor es PURA, así que la secuencia completa se prueba con ejecución
// real (el componente solo la cablea).
// ─────────────────────────────────────────────────────────────────────────

const fila = (hotel_id: number, prioridad: number | null): FilaPrioridadServidor => ({ hotel_id, prioridad });

describe("Secuencia servidor=null → optimista=1 → servidor=1 → servidor=2 (el final debe ser 2)", () => {
  test("el valor viejo 1 NO sobrevive cuando el servidor pasa a 2", () => {
    const HOTEL = 7;

    // 1) El servidor todavía no tiene prioridad.
    let overrides = new Map<number, number | null>();
    const servidor: number | null = null;
    assert.equal(prioridadEfectivaDe(overrides, HOTEL, servidor), null);

    // 2) El usuario elige 1 → optimista.
    overrides = conPrioridadOptimista(overrides, HOTEL, 1);
    assert.equal(prioridadEfectivaDe(overrides, HOTEL, servidor), 1, "se ve 1 al instante, sin esperar al servidor");

    // 3) Llegan props con el valor ya confirmado (1) → el override se ELIMINA.
    const props1 = [fila(HOTEL, 1)];
    overrides = reconciliarPrioridades(overrides, props1);
    assert.equal(overrides.size, 0, "el override reconocido se elimina realmente del mapa");
    assert.equal(prioridadEfectivaDe(overrides, HOTEL, 1), 1, "el valor sigue visible, ahora por el servidor");

    // 4) Llegan props con otro valor (2) → gana el dato fresco.
    const props2 = [fila(HOTEL, 2)];
    overrides = reconciliarPrioridades(overrides, props2);
    assert.equal(overrides.size, 0);
    assert.equal(prioridadEfectivaDe(overrides, HOTEL, 2), 2, "el resultado final es 2, nunca el override viejo 1");
  });

  test("mientras el guardado está en vuelo el optimista manda (aunque el servidor todavía diga otra cosa)", () => {
    const HOTEL = 7;
    let overrides = conPrioridadOptimista(new Map(), HOTEL, 3);
    // Props viejas (un refresh anterior a nuestro guardado) traen 1: NO deben
    // pisar el optimista vigente.
    overrides = reconciliarPrioridades(overrides, [fila(HOTEL, 1)]);
    assert.equal(overrides.size, 1, "un valor distinto NO descarta el override: podría ser una respuesta vieja");
    assert.equal(prioridadEfectivaDe(overrides, HOTEL, 1), 3);
  });

  test("el mismo valor en OTRO hotel no descarta el override (la identidad es por hotel)", () => {
    let overrides = conPrioridadOptimista(new Map(), 7, 1);
    overrides = reconciliarPrioridades(overrides, [fila(7, null), fila(8, 1)]);
    assert.equal(overrides.size, 1);
    assert.equal(prioridadEfectivaDe(overrides, 7, null), 1);
  });
});

describe("Guardado FALLIDO — el override se elimina, nunca se deja un valor de reversión", () => {
  const HOTEL = 7;

  test("OBLIGATORIO: servidor=null → optimista=1 → el guardado falla → override eliminado → servidor=2 ⇒ el valor efectivo es 2", () => {
    let overrides = new Map<number, number | null>();

    // 1) El servidor no tiene prioridad para este hotel.
    assert.equal(prioridadEfectivaDe(overrides, HOTEL, null), null);

    // 2) El usuario elige 1 → optimista.
    overrides = conPrioridadOptimista(overrides, HOTEL, 1);
    assert.equal(prioridadEfectivaDe(overrides, HOTEL, null), 1);

    // 3) El guardado FALLA → se ELIMINA el override (no se "revierte" a un
    //    valor local, que sería indistinguible de un guardado en vuelo).
    overrides = sinPrioridadOptimista(overrides, HOTEL);
    assert.equal(overrides.size, 0, "el override desaparece por completo");
    assert.equal(prioridadEfectivaDe(overrides, HOTEL, null), null, "sin override, manda el servidor: sigue sin prioridad");

    // 4) El servidor entrega 2 (dato fresco recuperado con el refresh) → gana.
    assert.equal(prioridadEfectivaDe(overrides, HOTEL, 2), 2, "el valor fresco 2 no puede quedar tapado por el 1 fallido");
  });

  test("un override con el valor viejo NUNCA se reconocería: por eso el fallo lo elimina en vez de dejarlo", () => {
    // Si el fallo dejara `override = valorAnterior`, la reconciliación solo lo
    // descartaría cuando el servidor trajera ESE MISMO valor. Con un valor
    // distinto, el override quedaría vigente para siempre tapando el dato real.
    const conReversion = conPrioridadOptimista(new Map(), 7, 1); // "reversión" al 1 viejo
    const trasServidor2 = reconciliarPrioridades(conReversion, [{ hotel_id: 7, prioridad: 2 }]);
    assert.equal(trasServidor2.size, 1, "el override viejo sobrevive a un valor distinto…");
    assert.equal(prioridadEfectivaDe(trasServidor2, 7, 2), 1, "…y tapa el dato fresco (esto es lo que el fallo debe evitar)");

    // Con la corrección (eliminar en el fallo), el mismo escenario da 2.
    const corregido = sinPrioridadOptimista(conReversion, 7);
    assert.equal(prioridadEfectivaDe(reconciliarPrioridades(corregido, [{ hotel_id: 7, prioridad: 2 }]), 7, 2), 2);
  });

  test("eliminar es puro: no muta el mapa de entrada", () => {
    const original = conPrioridadOptimista(new Map(), 7, 1);
    const copia = new Map(original);
    const resultado = sinPrioridadOptimista(original, 7);
    assert.equal(original.size, 1, "el mapa original queda intacto");
    assert.deepEqual([...original.entries()], [...copia.entries()]);
    assert.equal(resultado.size, 0);
    assert.notEqual(resultado, original, "devuelve un mapa NUEVO");
  });

  test("eliminar un hotel que no tiene override devuelve el MISMO mapa (sin trabajo ni re-render)", () => {
    const overrides = conPrioridadOptimista(new Map(), 7, 1);
    assert.equal(sinPrioridadOptimista(overrides, 99), overrides);
  });

  test("eliminar solo afecta al hotel indicado; los demás overrides siguen", () => {
    let overrides = conPrioridadOptimista(new Map(), 7, 1);
    overrides = conPrioridadOptimista(overrides, 8, 2);
    const r = sinPrioridadOptimista(overrides, 7);
    assert.deepEqual([...r.entries()], [[8, 2]]);
  });

  test("tras eliminar, las prioridades ocupadas vuelven a salir del servidor", () => {
    const overrides = sinPrioridadOptimista(conPrioridadOptimista(new Map(), 7, 4), 7);
    assert.deepEqual([...prioridadesOcupadasDe(overrides, [fila(7, 1)]).entries()], [[7, 1]]);
  });
});

describe("Reconciliación — cuándo se descarta un override", () => {
  test("se descarta cuando el servidor trae ESE MISMO valor (reconocido)", () => {
    const overrides = conPrioridadOptimista(new Map(), 7, 4);
    assert.equal(reconciliarPrioridades(overrides, [fila(7, 4)]).size, 0);
  });

  test("se descarta cuando el servidor confirma NULL (desmarcar)", () => {
    const overrides = conPrioridadOptimista(new Map(), 7, null);
    assert.equal(reconciliarPrioridades(overrides, [fila(7, null)]).size, 0);
  });

  test("se descarta cuando la fila desaparece de las props (hotel desasociado) — y re-asociarlo NO resucita la prioridad local vieja", () => {
    // El usuario marca 1, el servidor lo confirma…
    let overrides = conPrioridadOptimista(new Map(), 7, 1);
    overrides = reconciliarPrioridades(overrides, [fila(7, 1)]);
    assert.equal(overrides.size, 0);
    // …y ahora desmarca el hotel (la fila sale de `armado_hoteles`, así que no
    // aparece en las props) mientras había un override pendiente de otra fila.
    overrides = conPrioridadOptimista(overrides, 8, 2);
    const sinFila8 = reconciliarPrioridades(overrides, [fila(7, 1)]);
    assert.equal(sinFila8.size, 0, "la fila ausente se descarta");
    // Al re-asociar, el servidor trae NULL (fila nueva): no puede aparecer el 2 viejo.
    const trasReasociar = reconciliarPrioridades(sinFila8, [fila(7, 1), fila(8, null)]);
    assert.equal(trasReasociar.size, 0);
    assert.equal(prioridadEfectivaDe(trasReasociar, 8, null), null, "re-asociar no resucita una prioridad local anterior");
  });

  test("un override pendiente de la fila desasociada se descarta aunque el servidor no traiga la fila (misma pasada)", () => {
    const overrides = conPrioridadOptimista(new Map(), 8, 5);
    assert.equal(reconciliarPrioridades(overrides, [fila(7, 1)]).size, 0);
  });

  test("devuelve el MISMO mapa cuando no hay nada que descartar (evita re-render y setState inútil)", () => {
    const overrides = conPrioridadOptimista(new Map(), 7, 3);
    const despues = reconciliarPrioridades(overrides, [fila(7, 1)]);
    assert.equal(despues, overrides, "identidad conservada: nada cambió");
  });

  test("mapa vacío: no hace trabajo ni cambia de identidad", () => {
    const vacio = new Map<number, number | null>();
    assert.equal(reconciliarPrioridades(vacio, [fila(7, 1)]), vacio);
  });

  test("varios overrides a la vez: se descartan solo los reconocidos o ausentes", () => {
    let overrides = conPrioridadOptimista(new Map(), 7, 1);
    overrides = conPrioridadOptimista(overrides, 8, 2);
    overrides = conPrioridadOptimista(overrides, 9, 3);
    const r = reconciliarPrioridades(overrides, [fila(7, 1), fila(8, null), fila(10, 1)]);
    assert.deepEqual([...r.keys()], [8], "7 se reconoció, 9 desapareció, 8 sigue pendiente");
    assert.equal(r.get(8), 2);
  });
});

describe("Prioridades ocupadas con valores efectivos", () => {
  test("la prioridad recién elegida queda ocupada de inmediato para los demás hoteles", () => {
    const overrides = conPrioridadOptimista(new Map(), 7, 2);
    const ocupadas = prioridadesOcupadasDe(overrides, [fila(7, null), fila(8, 1)]);
    assert.deepEqual([...ocupadas.entries()].sort(), [[7, 2], [8, 1]]);
  });

  test("no incluye las que no tienen prioridad (ni local ni del servidor)", () => {
    const ocupadas = prioridadesOcupadasDe(new Map(), [fila(7, null), fila(8, 3)]);
    assert.deepEqual([...ocupadas.entries()], [[8, 3]]);
  });

  test("desmarcar en local libera la prioridad de inmediato", () => {
    const overrides = conPrioridadOptimista(new Map(), 7, null);
    const ocupadas = prioridadesOcupadasDe(overrides, [fila(7, 3)]);
    assert.equal(ocupadas.size, 0, "mientras el guardado de NULL está en vuelo, la prioridad ya se ve libre");
  });

  test("tras la reconciliación, las ocupadas salen del servidor (sin overrides viejos)", () => {
    let overrides = conPrioridadOptimista(new Map(), 7, 5);
    overrides = reconciliarPrioridades(overrides, [fila(7, 5), fila(8, 1)]);
    assert.deepEqual([...prioridadesOcupadasDe(overrides, [fila(7, 5), fila(8, 1)]).entries()].sort(), [[7, 5], [8, 1]]);
  });
});
