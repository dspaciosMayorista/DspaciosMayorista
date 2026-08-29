import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compactarFilasTarifario,
  deserializarTarifarioCompacto,
  descompactarFilasTarifario,
  serializarTarifarioCompacto,
  type FilaTarifarioCompactable,
  type TarifarioCompactoSerializado,
} from "../lib/tarifario/compacto.ts";

function fila(id: number): FilaTarifarioCompactable {
  return {
    modulo: id % 2 ? "bloqueo" : "porcion_terrestre",
    bloqueo_label: "Salida Medellin",
    bloqueo_id: 8,
    empaquetado_id: null,
    salida_id: null,
    paquete_id: 20,
    hotel_id: 30,
    fecha_ida: "2026-12-01",
    fecha_regreso: "2026-12-05",
    noches: 4,
    destino_nombre: "Cartagena",
    paquete_nombre: "Caribe",
    hotel_nombre: "Hotel Centro",
    servicio_id: null,
    servicio_nombre: null,
    tipo_tarifa: null,
    pax_desde: null,
    pax_hasta: null,
    categoria: "Estandar",
    regimen: "PC",
    acomodacion: id % 2 ? "doble" : "triple",
    precio_pvp: 500000 + id,
    descripcion: null,
    recargo_individual: 0,
    moneda: "COP",
  };
}

test("round-trip conserva todas las filas y campos", () => {
  const originales = [fila(1), fila(2)];
  assert.deepEqual(
    descompactarFilasTarifario(compactarFilasTarifario(originales)),
    originales
  );
});

test("17.197 filas repetitivas reducen el JSON sin perder datos", () => {
  const originales = Array.from({ length: 17197 }, (_, i) => fila(i));
  const compacto = compactarFilasTarifario(originales);
  const bytesOriginal = Buffer.byteLength(JSON.stringify(originales));
  const bytesCompacto = Buffer.byteLength(JSON.stringify(compacto));
  assert.ok(bytesCompacto < bytesOriginal * 0.35, `${bytesCompacto} debe ser <35% de ${bytesOriginal}`);
  assert.deepEqual(descompactarFilasTarifario(compacto), originales);
});

test("la tabla de textos deduplica valores repetidos", () => {
  const compacto = compactarFilasTarifario([fila(1), fila(2), fila(3)]);
  assert.equal(compacto.textos.filter((x) => x === "Hotel Centro").length, 1);
  assert.equal(compacto.textos.filter((x) => x === "Cartagena").length, 1);
});

test("el bloque serializado conserva byte a byte el catalogo compacto", () => {
  const originales = Array.from({ length: 200 }, (_, i) => fila(i));
  const compacto = compactarFilasTarifario(originales);
  const serializado = serializarTarifarioCompacto(compacto);
  assert.equal(serializado, JSON.stringify(compacto));
  assert.deepEqual(
    descompactarFilasTarifario(deserializarTarifarioCompacto(serializado)),
    originales
  );
});

test("el bloque serializado falla cerrado ante una forma desconocida", () => {
  assert.throws(
    () => deserializarTarifarioCompacto('{"version":2,"textos":[],"filas":[]}' as TarifarioCompactoSerializado),
    /invalido/
  );
  assert.throws(
    () => deserializarTarifarioCompacto("null" as TarifarioCompactoSerializado),
    /invalido/
  );
});
