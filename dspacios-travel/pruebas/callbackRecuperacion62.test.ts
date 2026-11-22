// #62 (B1) — /auth/callback: la RECUPERACIÓN la decide la sesión canjeada (método de recuperación en su token), nunca el parámetro `next`.
// Un OAuth/enlace mágico con next=/restablecer manipulado NO entra al restablecimiento; una recuperación genuina entra aunque `next` falte o sea otro.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

// `next` no publica mapa "exports": en ESM plano "next/server" no resuelve (mismo patrón que callbackDestinoSeguro.test.ts).
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/server" ? "next/server.js" : s, c); }'));

const jwt = (p: unknown) => `h.${Buffer.from(JSON.stringify(p)).toString("base64url")}.s`;
const TOKEN_RECUPERACION = jwt({ sub: "u1", amr: [{ method: "recovery", timestamp: 1_800_000_000 }] });
const TOKEN_OAUTH = jwt({ sub: "u1", amr: [{ method: "oauth", timestamp: 1_800_000_000 }] });
const TOKEN_OTP = jwt({ sub: "u1", amr: [{ method: "otp", timestamp: 1_800_000_000 }] });

let errorIntercambio: unknown = null;
let tokenCanjeado: string | null = TOKEN_RECUPERACION;
const intercambios: string[] = [];
let contextoIniciado = 0;

mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: async () => ({
      auth: { exchangeCodeForSession: async (c: string) => { intercambios.push(c); return errorIntercambio ? { data: { session: null }, error: errorIntercambio } : { data: { session: tokenCanjeado ? { access_token: tokenCanjeado } : null }, error: null }; } },
    }),
  },
});
mock.module("@/lib/auth/contextoAgencia", { namedExports: { iniciarContextoAgencia: async () => { contextoIniciado++; } } });

const { GET } = await import("../app/auth/callback/route.ts");
const ORIGEN = "https://app.test";
async function llamar(qs: string) {
  const r = await GET(new Request(`${ORIGEN}/auth/callback${qs}`));
  return { status: r.status, destino: r.headers.get("location") };
}
beforeEach(() => { errorIntercambio = null; tokenCanjeado = TOKEN_RECUPERACION; intercambios.length = 0; contextoIniciado = 0; });

describe("recuperación genuina (token con método de recuperación)", () => {
  test("va a /restablecer, no inicia el contexto de agencia, y NO depende de `next`", async () => {
    for (const qs of ["?code=abc&next=/restablecer", "?code=abc", "?code=abc&next=/dashboard", "?code=abc&next=//evil.test"]) {
      contextoIniciado = 0;
      const r = await llamar(qs);
      assert.equal(r.destino, `${ORIGEN}/restablecer`, qs);
      assert.equal(contextoIniciado, 0, qs);
    }
  });
  test("código vencido/usado + next=/restablecer → /recuperar?error=enlace, sin detalle del motivo", async () => {
    errorIntercambio = { message: "otp_expired", code: "otp_expired" };
    assert.equal((await llamar("?code=abc&next=/restablecer")).destino, `${ORIGEN}/recuperar?error=enlace`);
  });
  test("sin código (Supabase devolvió error en la URL) + next=/restablecer → /recuperar?error=enlace", async () => {
    assert.equal((await llamar("?error=access_denied&error_code=otp_expired&next=/restablecer")).destino, `${ORIGEN}/recuperar?error=enlace`);
    assert.deepEqual(intercambios, []);
  });
});

describe("B1: next=/restablecer manipulado en una sesión ORDINARIA nunca autoriza el restablecimiento", () => {
  for (const [nombre, token] of [["OAuth (Google)", TOKEN_OAUTH], ["enlace mágico / OTP", TOKEN_OTP]] as const) {
    test(`${nombre} con next=/restablecer: va al destino por defecto, inicia el contexto de agencia y NO pasa por /restablecer`, async () => {
      tokenCanjeado = token;
      const r = await llamar("?code=g1&next=/restablecer");
      assert.equal(r.destino, `${ORIGEN}/dashboard`);
      assert.equal(contextoIniciado, 1);
    });
  }
  test("sesión sin token de acceso legible: tratada como ordinaria", async () => {
    tokenCanjeado = null;
    assert.equal((await llamar("?code=g1&next=/restablecer")).destino, `${ORIGEN}/dashboard`);
  });
});

describe("OAuth (Google) sin cambios", () => {
  test("éxito: va a su destino e inicia el contexto de agencia", async () => {
    tokenCanjeado = TOKEN_OAUTH;
    const r = await llamar("?code=g1&next=/dashboard");
    assert.equal(r.destino, `${ORIGEN}/dashboard`);
    assert.equal(contextoIniciado, 1);
    assert.equal((await llamar("?code=g1&next=/portal/b2b")).destino, `${ORIGEN}/portal/b2b`);
  });
  test("fallo: /login?error=oauth (no al flujo de recuperación)", async () => {
    errorIntercambio = { message: "x" };
    assert.equal((await llamar("?code=g1&next=/dashboard")).destino, `${ORIGEN}/login?error=oauth`);
  });
  test("un next ajeno no abre redirección externa", async () => {
    tokenCanjeado = TOKEN_OAUTH;
    for (const next of ["//evil.test/restablecer", "https://evil.test", "@evil.test", "/restablecer@evil.test"]) {
      const r = await llamar(`?code=g1&next=${encodeURIComponent(next)}`);
      assert.equal(new URL(r.destino ?? "").host, new URL(ORIGEN).host, `${next} → ${r.destino}`);
      assert.ok(!r.destino!.startsWith(`${ORIGEN}//`), `${next} → ${r.destino}`);
    }
  });
});

describe("proxy: rutas de cuenta", () => {
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  test("solo /recuperar es pública; /restablecer y /cuenta exigen sesión", () => {
    const m = proxy.match(/const RUTAS_PUBLICAS = \[([^\]]*)\]/);
    assert.ok(m);
    assert.match(m![1], /"\/recuperar"/);
    assert.doesNotMatch(m![1], /restablecer|"\/cuenta"/);
  });
});
