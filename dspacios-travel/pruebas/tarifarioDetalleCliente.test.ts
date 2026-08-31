import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { claveDetalleHotel, claveDetalleSalida, claveDetallePaquete, conCacheDetalle } from "../lib/tarifario/detalleCliente.ts";
import type { ComboIdentidad } from "../lib/tarifario/comboKey.ts";

// EJECUCIÓN REAL de `claveDetalleHotel()`/`claveDetalleSalida()`/
// `claveDetallePaquete()`/`conCacheDetalle()` — la caché de detalle bajo
// demanda del cliente, y el ALCANCE DE COMBOS (ronda 6, ítem 2 — generaliza
// la revisión anterior, que solo protegía contra un alcance de
// origen/destino/salida distinto, y solo para el submódulo Bloqueo) que
// protege contra reutilizar el detalle de un hotel/salida/paquete bajo
// CUALQUIER filtro activo distinto (búsqueda, categoría, régimen, origen/
// destino/salida elegida).

function combo(overrides: Partial<ComboIdentidad> = {}): ComboIdentidad {
  return {
    modulo: "bloqueo", paquete_id: 1, bloqueo_id: 10, salida_id: null, hotel_id: 7,
    categoria: "Estandar", regimen: "PC", fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", moneda: "COP",
    ...overrides,
  };
}

describe("claveDetalleHotel() — normaliza el alcance de combos en la clave de caché", () => {
  test("porcion_terrestre: alcance vacío da una clave estable", () => {
    assert.equal(claveDetalleHotel("porcion_terrestre", 7, []), "hotel:porcion_terrestre:7:");
  });
  test("bloqueo: incluye los combos en la clave (normalizados)", () => {
    const c1 = claveDetalleHotel("bloqueo", 7, [combo({ bloqueo_id: 30 }), combo({ bloqueo_id: 10 }), combo({ bloqueo_id: 20 })]);
    assert.match(c1, /^hotel:bloqueo:7:/);
    assert.ok(c1.length > "hotel:bloqueo:7:".length, "el alcance no vacío debe aportar algo a la clave");
  });
  test("bloqueo: el ORDEN de entrada no importa — mismo alcance, misma clave", () => {
    const a = combo({ bloqueo_id: 10 }), b = combo({ bloqueo_id: 20 }), c = combo({ bloqueo_id: 30 });
    assert.equal(claveDetalleHotel("bloqueo", 7, [a, b, c]), claveDetalleHotel("bloqueo", 7, [c, b, a]));
  });
  test("bloqueo: combos duplicados (misma clave estructural) no cambian la clave final", () => {
    const a = combo({ bloqueo_id: 10 });
    const aRepetido = combo({ bloqueo_id: 10 }); // mismo contenido, objeto distinto
    const b = combo({ bloqueo_id: 20 });
    assert.equal(claveDetalleHotel("bloqueo", 7, [a, aRepetido, b]), claveDetalleHotel("bloqueo", 7, [a, b]));
  });
  test("bloqueo: alcance vacío es distinto de cualquier alcance no vacío", () => {
    const vacio = claveDetalleHotel("bloqueo", 7, []);
    assert.equal(vacio, "hotel:bloqueo:7:");
    assert.notEqual(vacio, claveDetalleHotel("bloqueo", 7, [combo({ bloqueo_id: 1 })]));
  });
  test("⚠️ prueba negativa central del defecto: cambiar de alcance (otra salida) para el MISMO hotel produce una clave DISTINTA", () => {
    const claveSalidaA = claveDetalleHotel("bloqueo", 42, [combo({ bloqueo_id: 101 })]);
    const claveSalidaB = claveDetalleHotel("bloqueo", 42, [combo({ bloqueo_id: 202 })]);
    assert.notEqual(claveSalidaA, claveSalidaB, "abrir el mismo hotel bajo una salida distinta no puede compartir clave de caché");
  });
  test("⚠️ ronda 6: cambiar SOLO categoría (mismo bloqueo/hotel) produce una clave DISTINTA — la revisión anterior no cubría esto", () => {
    const claveCatA = claveDetalleHotel("bloqueo", 42, [combo({ bloqueo_id: 101, categoria: "Estandar" })]);
    const claveCatB = claveDetalleHotel("bloqueo", 42, [combo({ bloqueo_id: 101, categoria: "Suite" })]);
    assert.notEqual(claveCatA, claveCatB, "un filtro de categoría distinto no puede compartir clave de caché");
  });
  test("⚠️ ronda 6: cambiar SOLO régimen produce una clave DISTINTA", () => {
    const claveA = claveDetalleHotel("bloqueo", 42, [combo({ regimen: "PC" })]);
    const claveB = claveDetalleHotel("bloqueo", 42, [combo({ regimen: "PAM" })]);
    assert.notEqual(claveA, claveB);
  });
  test("⚠️ ronda 6: porcion_terrestre TAMBIÉN incorpora el alcance de combos (antes era una clave fija sin alcance)", () => {
    const claveA = claveDetalleHotel("porcion_terrestre", 42, [combo({ modulo: "porcion_terrestre", bloqueo_id: null, categoria: "Estandar" })]);
    const claveB = claveDetalleHotel("porcion_terrestre", 42, [combo({ modulo: "porcion_terrestre", bloqueo_id: null, categoria: "Suite" })]);
    assert.notEqual(claveA, claveB, "porcion_terrestre debe distinguir categorías igual que bloqueo");
  });
  test("hoteles distintos bajo el mismo alcance de combos producen claves distintas", () => {
    assert.notEqual(claveDetalleHotel("bloqueo", 1, [combo({ bloqueo_id: 101 })]), claveDetalleHotel("bloqueo", 2, [combo({ bloqueo_id: 101 })]));
  });
  test("módulos distintos para el mismo hotel producen claves distintas", () => {
    assert.notEqual(claveDetalleHotel("bloqueo", 5, []), claveDetalleHotel("porcion_terrestre", 5, []));
  });
});

