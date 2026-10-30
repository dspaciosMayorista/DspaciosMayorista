// Payload de publicación compacto: mismo contenido, menos bytes.
//   node --test --experimental-strip-types pruebas/filasPublicacion259.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compactarFilasPublicacion } from "../lib/tarifario/filasPublicacion.ts";

describe("compactarFilasPublicacion", () => {
  test("quita null y undefined, conserva 0, false y cadena vacía", () => {
    const [f] = compactarFilasPublicacion([{ a: null, b: undefined, c: 0, d: false, e: "", f: "x", g: 12.5, h: [1], i: { k: null } }]);
    assert.deepEqual(f, { c: 0, d: false, e: "", f: "x", g: 12.5, h: [1], i: { k: null } });
    assert.equal(Object.hasOwn(f, "a"), false);
    assert.equal(Object.hasOwn(f, "b"), false);
  });

  test("no muta la entrada ni cambia el orden de las filas", () => {
    const entrada = [{ id: 1, x: null }, { id: 2, x: 5 }, { id: 3, x: null }];
    const copia = structuredClone(entrada);
    const salida = compactarFilasPublicacion(entrada);
    assert.deepEqual(entrada, copia);
    assert.deepEqual(salida.map((s) => s.id), [1, 2, 3]);
  });

  test("equivalencia para el servidor: `f.v->>'clave'` da lo mismo con la clave ausente que con null, para TODAS las claves de TODAS las filas", () => {
    const filas = Array.from({ length: 500 }, (_, i) => ({
      paquete_id: 73, modulo: i % 50 === 0 ? "servicios" : "bloqueo", bloqueo_id: i % 50 === 0 ? null : 3000 + (i % 32), servicio_id: i % 50 === 0 ? 9 : null,
      hotel_id: i % 50 === 0 ? null : 2000 + (i % 28), precio_pvp: 1000 + i, precio_pvp_menor2: i % 7 >= 4 ? 300 : null, descripcion: null,
      es_promocion: false, procedencia_temporadas: i % 50 === 0 ? null : [{ temporada: "ALTA", es_promocion: false, precio_final_autoritativo: false }],
      procedencia_mixta: false, impuesto: 0,
    }));
    const salida = compactarFilasPublicacion(filas);
    for (let i = 0; i < filas.length; i++) {
      for (const k of Object.keys(filas[i]) as (keyof (typeof filas)[number])[]) {
        const original = filas[i][k] ?? null;
        const enviado = (salida[i] as Record<string, unknown>)[k as string] ?? null;
        assert.deepEqual(enviado, original, `fila ${i}, clave ${String(k)}`);
      }
    }
  });

  test("con filas parecidas a las del 73 el cuerpo pesa claramente menos", () => {
    const fila = (i: number) => ({
      paquete_id: 73, paquete_nombre: "Paquete", paquete_activo: true, modulo: "bloqueo", bloqueo_id: 3000 + (i % 32), bloqueo_label: "BOG-CTG", empaquetado_id: null,
      hotel_id: 2000 + (i % 28), hotel_nombre: "Hotel", servicio_id: null, servicio_nombre: null, destino_id: 1, destino_nombre: "CARTAGENA", categoria: "Std",
      regimen: "PAM", acomodacion: "doble", noches: 3, fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", pax_desde: null, pax_hasta: null, tipo_tarifa: null,
      base_comisionable: 1, impuesto: 1, precio_pvp: 1, precio_pvp_menor2: null, descripcion: null, recargo_individual: null, moneda: "COP", salida_id: null,
      temporada_ganadora: "ALTA", es_promocion: false, precio_final_autoritativo: false, procedencia_temporadas: null, procedencia_mixta: false,
    });
    const filas = Array.from({ length: 1000 }, (_, i) => fila(i));
    const antes = JSON.stringify(filas).length;
    const despues = JSON.stringify(compactarFilasPublicacion(filas)).length;
    assert.ok(despues < antes * 0.85, `esperaba al menos −15 %: ${antes} → ${despues}`);
  });
});

describe("cableado en generarTarifario (código fuente)", () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
  const codigo = readFileSync(join(raiz, "app/(dashboard)/dashboard/paquetes/actions.ts"), "utf8").replace(/\r\n/g, "\n");
  test("las DOS rutas de publicación (base y 63) envían el payload compacto, calculado una sola vez desde `filas`", () => {
    assert.equal((codigo.match(/const filasPublicar = compactarFilasPublicacion\(filas\);/g) ?? []).length, 1);
    const i = codigo.indexOf('sb.rpc("publicar_tarifario_resultado_63"');
    const j = codigo.indexOf('sb.rpc("publicar_tarifario_resultado"', i);
    assert.ok(i > 0 && j > i);
    assert.match(codigo.slice(i, i + 400), /p_filas: filasPublicar as unknown as Json/);
    assert.match(codigo.slice(j, j + 400), /p_filas: filasPublicar as unknown as Json/);
  });
  test("ningún envío a esas RPC usa ya `filas` crudo", () => {
    const desde = codigo.indexOf("const filasPublicar = compactarFilasPublicacion(filas);");
    const hasta = codigo.indexOf("if (ePublicar)", desde);
    assert.doesNotMatch(codigo.slice(desde, hasta), /p_filas: filas as unknown as Json/);
  });
});
