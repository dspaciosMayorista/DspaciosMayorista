// O-4 — borrador del formulario de registro B2B que sobrevive a «Olvidé mi contraseña»: solo campos del formulario, nunca secretos, con vencimiento.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLAVE_BORRADOR_REGISTRO, VIGENCIA_BORRADOR_MS, borrarBorradorRegistro, guardarBorradorRegistro, leerBorradorRegistro,
} from "../lib/auth/borradorRegistroB2B.ts";

const almacen = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const T0 = 1_800_000_000_000;

describe("borrador del registro B2B", () => {
  test("guarda solo los campos del formulario: contraseña, confirmación, código y cualquier otra clave se descartan", () => {
    const a = almacen();
    assert.equal(guardarBorradorRegistro(a, { email: "ana@x.co", nombre: "Ana", nit: "1", tipo: "freelance", tipoDoc: "CC", password: "secreta123", passwordConfirm: "secreta123", codigo: "123456", token: "abc", aceptaNotificaciones: true }, T0), true);
    const crudo = a.m.get(CLAVE_BORRADOR_REGISTRO)!;
    assert.doesNotMatch(crudo, /secreta123|password|codigo|123456|token|abc/);
    assert.deepEqual(leerBorradorRegistro(a, T0 + 1000), { email: "ana@x.co", nombre: "Ana", nit: "1", tipo: "freelance", aceptaNotificaciones: true });
  });
  test("sin correo no hay nada que retomar: no se guarda", () => {
    const a = almacen();
    assert.equal(guardarBorradorRegistro(a, { nombre: "Ana" }, T0), false);
    assert.equal(guardarBorradorRegistro(a, { email: "   " }, T0), false);
    assert.equal(a.m.size, 0);
  });
  test("vence a los 60 minutos y al leerlo vencido se borra", () => {
    const a = almacen(); guardarBorradorRegistro(a, { email: "ana@x.co" }, T0);
    assert.ok(leerBorradorRegistro(a, T0 + VIGENCIA_BORRADOR_MS));
    assert.equal(leerBorradorRegistro(a, T0 + VIGENCIA_BORRADOR_MS + 1), null);
    assert.equal(a.m.size, 0, "el vencido se elimina");
  });
  test("un reloj retrasado (guardado en el futuro) o un contenido corrupto se descartan sin lanzar", () => {
    const a = almacen(); a.m.set(CLAVE_BORRADOR_REGISTRO, JSON.stringify({ guardado: T0 + 10 * 60_000, datos: { email: "a@x.co" } }));
    assert.equal(leerBorradorRegistro(a, T0), null);
    a.m.set(CLAVE_BORRADOR_REGISTRO, "{no es json");
    assert.equal(leerBorradorRegistro(a, T0), null);
    a.m.set(CLAVE_BORRADOR_REGISTRO, JSON.stringify({ guardado: T0, datos: "texto" }));
    assert.equal(leerBorradorRegistro(a, T0), null);
  });
  test("sin almacenamiento (ventana privada o bloqueado) nada lanza y todo devuelve vacío", () => {
    const roto = { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); }, removeItem() { throw new Error("bloqueado"); } };
    assert.equal(guardarBorradorRegistro(roto, { email: "a@x.co" }), false);
    assert.equal(leerBorradorRegistro(roto), null);
    assert.doesNotThrow(() => borrarBorradorRegistro(roto));
    assert.equal(guardarBorradorRegistro(null, { email: "a@x.co" }), false);
    assert.equal(leerBorradorRegistro(undefined), null);
  });
  test("recortar: los valores muy largos no crecen sin límite", () => {
    const a = almacen(); guardarBorradorRegistro(a, { email: "a@x.co", notas: "x".repeat(5000) }, T0);
    assert.equal(leerBorradorRegistro(a, T0)!.notas!.length, 300);
  });
});

describe("O-4 — cableado (texto fuente): no se agrega ningún camino de acceso", () => {
  const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  test("el enlace del paso «Continúa tu registro» solo guarda el borrador y navega a /recuperar?desde=registro", () => {
    const s = src("app/portal/registro/RegistroForm.tsx");
    assert.match(s, /<Link href="\/recuperar\?desde=registro" onClick=\{guardarParaRecuperar\}/);
    assert.match(s, /function guardarParaRecuperar\(\) \{\s*guardarBorradorRegistro\(almacenNavegador\(\), f\);\s*\}/);
  });
  test("retomar NO precarga contraseña y continuar sigue usando la acción que comprueba la contraseña real", () => {
    const s = src("app/portal/registro/RegistroForm.tsx");
    assert.match(s, /setF\(\(p\) => \(\{ \.\.\.p, \.\.\.d, password: "", passwordConfirm: "" \}\)\)/);
    assert.match(s, /continuarRegistroB2B\(datos\)/);
  });
  test("la acción de continuar no cambió: correo + contraseña comprobada con Auth antes de completar", () => {
    const s = src("app/portal/registro/actions.ts");
    assert.match(s, /signInWithPassword\(\{ email, password \}\)[\s\S]{0,200}return completar\(createAdminClient\(\), data\.user\.id, input\)/);
  });
  test("la recuperación sigue usando el mismo envío y el mismo destino de retorno", () => {
    const s = src("app/(auth)/recuperar/RecuperarClient.tsx");
    assert.match(s, /resetPasswordForEmail\(c, \{\s*redirectTo: `\$\{window\.location\.origin\}\/auth\/callback\?next=\/restablecer`/);
  });
});

describe("O-4 — proxy: la recuperación de un registro pendiente (cuenta inactiva) llega a /restablecer", () => {
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  test("el perfil NO se lee en /restablecer (así el rebote a /login?inactivo=1 no corta la recuperación), y sigue leyéndose en el resto", () => {
    assert.match(proxy, /if \(user && !pathname\.startsWith\("\/login"\) && !pathname\.startsWith\("\/auth"\) && !pathname\.startsWith\("\/restablecer"\)\) \{/);
    assert.match(proxy, /if \(perfil && perfil\.activo === false\) \{\s*return NextResponse\.redirect\(new URL\("\/login\?inactivo=1", request\.url\)\);/);
  });
  test("/restablecer sigue exigiendo sesión (no está entre las rutas públicas) y la acción verifica la recuperación en el servidor", () => {
    const publicas = proxy.match(/const RUTAS_PUBLICAS = \[([^\]]*)\]/)![1];
    assert.doesNotMatch(publicas, /restablecer/);
    assert.match(readFileSync(new URL("../app/(auth)/contrasena-actions.ts", import.meta.url), "utf8"), /autorizacionRecuperacion\(sb\)/);
  });
});
