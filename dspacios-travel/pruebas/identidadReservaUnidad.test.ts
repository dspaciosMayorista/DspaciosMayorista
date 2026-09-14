import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  claveBusquedaUnidad,
  claveReservaUnidad,
  revalidarReservaUnidad,
  MENSAJE_ERROR_REVALIDACION,
  type IdentidadReservaUnidadEntrada,
  type CotizarUnidadFn,
} from "../lib/tarifario/identidadReservaUnidad.ts";
import type { OpcionUnidadConfirmada } from "../lib/tarifario/evaluarDisponibilidadUnidad.ts";

// ─────────────────────────────────────────────────────────────────────────
// Pruebas EJECUTABLES (no wiring) de los tres helpers puros de la tarjeta
// unidad en modo búsqueda — los hallazgos finales de la auditoría:
//   1. `claveBusquedaUnidad`  → identidad de la BÚSQUEDA (key de React que
//      remonta la tarjeta, reseteando su estado, cuando cambian fechas/
//      ocupación/combos).
//   2. `claveReservaUnidad`   → identidad canónica COMPLETA de la reserva
//      (lo que compara `enCarrito`).
//   3. `revalidarReservaUnidad` → revalidación server-side que NUNCA lanza
//      (rechazo/error no agregan; libera el flujo).
// ─────────────────────────────────────────────────────────────────────────

function opcion(over: Partial<OpcionUnidadConfirmada> = {}): OpcionUnidadConfirmada {
  return {
    hotelId: 216,
    hotelNombre: "Hotel Prueba Odair",
    paqueteId: 501,
    paqueteNombre: "Porción San Andrés",
    destinoNombre: "SAN ANDRÉS",
    categoria: "Estandar",
    alimentacion: "PC",
    moneda: "COP",
    precioVenta: 500_000,
    paxTotal: 2,
    fechaIda: "2026-12-01",
    fechaRegreso: "2026-12-04",
    ocupacion: [{ id: "doble-0", acom: "doble", adultos: 2, edadesMenores: [] }],
    ...over,
  };
}

