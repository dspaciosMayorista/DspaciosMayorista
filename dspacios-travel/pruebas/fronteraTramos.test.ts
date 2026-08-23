import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parsearNumeroContrato,
  parsearNota,
  parsearEstadoEmisionInput,
  parsearIdTramo,
  parsearDireccionTramo,
  parsearTextoTramo,
  parsearTramo,
  parsearTramos,
  validarTramos,
  esObjetoPlano,
  oNull,
  ESTADOS_EMISION_VALIDOS,
  MAX_NUMERO_CONTRATO,
  MAX_NOTA,
} from "../app/(dashboard)/dashboard/vuelos/frontera-tramos.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

// ───────────────────────────────────────────────────────────────────────────
// Frontera de tipos del editor de vuelos del contrato (revisión adicional
// del PR #270): validarTramos()/oNull() asumían que numeroContrato/tramos ya
// venían con la forma de TypeScript declarada — pero una Server Action se
// invoca con lo que sea que llegue en el cuerpo de la petición HTTP, y una
// llamada manipulada (no el cliente TS de esta app) puede mandar null, un
// objeto, un número donde se esperaba texto. Sin blindaje, eso llega a
// `.length`/`.trim()`/`.map()` sin comprobar tipo primero y lanza un
// TypeError real (500), en vez del error de negocio controlado que da
// Postgres. Este archivo importa DIRECTO frontera-tramos.ts (módulo puro,
// sin "use server" ni imports de Supabase) para ejecutar la validación de
// verdad, no solo inspeccionar el texto del archivo.
// ───────────────────────────────────────────────────────────────────────────

describe("parsearNumeroContrato — nunca confía en que sea string", () => {
  test("string válido dentro del límite se acepta", () => {
    assert.equal(parsearNumeroContrato("77-0001"), "77-0001");
  });

  test("null se rechaza sin lanzar", () => {
    assert.doesNotThrow(() => parsearNumeroContrato(null));
    assert.equal(parsearNumeroContrato(null), null);
  });

  test("undefined se rechaza sin lanzar", () => {
    assert.equal(parsearNumeroContrato(undefined), null);
  });

  test("un objeto se rechaza sin lanzar (nunca intenta leer .length de un objeto como si fuera string)", () => {
    assert.doesNotThrow(() => parsearNumeroContrato({ malicioso: true }));
    assert.equal(parsearNumeroContrato({ malicioso: true }), null);
  });

  test("un número se rechaza sin lanzar", () => {
    assert.equal(parsearNumeroContrato(12345), null);
  });

  test("un arreglo se rechaza sin lanzar", () => {
    assert.equal(parsearNumeroContrato(["77-0001"]), null);
  });

  test("string vacío se rechaza", () => {
    assert.equal(parsearNumeroContrato(""), null);
  });

  test(`string más largo que MAX_NUMERO_CONTRATO (${MAX_NUMERO_CONTRATO}) se rechaza`, () => {
    assert.equal(parsearNumeroContrato("X".repeat(MAX_NUMERO_CONTRATO + 1)), null);
  });
});

describe("parsearNota — nunca confía en que sea string", () => {
  test("null/undefined se aceptan como nota vacía", () => {
    assert.deepEqual(parsearNota(null), { ok: true, nota: "" });
    assert.deepEqual(parsearNota(undefined), { ok: true, nota: "" });
  });

  test("un arreglo se rechaza sin lanzar", () => {
    assert.doesNotThrow(() => parsearNota(["nota"]));
    assert.deepEqual(parsearNota(["nota"]), { ok: false });
  });

  test("un objeto se rechaza sin lanzar", () => {
    assert.doesNotThrow(() => parsearNota({ texto: "x" }));
    assert.deepEqual(parsearNota({ texto: "x" }), { ok: false });
  });

  test(`una nota más larga que MAX_NOTA (${MAX_NOTA}) se rechaza`, () => {
    assert.deepEqual(parsearNota("x".repeat(MAX_NOTA + 1)), { ok: false });
  });

  test("una nota string válida se acepta", () => {
    assert.deepEqual(parsearNota("referencia"), { ok: true, nota: "referencia" });
  });
});

