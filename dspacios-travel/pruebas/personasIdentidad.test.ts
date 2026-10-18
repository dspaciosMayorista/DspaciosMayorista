import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cabeOriginal,
  dvNitValido,
  ErrorEntradaDocumento,
  esRepresentable,
  normalizarDocumento,
  puntosDeCodigo,
  recortarAscii,
  type ModoGramatica,
} from "../lib/personas/identidad.ts";
import { normalizarDocumentoLead } from "../lib/crm/leads.ts";

// #32 / migración 214 — gramática documental en TypeScript. Recorre el MISMO archivo de
// vectores que supabase/scripts/test_214_personas_identidad.sql: si una regla cambia en un
// lenguaje y no en el otro, falla al menos una de las dos pruebas.

type Vector = {
  id: string;
  tipo: string | null;
  numero: string | null;
  marca: boolean | null;
  modo: string;
  esperado: { tipo_doc: string | null; numero_norm: string | null; estado: string; motivo: string | null };
};

const vectores = JSON.parse(
  readFileSync(new URL("./fixtures/personasIdentidad.vectores.json", import.meta.url), "utf8")
) as {
  gramatica: Vector[];
  errores_de_llamada: { id: string; tipo: string; numero: string; marca: boolean | null; modo: string }[];
  dv: { id: string; dv: string | null; esperado: boolean }[];
  longitud_original: { id: string; unidad: string; veces: number; cabe: boolean }[];
  solo_ts: { id: string; campo: "tipo" | "numero"; unidades: number[] }[];
};

describe("vectores compartidos con SQL", () => {
  test("gramática: cada vector produce exactamente la salida esperada", () => {
    assert.equal(vectores.gramatica.length, 65, "mismo conteo que la prueba SQL (V1)");
    const ids = new Set<string>();
    for (const v of vectores.gramatica) {
      assert.ok(!ids.has(v.id), `id repetido: ${v.id}`);
      ids.add(v.id);
      const r = normalizarDocumento({ tipo: v.tipo, numero: v.numero, nitDvEstructurado: v.marca, modo: v.modo as ModoGramatica });
      assert.deepEqual(r, v.esperado, `vector ${v.id}`);
    }
  });

  test("llamadas mal formadas lanzan ErrorEntradaDocumento (SQL: 22023)", () => {
    assert.equal(vectores.errores_de_llamada.length, 3);
    for (const v of vectores.errores_de_llamada) {
      assert.throws(
        () => normalizarDocumento({ tipo: v.tipo, numero: v.numero, nitDvEstructurado: v.marca, modo: v.modo as ModoGramatica }),
        ErrorEntradaDocumento,
        `vector ${v.id}`
      );
    }
  });

  test("dv_nit_valido: un dígito ASCII tras recortar espacios ASCII", () => {
    assert.equal(vectores.dv.length, 14);
    for (const v of vectores.dv) assert.equal(dvNitValido(v.dv), v.esperado, `vector ${v.id}`);
  });

  test("longitud de originales en puntos de código (no en unidades UTF-16)", () => {
    assert.equal(vectores.longitud_original.length, 5);
    for (const v of vectores.longitud_original) {
      const x = v.unidad.repeat(v.veces);
      assert.equal(cabeOriginal(x), v.cabe, `vector ${v.id}`);
    }
    const emojis = "😀".repeat(64);
    assert.equal(emojis.length, 128, "length cuenta unidades UTF-16");
    assert.equal(puntosDeCodigo(emojis), 64);
    assert.equal(cabeOriginal(emojis), true);
    assert.equal(cabeOriginal(null), true);
  });

  test("solo TS: NUL y surrogates sueltos son error de entrada, nunca una ficha", () => {
    assert.equal(vectores.solo_ts.length, 3);
    for (const v of vectores.solo_ts) {
      const texto = String.fromCharCode(...v.unidades);
      assert.equal(esRepresentable(texto), false, `vector ${v.id}`);
      const entrada = v.campo === "tipo"
        ? { tipo: texto, numero: "123456", nitDvEstructurado: false, modo: "alta" as const }
        : { tipo: "CC", numero: texto, nitDvEstructurado: false, modo: "alta" as const };
      assert.throws(() => normalizarDocumento(entrada), (e: unknown) => e instanceof ErrorEntradaDocumento && e.codigo === "error_entrada", `vector ${v.id}`);
    }
  });

  test("propiedad: para entradas válidas no NIT, numero_norm coincide con la 202 (crm_leads)", () => {
    const validos = vectores.gramatica.filter((v) => v.esperado.estado === "documentada" && v.esperado.tipo_doc !== "NIT");
    assert.equal(validos.length, 14, "mismo conteo que la prueba SQL (V5)");
    for (const v of validos) assert.equal(normalizarDocumentoLead(v.numero), v.esperado.numero_norm, `vector ${v.id}`);
  });
});

describe("reglas que los vectores fijan pero conviene leer explícitas", () => {
  test("R1 recorta SOLO espacios ASCII", () => {
    assert.equal(recortarAscii("  CC  "), "CC");
    assert.equal(recortarAscii(" CC"), " CC");
    assert.equal(recortarAscii("CC\t"), "CC\t");
  });

  test("tipo presente pero inválido es revisión; tipo ausente es provisional", () => {
    assert.equal(normalizarDocumento({ tipo: "CC2", numero: null, nitDvEstructurado: false, modo: "alta" }).estado, "revision");
    assert.equal(normalizarDocumento({ tipo: "  ", numero: "123456", nitDvEstructurado: false, modo: "alta" }).estado, "provisional");
  });

  test("NIT: base 3-20 en alta y en consulta; sin DV estructurado queda en revisión", () => {
    const alta = (numero: string, marca: boolean) => normalizarDocumento({ tipo: "NIT", numero, nitDvEstructurado: marca, modo: "alta" });
    const consulta = (numero: string) => normalizarDocumento({ tipo: "NIT", numero, nitDvEstructurado: null, modo: "consulta" });
    assert.equal(alta("123", true).estado, "documentada");
    assert.equal(alta("12", true).motivo, "numero_invalido");
    assert.equal(alta("12345678901234567890", true).estado, "documentada");
    assert.equal(alta("123456789012345678901", true).motivo, "numero_invalido");
    assert.equal(alta("900123456", false).motivo, "nit_sin_dv_estructurado");
    assert.equal(consulta("900123456").numero_norm, "900123456");
    assert.equal(consulta("900123456-7").estado, "revision");
  });

  test("los ceros iniciales distinguen identidades", () => {
    const a = normalizarDocumento({ tipo: "CC", numero: "0071234", nitDvEstructurado: false, modo: "alta" });
    const b = normalizarDocumento({ tipo: "CC", numero: "71234", nitDvEstructurado: false, modo: "alta" });
    assert.notEqual(a.numero_norm, b.numero_norm);
  });
});
