import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { claveDetalleHotel, conCacheDetalle } from "../lib/tarifario/detalleCliente.ts";

// EJECUCIÓN REAL de `claveDetalleHotel()`/`conCacheDetalle()` — la caché de
// detalle bajo demanda del cliente, y el ALCANCE que protege contra
// reutilizar el detalle de un hotel bajo un filtro de origen/destino/salida
// distinto (revisión posterior, defecto "no preserva el alcance activo al
// abrir un hotel").

describe("claveDetalleHotel() — normaliza el alcance en la clave de caché", () => {
  test("porcion_terrestre: clave estable, sin alcance", () => {
    assert.equal(claveDetalleHotel("porcion_terrestre", 7), "hotel:porcion_terrestre:7");
  });
  test("bloqueo: incluye los bloqueoIds ordenados en la clave", () => {
    assert.equal(claveDetalleHotel("bloqueo", 7, [30, 10, 20]), "hotel:bloqueo:7:10,20,30");
  });
  test("bloqueo: el ORDEN de entrada no importa — mismo alcance, misma clave", () => {
    assert.equal(claveDetalleHotel("bloqueo", 7, [10, 20, 30]), claveDetalleHotel("bloqueo", 7, [30, 20, 10]));
  });
  test("bloqueo: duplicados no cambian la clave", () => {
    assert.equal(claveDetalleHotel("bloqueo", 7, [10, 10, 20]), claveDetalleHotel("bloqueo", 7, [10, 20]));
  });
  test("bloqueo: sin bloqueoIds (undefined) es un alcance vacío distinto de cualquier alcance no vacío", () => {
    const vacio = claveDetalleHotel("bloqueo", 7);
    assert.equal(vacio, "hotel:bloqueo:7:");
    assert.notEqual(vacio, claveDetalleHotel("bloqueo", 7, [1]));
  });
  test("⚠️ prueba negativa central del defecto: cambiar de alcance (otra salida/filtro) para el MISMO hotel produce una clave DISTINTA", () => {
    const claveSalidaA = claveDetalleHotel("bloqueo", 42, [101]);
    const claveSalidaB = claveDetalleHotel("bloqueo", 42, [202]);
    assert.notEqual(claveSalidaA, claveSalidaB, "abrir el mismo hotel bajo una salida distinta no puede compartir clave de caché");
  });
  test("hoteles distintos bajo el mismo alcance producen claves distintas", () => {
    assert.notEqual(claveDetalleHotel("bloqueo", 1, [101]), claveDetalleHotel("bloqueo", 2, [101]));
  });
  test("módulos distintos para el mismo hotel producen claves distintas", () => {
    assert.notEqual(claveDetalleHotel("bloqueo", 5, []), claveDetalleHotel("porcion_terrestre", 5));
  });
});

describe("conCacheDetalle() — dedup + reutilización + nunca cachea un fallo (con claves reales de claveDetalleHotel)", () => {
  test("⚠️ prueba negativa: una respuesta cacheada bajo el alcance A nunca se sirve para el alcance B del mismo hotel", async () => {
    let llamadas = 0;
    const claveA = claveDetalleHotel("bloqueo", 9, [1]);
    const claveB = claveDetalleHotel("bloqueo", 9, [2]);
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
    const clave = claveDetalleHotel("bloqueo", 55, [1, 2]) + ":dedup-test";
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
    const clave = claveDetalleHotel("bloqueo", 77, [3]) + ":fallo-test";
    const cargar = async () => { llamadas++; return { ok: false as const, error: "boom" }; };
    await conCacheDetalle(clave, cargar);
    await conCacheDetalle(clave, cargar);
    assert.equal(llamadas, 2, "un ok:false nunca se sirve desde caché — cada intento vuelve a llamar");
  });
});
