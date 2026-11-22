// #62 — reglas puras de contraseña y de correo de recuperación.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validarContrasenaNueva, correoRecuperacion, mensajeErrorContrasena, MIN_CONTRASENA } from "../lib/auth/contrasena.ts";

describe("validarContrasenaNueva", () => {
  test("acepta una contraseña válida confirmada", () => assert.equal(validarContrasenaNueva("Viaje2026", "Viaje2026"), null));
  test("límite: exactamente el mínimo pasa; uno menos no", () => {
    assert.equal(validarContrasenaNueva("a".repeat(MIN_CONTRASENA), "a".repeat(MIN_CONTRASENA)), null);
    assert.match(validarContrasenaNueva("a".repeat(MIN_CONTRASENA - 1), "a".repeat(MIN_CONTRASENA - 1)) ?? "", /al menos 6/);
  });
  test("confirmación distinta, vacía o sin tipo string", () => {
    assert.match(validarContrasenaNueva("Viaje2026", "viaje2026") ?? "", /no coincide/);
    assert.match(validarContrasenaNueva("Viaje2026", "") ?? "", /no coincide/);
    assert.match(validarContrasenaNueva(undefined, "x") ?? "", /Escribe/);
    assert.match(validarContrasenaNueva(123456789, 123456789) ?? "", /Escribe/);
  });
  test("al cambiar desde una sesión, la nueva debe ser distinta de la actual", () => {
    assert.match(validarContrasenaNueva("Viaje2026", "Viaje2026", "Viaje2026") ?? "", /distinta de la actual/);
    assert.equal(validarContrasenaNueva("Viaje2027", "Viaje2027", "Viaje2026"), null);
  });
  test("más de 72 BYTES se rechaza (la ñ y los emojis pesan más de 1)", () => {
    assert.equal(validarContrasenaNueva("a".repeat(72), "a".repeat(72)), null);
    assert.match(validarContrasenaNueva("a".repeat(73), "a".repeat(73)) ?? "", /demasiado larga/);
    assert.match(validarContrasenaNueva("ñ".repeat(37), "ñ".repeat(37)) ?? "", /demasiado larga/, "37 ñ = 74 bytes");
  });
});

describe("correoRecuperacion", () => {
  test("recorta y pasa a minúsculas", () => assert.equal(correoRecuperacion("  Ana@Agencia.CO "), "ana@agencia.co"));
  test("rechaza lo que no parece un correo", () => {
    for (const v of ["", "sin-arroba", "a@b", "a b@c.co", null, undefined, 5, "a@".padEnd(260, "x") + ".co"]) assert.equal(correoRecuperacion(v), null, String(v));
  });
});

describe("mensajeErrorContrasena", () => {
  test("traduce los códigos conocidos y no filtra el mensaje crudo", () => {
    assert.match(mensajeErrorContrasena({ code: "same_password" }), /distinta/);
    assert.match(mensajeErrorContrasena({ code: "weak_password" }), /débil/);
    assert.match(mensajeErrorContrasena({ status: 429 }), /Demasiados intentos/);
    assert.match(mensajeErrorContrasena({ code: "session_not_found" }), /enlace nuevo/);
    const raro = mensajeErrorContrasena({ message: "User not found for ana@x.co" });
    assert.doesNotMatch(raro, /ana@x\.co|User not found/);
    assert.match(mensajeErrorContrasena(null), /No se pudo/);
  });
});