// ── 1) claveBusquedaUnidad — key de remonte ────────────────────────────────
describe("claveBusquedaUnidad — identidad de la búsqueda vigente (key de React que remonta y resetea)", () => {
  test("una búsqueda idéntica (mismas fechas, ocupación y combos) produce la MISMA clave — no remonta sin motivo", () => {
    const a = [opcion(), opcion({ categoria: "Superior", precioVenta: 700_000 })];
    const b = [opcion(), opcion({ categoria: "Superior", precioVenta: 700_000 })];
    assert.equal(claveBusquedaUnidad(a), claveBusquedaUnidad(b));
  });

  test("el orden en que llegan las combinaciones no cambia la clave (se ordenan) — mismo conjunto ⇒ misma clave", () => {
    const a = [opcion(), opcion({ categoria: "Superior", precioVenta: 700_000 })];
    const b = [opcion({ categoria: "Superior", precioVenta: 700_000 }), opcion()];
    assert.equal(claveBusquedaUnidad(a), claveBusquedaUnidad(b));
  });

  test("NUEVA búsqueda, mismo hotel/combinación pero FECHAS distintas → clave distinta (la tarjeta remonta y no reutiliza precioActualizado/estado)", () => {
    const dic = [opcion()];
    const ene = [opcion({ fechaIda: "2027-01-10", fechaRegreso: "2027-01-13" })];
    assert.notEqual(claveBusquedaUnidad(dic), claveBusquedaUnidad(ene));
  });

  test("misma combinación pero OCUPACIÓN distinta (otras habitaciones/edades) → clave distinta (remonta, no reutiliza estado)", () => {
    const dosAdultos = [opcion()];
    const conMenor = [opcion({ ocupacion: [{ id: "doble-0", acom: "doble", adultos: 2, edadesMenores: [7] }] })];
    const otraHab = [opcion({ ocupacion: [{ id: "triple-0", acom: "triple", adultos: 3, edadesMenores: [] }] })];
    assert.notEqual(claveBusquedaUnidad(dosAdultos), claveBusquedaUnidad(conMenor));
    assert.notEqual(claveBusquedaUnidad(dosAdultos), claveBusquedaUnidad(otraHab));
  });

  test("el CONJUNTO de combinaciones confirmadas distinto (una combinación dejó de estar disponible) → clave distinta", () => {
    const dos = [opcion(), opcion({ categoria: "Superior", precioVenta: 700_000 })];
    const una = [opcion()];
    assert.notEqual(claveBusquedaUnidad(dos), claveBusquedaUnidad(una));
  });

  test("lista vacía no lanza (no debería llegar, pero es robusto)", () => {
    assert.equal(claveBusquedaUnidad([]), "vacia");
  });

  // ── Residual corregido: el dato público COTIZADO (precio/moneda/pax) ahora
  // participa en la clave — antes solo se comparaba paqueteId/categoría/
  // alimentación, así que una búsqueda idéntica que ya había recibido un
  // precio revalidado distinto (`precioActualizado`) producía la MISMA clave
  // que la original: el remonte no ocurría y el precio viejo podía sobrevivir.

  test("misma búsqueda y MISMA combinación (mismo paquete/categoría/alimentación), pero precioVenta distinto → clave distinta", () => {
    const original = [opcion({ precioVenta: 500_000 })];
    const revalidada = [opcion({ precioVenta: 560_000 })];
    assert.notEqual(claveBusquedaUnidad(original), claveBusquedaUnidad(revalidada));
  });

  test("misma búsqueda y misma combinación, pero MONEDA distinta → clave distinta", () => {
    const cop = [opcion({ moneda: "COP" })];
    const usd = [opcion({ moneda: "USD" })];
    assert.notEqual(claveBusquedaUnidad(cop), claveBusquedaUnidad(usd));
  });

  test("misma búsqueda y misma combinación, pero paxTotal distinto → clave distinta", () => {
    const dosPax = [opcion({ paxTotal: 2 })];
    const tresPax = [opcion({ paxTotal: 3 })];
    assert.notEqual(claveBusquedaUnidad(dosPax), claveBusquedaUnidad(tresPax));
  });

  test("opciones IDÉNTICAS (incluido su dato cotizado) en orden diferente → MISMA clave", () => {
    const barata = opcion({ paqueteId: 501, categoria: "Estandar", precioVenta: 500_000, moneda: "COP", paxTotal: 2 });
    const cara = opcion({ paqueteId: 502, categoria: "Superior", precioVenta: 700_000, moneda: "COP", paxTotal: 2 });
    const ordenA = [barata, cara];
    const ordenB = [cara, barata];
    assert.equal(claveBusquedaUnidad(ordenA), claveBusquedaUnidad(ordenB));
  });

  test("una búsqueda COMPLETAMENTE idéntica (hotel, fechas, ocupación y cada campo cotizado de cada opción) → MISMA clave", () => {
    const a = [
      opcion({ paqueteId: 501, categoria: "Estandar", alimentacion: "PC", precioVenta: 500_000, moneda: "COP", paxTotal: 2 }),
      opcion({ paqueteId: 502, categoria: "Superior", alimentacion: "PAM", precioVenta: 700_000, moneda: "COP", paxTotal: 2 }),
    ];
    const b = [
      opcion({ paqueteId: 501, categoria: "Estandar", alimentacion: "PC", precioVenta: 500_000, moneda: "COP", paxTotal: 2 }),
      opcion({ paqueteId: 502, categoria: "Superior", alimentacion: "PAM", precioVenta: 700_000, moneda: "COP", paxTotal: 2 }),
    ];
    assert.equal(claveBusquedaUnidad(a), claveBusquedaUnidad(b));
  });
});

