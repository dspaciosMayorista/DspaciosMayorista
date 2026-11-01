import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { composicionDeManifiesto, idsIncluidos } from "../lib/tarifario/composicionManifiesto.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("composición de la 258 en el manifiesto (paquete tipo 73: servicio 112 incluido + asistencia opcional)", () => {
  const servicios = [{ servicio_id: 112, incluido: true }, { servicio_id: 90, incluido: false }, { servicio_id: 7, incluido: true }];

  test("solo los incluidos, únicos y ascendentes; los opcionales no entran", () => {
    assert.deepEqual(idsIncluidos(servicios), [7, 112]);
    assert.deepEqual(idsIncluidos([...servicios, { servicio_id: 112, incluido: true }]), [7, 112]);
    assert.deepEqual(idsIncluidos([{ servicio_id: 5, incluido: null }]), []);
  });

  test("un incluido omitido en esa estadía (256) no se hornea: la fecha queda con composición vacía, NO ausente", () => {
    const porFecha = new Map<string, number[]>();
    const cubiertas = new Set(["2026-12-01", "2026-12-08", "2026-12-15"]);
    for (let d = 1; d <= 19; d++) {
      const f = `2026-12-${String(d).padStart(2, "0")}`;
      porFecha.set(f, idsIncluidos(servicios, cubiertas.has(f) ? new Set() : new Set([112])));
    }
    const filas = composicionDeManifiesto(porFecha);
    assert.equal(filas.length, 19, "una fila por fecha de ida: el activador exige la fecha, no que traiga servicios");
    assert.equal(filas.filter((x) => x.servicios_incluidos.includes(112)).length, 3);
    assert.deepEqual(filas.find((x) => x.fecha_ida === "2026-12-02")?.servicios_incluidos, [7]);
  });

  test("determinista: el orden en que se generaron las fechas no cambia el manifiesto (reanudar recalcula las mismas filas)", () => {
    const a = composicionDeManifiesto(new Map([["2026-12-09", [112, 7]], ["2026-12-01", [7, 112, 7]]]));
    const b = composicionDeManifiesto(new Map([["2026-12-01", [112, 7]], ["2026-12-09", [7, 112]]]));
    assert.deepEqual(a, b);
    assert.deepEqual(a.map((x) => x.fecha_ida), ["2026-12-01", "2026-12-09"]);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  test("la acción pasa al manifiesto la regla de la 258 (REGLA_COMPOSICION_PUBLICADA), sin constante propia", () => {
    const acciones = readFileSync(join(raiz, "app", "(dashboard)", "dashboard", "paquetes", "actions.ts"), "utf8");
    assert.match(acciones, /regla: REGLA_COMPOSICION_PUBLICADA,/);
  });
});