describe("claveDetalleSalida() / claveDetallePaquete() — Vista tabla también incorpora el alcance de combos (ronda 6, ítem 2)", () => {
  test("claveDetalleSalida: id estructural igual pero combos distintos ⇒ claves distintas", () => {
    const a = claveDetalleSalida("bloqueo", 5, [combo({ bloqueo_id: 5, categoria: "Estandar" })]);
    const b = claveDetalleSalida("bloqueo", 5, [combo({ bloqueo_id: 5, categoria: "Suite" })]);
    assert.notEqual(a, b, "la ronda anterior usaba `salida:bloqueo:${id}` a secas — sin alcance, esto colisionaría");
  });
  test("claveDetalleSalida: dinamico usa salida_id, no bloqueo_id", () => {
    const a = claveDetalleSalida("dinamico", 9, [combo({ modulo: "dinamico", bloqueo_id: null, salida_id: 9 })]);
    assert.match(a, /^salida:dinamico:9:/);
  });
  test("claveDetalleSalida: alcance vacío distinto de no vacío", () => {
    assert.notEqual(claveDetalleSalida("bloqueo", 5, []), claveDetalleSalida("bloqueo", 5, [combo({ bloqueo_id: 5 })]));
  });
  test("claveDetallePaquete: id estructural igual pero combos distintos ⇒ claves distintas", () => {
    const a = claveDetallePaquete(3, [combo({ modulo: "porcion_terrestre", bloqueo_id: null, paquete_id: 3, categoria: "Estandar" })]);
    const b = claveDetallePaquete(3, [combo({ modulo: "porcion_terrestre", bloqueo_id: null, paquete_id: 3, categoria: "Suite" })]);
    assert.notEqual(a, b, "la ronda anterior usaba `paquete:${id}` a secas — sin alcance, esto colisionaría");
  });
  test("claveDetallePaquete: paquetes distintos producen claves distintas bajo el mismo combo", () => {
    const c = combo({ modulo: "porcion_terrestre", bloqueo_id: null, paquete_id: 3 });
    assert.notEqual(claveDetallePaquete(3, [c]), claveDetallePaquete(4, [c]));
  });
});

describe("conCacheDetalle() — dedup + reutilización + nunca cachea un fallo (con claves reales de claveDetalleHotel)", () => {
  test("⚠️ prueba negativa: una respuesta cacheada bajo el alcance A nunca se sirve para el alcance B del mismo hotel", async () => {
    let llamadas = 0;
    const claveA = claveDetalleHotel("bloqueo", 9, [combo({ bloqueo_id: 1 })]);
    const claveB = claveDetalleHotel("bloqueo", 9, [combo({ bloqueo_id: 2 })]);
    const cargar = (etiqueta: string) => async () => {
      llamadas++;
      return { ok: true as const, filas: [etiqueta] };
    };
    const ra = await conCacheDetalle(claveA, cargar("A"));
    const rb = await conCacheDetalle(claveB, cargar("B"));
    assert.deepEqual(ra, { ok: true, filas: ["A"] });
    assert.deepEqual(rb, { ok: true, filas: ["B"] });
    assert.equal(llamadas, 2, "alcances distintos nunca comparten la promesa/resultado cacheado");
  });

  test("dedup: dos llamadas concurrentes con la MISMA clave (mismo alcance) reutilizan la misma promesa", async () => {
    let llamadas = 0;
    const clave = claveDetalleHotel("bloqueo", 55, [combo({ bloqueo_id: 1 }), combo({ bloqueo_id: 2 })]) + ":dedup-test";
    let resolver: (v: { ok: true; filas: string[] }) => void = () => {};
    const pendiente = new Promise<{ ok: true; filas: string[] }>((res) => { resolver = res; });
    const cargar = () => { llamadas++; return pendiente; };
    const p1 = conCacheDetalle(clave, cargar);
    const p2 = conCacheDetalle(clave, cargar);
    resolver({ ok: true, filas: ["x"] });
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(llamadas, 1, "la segunda llamada con la misma clave no dispara una consulta nueva mientras la primera está en vuelo");
    assert.deepEqual(r1, r2);
  });

  test("nunca cachea un fallo: ok:false permite reintentar de verdad", async () => {
    let llamadas = 0;
    const clave = claveDetalleHotel("bloqueo", 77, [combo({ bloqueo_id: 3 })]) + ":fallo-test";
    const cargar = async () => { llamadas++; return { ok: false as const, error: "boom" }; };
    await conCacheDetalle(clave, cargar);
    await conCacheDetalle(clave, cargar);
    assert.equal(llamadas, 2, "un ok:false nunca se sirve desde caché — cada intento vuelve a llamar");
  });
});
