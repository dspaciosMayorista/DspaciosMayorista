// #62 (B1+B4) — prueba de recuperación: función pura (sin red). Fronteras de la ventana, del amr y de la clave de evento (usuario + sesión + instante). El consumo NO sale de aquí.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluarRecuperacion, instanteRecuperacion, esSesionDeRecuperacion, reclamosDeJwt, eventoRecuperacion, VENTANA_RECUPERACION_SEGUNDOS as V } from "../lib/auth/recuperacion.ts";

const T0 = 1_800_000_000; // segundos
const ms = (s: number) => s * 1000;
const claims = (amr: unknown, sub = "u1", session_id: unknown = "s1") => ({ sub, amr, session_id });
const rec = (ts = T0) => [{ method: "recovery", timestamp: ts }];
const ev = (c: ReturnType<typeof claims> | null, ahora: number, userId: string | null = "u1") => evaluarRecuperacion({ claims: c, userId, ahoraMs: ms(ahora) });
const OK = { ok: true, instante: T0, usuarioId: "u1", evento: `s1:${T0}` };

describe("evaluarRecuperacion", () => {
  test("genuina: recuperación reciente, mismo usuario, con sesión → devuelve el evento (usuario + sesión + instante)", () => assert.deepEqual(ev(claims(rec()), T0 + 60), OK));
  test("ventana: exactamente V segundos aún sirve; V+1 es vencida", () => {
    assert.deepEqual(ev(claims(rec()), T0 + V), OK);
    assert.deepEqual(ev(claims(rec()), T0 + V + 1), { ok: false, motivo: "vencida" });
  });
  test("evento: distinto por sesión y por instante; user_metadata ya no es parte de la evaluación", () => {
    assert.equal(eventoRecuperacion("s1", T0), `s1:${T0}`);
    assert.notEqual(eventoRecuperacion("s1", T0), eventoRecuperacion("s2", T0));
    assert.notEqual(eventoRecuperacion("s1", T0), eventoRecuperacion("s1", T0 + 1));
    assert.deepEqual(ev(claims(rec(), "u1", "s2"), T0 + 60), { ...OK, evento: `s2:${T0}` });
  });
  test("sin session_id válido no hay evento atable: se niega (falla cerrado)", () => {
    for (const sid of [null, "", 5, {}]) assert.deepEqual(ev(claims(rec(), "u1", sid), T0 + 60), { ok: false, motivo: "sin_sesion" }, String(sid));
    assert.deepEqual(ev({ sub: "u1", amr: rec() } as never, T0 + 60), { ok: false, motivo: "sin_sesion" }, "sin la clave");
  });
  test("otra sesión: sub distinto o ausente", () => {
    assert.deepEqual(ev(claims(rec(), "otro"), T0 + 60), { ok: false, motivo: "sesion_distinta" });
    assert.deepEqual(ev({ amr: rec(), session_id: "s1" } as never, T0 + 60), { ok: false, motivo: "sesion_distinta" });
  });
  test("sin recuperación: métodos ordinarios y amr malformado", () => {
    for (const amr of [undefined, null, [], "recovery", [{ method: "password", timestamp: T0 }], [{ method: "recovery" }], [{ method: "recovery", timestamp: "x" }], [{ method: "recovery", timestamp: Infinity }]]) {
      assert.deepEqual(ev(claims(amr), T0 + 60), { ok: false, motivo: "sin_recuperacion" }, JSON.stringify(amr));
    }
  });
  test("sin claims o sin usuario verificado: sin_sesion", () => {
    assert.deepEqual(ev(null, T0), { ok: false, motivo: "sin_sesion" });
    assert.deepEqual(ev(claims(rec()), T0, null), { ok: false, motivo: "sin_sesion" });
  });
  test("varias entradas: cuenta la recuperación MÁS reciente", () => {
    const amr = [{ method: "recovery", timestamp: T0 - 99999 }, { method: "password", timestamp: T0 + 5 }, { method: "recovery", timestamp: T0 }];
    assert.equal(instanteRecuperacion(amr), T0);
    assert.deepEqual(ev(claims(amr), T0 + 30), OK);
  });
});

describe("jwt", () => {
  const jwt = (p: unknown) => `h.${Buffer.from(JSON.stringify(p)).toString("base64url")}.s`;
  test("reclamosDeJwt y esSesionDeRecuperacion", () => {
    assert.deepEqual(reclamosDeJwt(jwt({ a: 1 })), { a: 1 });
    for (const t of [null, undefined, 5, "x", "a.b", "a.%%%.c", `h.${Buffer.from("[1").toString("base64url")}.s`]) assert.equal(reclamosDeJwt(t), null, String(t));
    assert.equal(esSesionDeRecuperacion(jwt({ amr: rec() })), true);
    assert.equal(esSesionDeRecuperacion(jwt({ amr: [{ method: "oauth", timestamp: T0 }] })), false);
    assert.equal(esSesionDeRecuperacion("basura"), false);
  });
});