describe("parsearEstadoEmisionInput — nunca confía en que sea string", () => {
  test("un objeto se rechaza sin lanzar", () => {
    assert.doesNotThrow(() => parsearEstadoEmisionInput({ estado: "emitido" }));
    assert.deepEqual(parsearEstadoEmisionInput({ estado: "emitido" }), { ok: false });
  });

  test("null/''/undefined se aceptan como 'Por confirmar' (valor vacío)", () => {
    assert.deepEqual(parsearEstadoEmisionInput(null), { ok: true, valor: "" });
    assert.deepEqual(parsearEstadoEmisionInput(""), { ok: true, valor: "" });
    assert.deepEqual(parsearEstadoEmisionInput(undefined), { ok: true, valor: "" });
  });

  test("un valor fuera del dominio se rechaza", () => {
    assert.deepEqual(parsearEstadoEmisionInput("cancelado"), { ok: false });
  });

  test("un número se rechaza sin lanzar", () => {
    assert.deepEqual(parsearEstadoEmisionInput(123), { ok: false });
  });

  test("los valores reales del dominio se aceptan", () => {
    for (const v of ESTADOS_EMISION_VALIDOS) {
      assert.deepEqual(parsearEstadoEmisionInput(v), { ok: true, valor: v });
    }
  });
});

describe("ESTADOS_EMISION_VALIDOS no diverge de lib/vuelos/control.ts (guarda contra drift)", () => {
  test("el arreglo espejo coincide EXACTO con ESTADOS_EMISION real", () => {
    const src = leer("lib/vuelos/control.ts");
    const m = src.match(/export const ESTADOS_EMISION: EstadoEmision\[\] = \[([^\]]*)\];/);
    assert.ok(m, "no se encontró la declaración real de ESTADOS_EMISION en lib/vuelos/control.ts");
    const valoresReales = m![1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
    assert.deepEqual([...ESTADOS_EMISION_VALIDOS], valoresReales);
  });
});

describe("parsearIdTramo — bigint positivo seguro, nunca decimal/NaN/Infinity/unsafe", () => {
  test("null/undefined se aceptan como id ausente", () => {
    assert.deepEqual(parsearIdTramo(null), { ok: true, id: null });
    assert.deepEqual(parsearIdTramo(undefined), { ok: true, id: null });
  });

  test("un entero positivo válido se acepta", () => {
    assert.deepEqual(parsearIdTramo(42), { ok: true, id: 42 });
  });

  test("decimal se rechaza sin lanzar", () => {
    assert.doesNotThrow(() => parsearIdTramo(1.5));
    assert.deepEqual(parsearIdTramo(1.5), { ok: false });
  });

  test("NaN se rechaza sin lanzar", () => {
    assert.deepEqual(parsearIdTramo(NaN), { ok: false });
  });

  test("Infinity se rechaza sin lanzar", () => {
    assert.deepEqual(parsearIdTramo(Infinity), { ok: false });
    assert.deepEqual(parsearIdTramo(-Infinity), { ok: false });
  });

  test("entero fuera del rango seguro (unsafe integer) se rechaza", () => {
    assert.deepEqual(parsearIdTramo(Number.MAX_SAFE_INTEGER + 2), { ok: false });
  });

  test("cero y negativos se rechazan", () => {
    assert.deepEqual(parsearIdTramo(0), { ok: false });
    assert.deepEqual(parsearIdTramo(-5), { ok: false });
  });

  test("un string numérico ('5') se rechaza — debe ser number, nunca texto", () => {
    assert.deepEqual(parsearIdTramo("5"), { ok: false });
  });

  test("un objeto/array se rechaza sin lanzar", () => {
    assert.deepEqual(parsearIdTramo({}), { ok: false });
    assert.deepEqual(parsearIdTramo([1]), { ok: false });
  });
});

describe("parsearDireccionTramo", () => {
  test("null/undefined/'' se aceptan como sin dirección", () => {
    assert.deepEqual(parsearDireccionTramo(null), { ok: true, direccion: "" });
    assert.deepEqual(parsearDireccionTramo(undefined), { ok: true, direccion: "" });
    assert.deepEqual(parsearDireccionTramo(""), { ok: true, direccion: "" });
  });
  test("'ida'/'regreso' se aceptan", () => {
    assert.deepEqual(parsearDireccionTramo("ida"), { ok: true, direccion: "ida" });
    assert.deepEqual(parsearDireccionTramo("regreso"), { ok: true, direccion: "regreso" });
  });
  test("un valor arbitrario o un número se rechaza sin lanzar", () => {
    assert.deepEqual(parsearDireccionTramo("lateral"), { ok: false });
    assert.deepEqual(parsearDireccionTramo(123), { ok: false });
  });
});