// ── 2) claveReservaUnidad — identidad de carrito ───────────────────────────
describe("claveReservaUnidad — identidad canónica COMPLETA (lo que compara enCarrito)", () => {
  const base: IdentidadReservaUnidadEntrada = {
    hotelId: 216,
    paqueteId: 501,
    categoria: "Estandar",
    alimentacion: "PC",
    salida: { tipo: "sin_vuelo", fechaIda: "2026-12-01", fechaRegreso: "2026-12-04" },
    habitaciones: [{ id: "doble-0", acom: "doble", adultos: 2, edadesMenores: [] }],
  };

  test("identidad EXACTAMENTE igual ⇒ misma clave (enCarrito la encuentra y permite quitar el ítem)", () => {
    // Un ítem del carrito trae `edadesMenores` como `unknown` (aquí number[]),
    // el candidato como number[] — ambos deben canonicalizar igual.
    const enCarrito: IdentidadReservaUnidadEntrada = { ...base, habitaciones: [{ id: "doble-0", acom: "doble", adultos: 2, edadesMenores: [] }] };
    assert.equal(claveReservaUnidad(base), claveReservaUnidad(enCarrito));
  });

  test("carrito con reserva en FECHAS A no coincide con una búsqueda en FECHAS B (no se marca agregada ni se elimina por error)", () => {
    const fechasA = base;
    const fechasB: IdentidadReservaUnidadEntrada = { ...base, salida: { tipo: "sin_vuelo", fechaIda: "2027-03-01", fechaRegreso: "2027-03-05" } };
    assert.notEqual(claveReservaUnidad(fechasA), claveReservaUnidad(fechasB));
  });

  test("diferencia en EDADES de menores produce identidad distinta", () => {
    const sinMenor = base;
    const conMenor: IdentidadReservaUnidadEntrada = { ...base, habitaciones: [{ id: "doble-0", acom: "doble", adultos: 2, edadesMenores: [7] }] };
    const otraEdad: IdentidadReservaUnidadEntrada = { ...base, habitaciones: [{ id: "doble-0", acom: "doble", adultos: 2, edadesMenores: [9] }] };
    assert.notEqual(claveReservaUnidad(sinMenor), claveReservaUnidad(conMenor));
    assert.notEqual(claveReservaUnidad(conMenor), claveReservaUnidad(otraEdad));
  });

  test("diferencia en HABITACIONES (tipo/cantidad/adultos) produce identidad distinta", () => {
    const doble = base;
    const triple: IdentidadReservaUnidadEntrada = { ...base, habitaciones: [{ id: "triple-0", acom: "triple", adultos: 3, edadesMenores: [] }] };
    const dosHab: IdentidadReservaUnidadEntrada = {
      ...base,
      habitaciones: [
        { id: "doble-0", acom: "doble", adultos: 2, edadesMenores: [] },
        { id: "doble-1", acom: "doble", adultos: 2, edadesMenores: [] },
      ],
    };
    assert.notEqual(claveReservaUnidad(doble), claveReservaUnidad(triple));
    assert.notEqual(claveReservaUnidad(doble), claveReservaUnidad(dosHab));
  });

  test("diferencia en paquete / categoría / alimentación produce identidad distinta (cada campo cuenta)", () => {
    assert.notEqual(claveReservaUnidad(base), claveReservaUnidad({ ...base, paqueteId: 502 }));
    assert.notEqual(claveReservaUnidad(base), claveReservaUnidad({ ...base, categoria: "Superior" }));
    assert.notEqual(claveReservaUnidad(base), claveReservaUnidad({ ...base, alimentacion: "PAM" }));
  });

  test("las edades dentro de una habitación se comparan como CONJUNTO (mismo par de edades en otro orden ⇒ misma reserva)", () => {
    const ab: IdentidadReservaUnidadEntrada = { ...base, habitaciones: [{ id: "triple-0", acom: "triple", adultos: 2, edadesMenores: [5, 8] }] };
    const ba: IdentidadReservaUnidadEntrada = { ...base, habitaciones: [{ id: "triple-0", acom: "triple", adultos: 2, edadesMenores: [8, 5] }] };
    assert.equal(claveReservaUnidad(ab), claveReservaUnidad(ba));
  });

  test("`edadesMenores` no numéricas (unknown desde el carrito) no rompen: se descartan sin lanzar", () => {
    const limpio: IdentidadReservaUnidadEntrada = { ...base, habitaciones: [{ id: "doble-0", acom: "doble", adultos: 2, edadesMenores: [7] }] };
    const sucio: IdentidadReservaUnidadEntrada = { ...base, habitaciones: [{ id: "doble-0", acom: "doble", adultos: 2, edadesMenores: [7, null, "x", undefined] }] };
    // El `7` sobrevive; los no-numéricos se descartan → misma clave que [7].
    assert.equal(claveReservaUnidad(sucio), claveReservaUnidad(limpio));
  });
});

