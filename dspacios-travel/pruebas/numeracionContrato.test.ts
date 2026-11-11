import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  interpretarRespuestaNumeroContrato,
  interpretarReservaNumeroContrato,
  MENSAJE_ERROR_NUMERO_CONTRATO,
} from "../lib/contrato/numeracionPuro.ts";

// interpretarRespuestaNumeroContrato — la parte PURA de numeracion.ts
// (revisión posterior al PR #274, ítem 5 "ERRORES INTERNOS"): nunca debe
// exponer error.message tal cual (podría nombrar la función, la secuencia o
// el SQLSTATE del rechazo) — siempre un mensaje público fijo.
describe("interpretarRespuestaNumeroContrato", () => {
  test("data válido, sin error → ok con el número tal cual", () => {
    const res = interpretarRespuestaNumeroContrato("DTM-0001", null);
    assert.deepEqual(res, { ok: true, numero: "DTM-0001" });
  });

  test("minorista pasa igual, sin transformarlo", () => {
    const res = interpretarRespuestaNumeroContrato("MIN-00-0533", null);
    assert.deepEqual(res, { ok: true, numero: "MIN-00-0533" });
  });

  test("error con nombres internos (función/secuencia/permiso) → NUNCA se propaga, solo el mensaje fijo", () => {
    const errores = [
      { message: 'permission denied for function siguiente_numero_contrato_para_tenant' },
      { message: 'permission denied for sequence contrato_seq_mayorista' },
      { message: 'relation "public.numeros_contrato_liberados" does not exist' },
      { message: "ERROR:  tenant inválido: francia (SQLSTATE P0001)" },
    ];
    for (const error of errores) {
      const res = interpretarRespuestaNumeroContrato(null, error);
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error, MENSAJE_ERROR_NUMERO_CONTRATO);
        // Ninguno de los nombres internos del error original debe sobrevivir.
        assert.doesNotMatch(res.error, /siguiente_numero_contrato_para_tenant|contrato_seq_mayorista|numeros_contrato_liberados|SQLSTATE|permission denied/i);
      }
    }
  });

  test("sin data y sin error explícito → igual falla cerrado con el mensaje fijo", () => {
    const res = interpretarRespuestaNumeroContrato(null, null);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.error, MENSAJE_ERROR_NUMERO_CONTRATO);
  });

  test("data vacío (string vacío) sin error → igual falla cerrado (data \"falsy\")", () => {
    const res = interpretarRespuestaNumeroContrato("", null);
    assert.equal(res.ok, false);
  });

  test("error presente PERO con data también presente → el error manda, nunca se usa un data parcial", () => {
    const res = interpretarRespuestaNumeroContrato("DTM-0001", { message: "algo raro" });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.error, MENSAJE_ERROR_NUMERO_CONTRATO);
  });
});

// Migración 282 (#75): `reservar_numero_contrato` devuelve una fila { numero, token }.
describe("interpretarReservaNumeroContrato — ticket de reserva del consecutivo", () => {
  test("DTM nuevo de la secuencia: ticket nulo", () => {
    assert.deepEqual(interpretarReservaNumeroContrato([{ numero: "DTM-0042", token: null }], null), { ok: true, numero: "DTM-0042", reservaToken: null });
  });
  test("DTM reutilizado: el ticket viaja al creador", () => {
    const t = "0b3c7a52-8f0e-4d36-9a55-1f1c2a9d77aa";
    assert.deepEqual(interpretarReservaNumeroContrato([{ numero: "DTM-0007", token: t }], null), { ok: true, numero: "DTM-0007", reservaToken: t });
  });
  test("Minorista: ticket nulo y número tal cual", () => {
    assert.deepEqual(interpretarReservaNumeroContrato([{ numero: "MIN-00-0533", token: null }], null), { ok: true, numero: "MIN-00-0533", reservaToken: null });
  });
  test("error, sin filas, más de una fila o fila sin número → falla cerrado con el mensaje fijo (nunca un dato parcial)", () => {
    const casos: Array<[any, any]> = [
      [null, { message: "permission denied for function reservar_numero_contrato" }],
      [[{ numero: "DTM-0001", token: null }], { message: "x" }],
      [null, null], [[], null], [undefined, null],
      [[{ numero: "", token: null }], null],
      [[{ numero: "DTM-0001", token: null }, { numero: "DTM-0002", token: null }], null],
    ];
    for (const [data, error] of casos) {
      const res = interpretarReservaNumeroContrato(data, error);
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error, MENSAJE_ERROR_NUMERO_CONTRATO);
        assert.doesNotMatch(res.error, /reservar_numero_contrato|permission denied/i);
      }
    }
  });
});

// ── Wiring: numeracion.ts debe usar service_role, no el cliente de sesión ──
function leer(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

describe("lib/contrato/numeracion.ts — wiring de seguridad (revisión posterior al PR #274)", () => {
  const src = leer("lib/contrato/numeracion.ts");

  test("importa server-only (nunca debe poder ejecutarse en el navegador)", () => {
    assert.match(src, /import\s+"server-only"/);
  });

  test("usa createAdminClient() (service_role) — NUNCA createClient() (cliente de sesión)", () => {
    assert.match(src, /createAdminClient/);
    assert.doesNotMatch(src, /\bcreateClient\(/);
    assert.doesNotMatch(src, /from\s+"@\/lib\/supabase\/server"/);
  });

  test("siguienteNumeroContrato ya NO recibe `sb` como parámetro", () => {
    const firma = src.match(/export\s+async\s+function\s+siguienteNumeroContrato\(([^)]*)\)/);
    assert.ok(firma, "no se encontró la firma de siguienteNumeroContrato");
    assert.doesNotMatch(firma![1], /\bsb\b/);
  });

  test("el valor de RETORNO nunca se arma con error.message — solo interpretarRespuestaNumeroContrato decide qué devolver", () => {
    // `error.message` sí puede aparecer (y aparece) dentro de un console.error
    // — eso es EL PUNTO: el detalle técnico se registra server-side, nunca se
    // devuelve. Lo que este test verifica es que ningún `return` de la
    // función arma el resultado con `error.message`/`error?.message`
    // directamente — la única fuente del valor devuelto es
    // interpretarRespuestaNumeroContrato(data, error), que internamente
    // ignora el mensaje crudo (ver numeracionPuro.ts).
    const returns = src.match(/return\s*\{[^}]*\}/g) ?? [];
    for (const r of returns) assert.doesNotMatch(r, /error\.message|error\?\.message/);
    assert.match(src, /return\s+interpretarReservaNumeroContrato\(/);
    // Y si loguea el error crudo, debe ser EXCLUSIVAMENTE vía console.error.
    const usosDeMessage = [...src.matchAll(/error\??\.message/g)];
    for (const m of usosDeMessage) {
      const antes = src.slice(Math.max(0, m.index! - 220), m.index!);
      assert.match(antes, /console\.error\(/, "error.message se usó fuera de un console.error");
    }
  });
});
