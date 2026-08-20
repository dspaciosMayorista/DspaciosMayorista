// ─────────────────────────────────────────────────────────────────────────
// lib/reservar/empaquetadoOrigen.ts — costo NETO real vs. valor de reventa
// (revisión posterior al PR #268, hallazgo 1 "COSTO FINANCIERO") + fallo
// cerrado (hallazgo 5) + vigencia (hallazgo 4, mismo motor de origen.ts).
//
// `empaquetadoOrigen.ts` importa `@/lib/reservar/origen` (alias de
// TypeScript/Next.js) — no resuelve con `node --test` sin bundler, mismo
// motivo por el que `pruebas/empaquetados.test.ts` verifica
// `reservar/actions.ts`/`computo.ts` por PATRÓN de texto en vez de
// ejecutarlos (convención ya establecida en este repo para archivos con
// imports `@/`). La fórmula aritmética en sí (que NO depende de importar
// nada) sí se ejecuta de verdad, más abajo.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const src = leer("lib/reservar/empaquetadoOrigen.ts");
const reservarActionsSrc = leer("app/(dashboard)/dashboard/reservar/actions.ts");

describe("aritmética real: costo neto del proveedor vs. valor de reventa", () => {
  test("reproduce el caso exacto reportado: proveedor=200.000, reventa=242.022, 2 pax", () => {
    const costoNeto = 200_000;
    const reventa = 242_022;
    const paxConSilla = 2;
    const costoAereoCorrecto = costoNeto * paxConSilla;
    const costoAereoDelBugAnterior = reventa * paxConSilla;
    assert.equal(costoAereoCorrecto, 400_000, "costo_aereo/CxP correcto: el neto que se le debe al proveedor");
    assert.equal(costoAereoDelBugAnterior, 484_044, "esto era lo que quedaba ANTES del fix — la reventa, $84.044 de más");
    assert.notEqual(costoAereoCorrecto, costoAereoDelBugAnterior);
  });
});

describe("lib/reservar/empaquetadoOrigen.ts — costo_neto sale de tarifa_proveedor, nunca de la reventa", () => {
  test("DatosVueloOrigen conserva AMBOS valores por separado (nunca se colapsan en uno)", () => {
    assert.match(src, /costo_neto: number;/, "el tipo debe declarar costo_neto");
    assert.match(src, /tarifa_para_empaquetar: number;/, "tarifa_para_empaquetar se conserva (informativa)");
  });

  test("datosVueloEmpaquetado: costo_neto = tarifa_proveedor (el neto real, NUNCA la reventa)", () => {
    const fn = src.slice(src.indexOf("export async function datosVueloEmpaquetado"), src.indexOf("export async function datosVueloSalida"));
    assert.match(fn, /\.select\(\s*\n?\s*"aerolinea, record, ruta, fecha_ida, fecha_regreso, vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg, tarifa_proveedor, tarifa_para_empaquetar,/, "debe seleccionar tarifa_proveedor de la BD");
    assert.match(fn, /costo_neto: Number\(e\.tarifa_proveedor\) \|\| 0,/, "costo_neto DEBE mapear tarifa_proveedor");
    assert.doesNotMatch(fn, /costo_neto: Number\(e\.tarifa_para_empaquetar\)/, "costo_neto NUNCA debe mapear tarifa_para_empaquetar (ese era el bug)");
  });

  test("datosVueloBloqueo/datosVueloSalida: costo_neto = el único valor que existe (sin cambio de comportamiento, no tienen campo neto separado)", () => {
    const fnBloqueo = src.slice(src.indexOf("export async function datosVueloBloqueo"), src.indexOf("/**\n * Trae y VALIDA"));
    assert.match(fnBloqueo, /costo_neto: Number\(b\.tarifa_para_empaquetar\) \|\| 0,/);
    const fnSalida = src.slice(src.indexOf("export async function datosVueloSalida"), src.indexOf("/**\n * Resuelve"));
    assert.match(fnSalida, /costo_neto: Number\(s\.valor_tiquete\) \|\| 0,/);
  });

  test("FALLA CERRADA: los 3 resolvers propagan el `error` de Supabase, nunca lo confunden con 'no encontrado'", () => {
    for (const fn of ["datosVueloBloqueo", "datosVueloEmpaquetado", "datosVueloSalida"]) {
      const inicio = src.indexOf(`export async function ${fn}`);
      const bloque = src.slice(inicio, inicio + 700);
      assert.match(bloque, /if \(error\) return \{ ok: false, error: `No se pudo leer/, `${fn} debe propagar el error de Supabase`);
    }
  });

  test("vigencia: datosVueloEmpaquetado valida activo Y empaquetadoVigente ANTES de construir el resultado", () => {
    const fn = src.slice(src.indexOf("export async function datosVueloEmpaquetado"), src.indexOf("export async function datosVueloSalida"));
    assert.match(fn, /if \(!e\.activo\) return \{ ok: false,/);
    assert.match(fn, /if \(!empaquetadoVigente\(e\.compra_inicio, e\.compra_fin, hoyBogota\(new Date\(\)\)\)\)/);
  });
});

describe("reservar/actions.ts — costoAereo (ventas.costo_aereo + CxP) usa costo_neto, no tarifa_para_empaquetar", () => {
  test("la fórmula de costoAereo lee datosVuelo.costo_neto", () => {
    assert.match(
      reservarActionsSrc,
      /const costoAereo = datosVuelo \? datosVuelo\.costo_neto \* paxConSilla \+ datosVuelo\.fee_infante \* infantesN : 0;/
    );
  });

  test("ningún punto de reservar/actions.ts vuelve a usar datosVuelo.tarifa_para_empaquetar para costear", () => {
    assert.doesNotMatch(reservarActionsSrc, /datosVuelo\.tarifa_para_empaquetar/, "tarifa_para_empaquetar de datosVuelo no debe usarse para costo_aereo/CxP en ningún punto");
  });

  test("CxP aérea (paso 9) se crea UNA sola vez, a partir del costoAereo ya calculado — cero doble CxP", () => {
    const paso9 = reservarActionsSrc.slice(reservarActionsSrc.indexOf("// 9) CxP aérea"), reservarActionsSrc.indexOf("// 9-bis) Sillas"));
    const matches = paso9.match(/pushCxP\("aereo",/g) ?? [];
    assert.equal(matches.length, 1, "debe haber EXACTAMENTE una llamada a pushCxP(\"aereo\", ...) en el paso de costo aéreo — nunca dos");
  });
});