describe("parsearTextoTramo", () => {
  test("null/undefined se aceptan como texto vacío", () => {
    assert.deepEqual(parsearTextoTramo(null), { ok: true, valor: "" });
  });
  test("un número/boolean/array/objeto se rechaza sin lanzar (nunca se le llama .trim())", () => {
    assert.deepEqual(parsearTextoTramo(123), { ok: false });
    assert.deepEqual(parsearTextoTramo(true), { ok: false });
    assert.deepEqual(parsearTextoTramo([1, 2]), { ok: false });
    assert.deepEqual(parsearTextoTramo({ x: 1 }), { ok: false });
  });
});

describe("parsearTramo — objeto completo con campos mixtos", () => {
  test("elemento null se rechaza sin lanzar (nunca intenta leer .id de null)", () => {
    assert.doesNotThrow(() => parsearTramo(null));
    const r = parsearTramo(null);
    assert.equal(r.ok, false);
  });

  test("elemento que es un arreglo (no un objeto plano) se rechaza", () => {
    const r = parsearTramo([1, 2, 3]);
    assert.equal(r.ok, false);
  });

  test("aerolinea número se rechaza sin lanzar", () => {
    const r = parsearTramo({ aerolinea: 123 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /aerolinea/);
  });

  test("record boolean se rechaza sin lanzar", () => {
    const r = parsearTramo({ record: true });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /record/);
  });

  test("fecha objeto se rechaza sin lanzar (nunca intenta leer .trim() de un objeto)", () => {
    const r = parsearTramo({ fecha: { y: 2026 } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /fecha/);
  });

  test("un tramo válido con id/direccion/textos correctos se acepta", () => {
    const r = parsearTramo({ id: 7, aerolinea: "Avianca", direccion: "ida", numeroVuelo: "AV100" });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.tramo.id, 7);
      assert.equal(r.tramo.aerolinea, "Avianca");
      assert.equal(r.tramo.direccion, "ida");
      assert.equal(r.tramo.numeroVuelo, "AV100");
      // Campos ausentes del payload se normalizan a "" — nunca undefined.
      assert.equal(r.tramo.record, "");
    }
  });
});

describe("parsearTramos — el arreglo completo, nunca confía en su forma", () => {
  test("tramos null se rechaza sin lanzar (nunca intenta leer .length de null)", () => {
    assert.doesNotThrow(() => parsearTramos(null));
    const r = parsearTramos(null);
    assert.equal(r.ok, false);
  });

  test("tramos undefined se rechaza sin lanzar", () => {
    assert.doesNotThrow(() => parsearTramos(undefined));
    assert.equal(parsearTramos(undefined).ok, false);
  });

  test("tramos objeto (no arreglo) se rechaza sin lanzar", () => {
    assert.doesNotThrow(() => parsearTramos({ 0: { aerolinea: "X" } }));
    assert.equal(parsearTramos({ 0: { aerolinea: "X" } }).ok, false);
  });

  test("tramos número/string se rechaza sin lanzar", () => {
    assert.equal(parsearTramos(42).ok, false);
    assert.equal(parsearTramos("no soy un arreglo").ok, false);
  });

  test("un elemento null dentro de un arreglo real se rechaza sin lanzar", () => {
    assert.doesNotThrow(() => parsearTramos([{ aerolinea: "X" }, null]));
    assert.equal(parsearTramos([{ aerolinea: "X" }, null]).ok, false);
  });

  test("un arreglo de tramos válidos se acepta completo", () => {
    const r = parsearTramos([{ aerolinea: "X", direccion: "ida" }, { id: 3, record: "PNR1" }]);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.tramos.length, 2);
  });
});

describe("validarTramos — ya recibe TramoInput[] bien tipado (mirror de negocio)", () => {
  test("nunca lanza contra un arreglo vacío", () => {
    assert.doesNotThrow(() => validarTramos([]));
    assert.match(validarTramos([]) ?? "", /al menos un tramo/);
  });
});

describe("esObjetoPlano / oNull — utilidades base", () => {
  test("esObjetoPlano distingue objeto plano de null/array/primitivos", () => {
    assert.equal(esObjetoPlano({}), true);
    assert.equal(esObjetoPlano(null), false);
    assert.equal(esObjetoPlano([]), false);
    assert.equal(esObjetoPlano("x"), false);
    assert.equal(esObjetoPlano(5), false);
  });

  test("oNull nunca lanza contra un string vacío o con solo espacios", () => {
    assert.equal(oNull(""), null);
    assert.equal(oNull("   "), null);
    assert.equal(oNull(" x "), "x");
  });
});