// ── 3) revalidarReservaUnidad — server-side, nunca lanza ───────────────────
describe("revalidarReservaUnidad — revalidación server-side que NUNCA lanza", () => {
  const entrada = {
    paqueteId: 501, hotelId: 216, categoria: "Estandar", alimentacion: "PC",
    salida: { tipo: "sin_vuelo" as const, fechaIda: "2026-12-01", fechaRegreso: "2026-12-04" },
    habitaciones: [{ id: "doble-0", acom: "doble", adultos: 2, cantidadMenores: 0, edadesMenores: [] }],
  };

  test("ok con MISMO precio → estado 'agregar', precioCambio false", async () => {
    const cotizar: CotizarUnidadFn = async () => ({ ok: true, pvp: 500_000, moneda: "COP" });
    const r = await revalidarReservaUnidad(cotizar, entrada, 500_000, "COP");
    assert.deepEqual(r, { estado: "agregar", precio: 500_000, moneda: "COP", precioCambio: false });
  });

  test("ok con precio DISTINTO (tarifa cambió) → estado 'agregar', precioCambio true, con el precio REVALIDADO", async () => {
    const cotizar: CotizarUnidadFn = async () => ({ ok: true, pvp: 560_000, moneda: "COP" });
    const r = await revalidarReservaUnidad(cotizar, entrada, 500_000, "COP");
    assert.deepEqual(r, { estado: "agregar", precio: 560_000, moneda: "COP", precioCambio: true });
  });

  test("cambio de MONEDA también marca precioCambio", async () => {
    const cotizar: CotizarUnidadFn = async () => ({ ok: true, pvp: 500_000, moneda: "USD" });
    const r = await revalidarReservaUnidad(cotizar, entrada, 500_000, "COP");
    assert.equal(r.estado, "agregar");
    if (r.estado === "agregar") assert.equal(r.precioCambio, true);
  });

  test("servidor rechaza (ok:false) → estado 'rechazo' con el mensaje REAL — nunca 'agregar'", async () => {
    const cotizar: CotizarUnidadFn = async () => ({ ok: false, mensaje: "Este hotel ya no está disponible para esas fechas." });
    const r = await revalidarReservaUnidad(cotizar, entrada, 500_000, "COP");
    assert.deepEqual(r, { estado: "rechazo", mensaje: "Este hotel ya no está disponible para esas fechas." });
  });

  test("PROMESA RECHAZADA (excepción de red/servidor) → estado 'error', NUNCA lanza y NUNCA 'agregar' — el llamador no agrega y su finally libera la carga", async () => {
    const cotizar: CotizarUnidadFn = async () => { throw new Error("network down"); };
    let lanzo = false;
    let r: Awaited<ReturnType<typeof revalidarReservaUnidad>> | null = null;
    try {
      r = await revalidarReservaUnidad(cotizar, entrada, 500_000, "COP");
    } catch {
      lanzo = true;
    }
    assert.equal(lanzo, false, "revalidarReservaUnidad NUNCA debe propagar la excepción");
    assert.deepEqual(r, { estado: "error", mensaje: MENSAJE_ERROR_REVALIDACION });
  });

  test("una función que rechaza de forma síncrona (Promise.reject) tampoco lanza", async () => {
    const cotizar: CotizarUnidadFn = () => Promise.reject(new Error("boom"));
    const r = await revalidarReservaUnidad(cotizar, entrada, 500_000, "COP");
    assert.equal(r.estado, "error");
  });

  test("solo se lee pvp/moneda/mensaje del resultado — un ok con campos extra (paxTotal, etc.) no filtra nada al resultado del helper", async () => {
    const cotizar: CotizarUnidadFn = async () => ({ ok: true, pvp: 500_000, moneda: "COP", paxTotal: 2, promedioPorViajero: 250_000 } as unknown as { ok: true; pvp: number; moneda: string });
    const r = await revalidarReservaUnidad(cotizar, entrada, 500_000, "COP");
    assert.deepEqual(Object.keys(r).sort(), ["estado", "moneda", "precio", "precioCambio"]);
  });
});
