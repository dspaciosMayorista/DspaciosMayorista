// #25 — El callback de OAuth solo redirige a rutas del mismo origen.
//
// Antes `app/auth/callback/route.ts` hacía `${origin}${next}` con `next` tomado
// de la URL: "@otro.com", "//otro.com" o "/\otro.com" llevaban al usuario recién
// autenticado a un sitio ajeno. Ahora pasa por `destinoLocalSeguro`.
//
// Parte 1: la función pura con entradas normales y hostiles (incluidas variantes
// codificadas). Parte 2: el handler GET REAL, con el cliente de Supabase
// simulado, para comprobar el Location final y que el intercambio de sesión no
// cambió.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { destinoLocalSeguro, DESTINO_POR_DEFECTO } from "../lib/auth/destinoSeguro.ts";

const ORIGEN = "https://app.dspacios.test";

describe("destinoLocalSeguro — rutas locales válidas se conservan", () => {
  const validas: [string, string][] = [
    ["/dashboard", "/dashboard"],
    ["/dashboard/contratos/00-0451", "/dashboard/contratos/00-0451"],
    ["/portal/b2b", "/portal/b2b"],
    ["/dashboard/cartera?mes=2026-10#saldo", "/dashboard/cartera?mes=2026-10#saldo"],
    ["/", "/"],
    ["/caf%C3%A9", "/caf%C3%A9"],
    ["/dashboard/./ventas", "/dashboard/ventas"],
    ["/dashboard/x/../ventas", "/dashboard/ventas"],
  ];
  for (const [entrada, esperado] of validas) {
    test(JSON.stringify(entrada), () => assert.equal(destinoLocalSeguro(entrada, ORIGEN), esperado));
  }
});

describe("destinoLocalSeguro — ausente o vacío usa /dashboard", () => {
  for (const entrada of [null, undefined, ""]) {
    test(String(JSON.stringify(entrada)), () => assert.equal(destinoLocalSeguro(entrada, ORIGEN), DESTINO_POR_DEFECTO));
  }
  test("el destino por defecto es /dashboard", () => assert.equal(DESTINO_POR_DEFECTO, "/dashboard"));
});

describe("destinoLocalSeguro — entradas hostiles vuelven a /dashboard", () => {
  const hostiles = [
    // Externas y relativas al protocolo
    "https://otro.example/phish",
    "http:otro.example",
    "javascript:alert(1)",
    "data:text/html,hola",
    "//otro.example",
    "///otro.example",
    "////otro.example/x",
    // Userinfo: era el caso que rompía la concatenación (`${origin}@otro`)
    "@otro.example",
    "@otro.example/dashboard",
    ".otro.example",
    "dashboard",
    // Barras invertidas (los navegadores las leen como "/")
    "/\\otro.example",
    "\\\\otro.example",
    "\\/otro.example",
    "/dashboard\\..\\..\\otro",
    // Caracteres de control (el parser elimina tab/salto: "/\t/x" → "//x")
    "/\t/otro.example",
    "/\n/otro.example",
    "/\r/otro.example",
    "/dashboard\u0000",
    " //otro.example",
    // Segmentos de punto que normalizan a "//host"
    "/.//otro.example",
    "/x/..//otro.example",
    // Variantes codificadas (una vez decodificadas por searchParams llegan así)
    "/%2F%2Fotro.example",
    "/%2f%2fotro.example",
    "/%5Cotro.example",
    "/%5cotro.example",
    "/%252F%252Fotro.example",
    "/%25252F%25252Fotro.example",
    "/%09/otro.example",
    "/%0A/otro.example",
    "%2F%2Fotro.example",
    "/%",
    "/%E0%A4%A",
    // Más de cinco capas de codificación
    "/%25252525252F",
  ];
  for (const entrada of hostiles) {
    test(JSON.stringify(entrada), () => assert.equal(destinoLocalSeguro(entrada, ORIGEN), DESTINO_POR_DEFECTO));
  }

  test("ninguna entrada hostil produce una URL final fuera del origen (concatenación del route)", () => {
    for (const entrada of hostiles) {
      const final = new URL(`${ORIGEN}${destinoLocalSeguro(entrada, ORIGEN)}`);
      assert.equal(final.origin, ORIGEN, `fuga con ${JSON.stringify(entrada)}`);
    }
  });

  test("un origin inválido no rompe: vuelve a /dashboard", () => {
    assert.equal(destinoLocalSeguro("/dashboard/ventas", "no-es-url"), DESTINO_POR_DEFECTO);
  });
});

// ── Parte 2: handler GET real ─────────────────────────────────────────────
// `next` no publica mapa "exports": en ESM plano "next/server" no resuelve.
register(
  "data:text/javascript," +
    encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/server" ? "next/server.js" : s, c); }'),
);

const intercambios: string[] = [];
let errorIntercambio: unknown = null;
mock.module(new URL("../lib/supabase/server.ts", import.meta.url).href, {
  namedExports: {
    createClient: async () => ({
      auth: {
        exchangeCodeForSession: async (code: string) => {
          intercambios.push(code);
          return { data: {}, error: errorIntercambio };
        },
      },
    }),
  },
});
// #5 D8/D9: tras un intercambio correcto el callback vincula la agencia activa a la sesión.
// El módulo real es server-only (next/headers + service-role): se sustituye y se cuentan las llamadas.
const contextosIniciados: string[] = [];
mock.module(new URL("../lib/auth/contextoAgencia.ts", import.meta.url).href, {
  namedExports: {
    iniciarContextoAgencia: async () => { contextosIniciados.push("iniciar"); return { ok: true, codigo: "ok" }; },
  },
});
const { GET } = await import("../app/auth/callback/route.ts");

async function llamar(query: string) {
  const r = await GET(new Request(`${ORIGEN}/auth/callback${query}`));
  return { status: r.status, destino: r.headers.get("location") };
}

describe("GET /auth/callback — redirección tras OAuth", () => {
  beforeEach(() => { intercambios.length = 0; errorIntercambio = null; contextosIniciados.length = 0; });

  test("sin next: intercambia el código y va a /dashboard", async () => {
    const r = await llamar("?code=abc");
    assert.equal(r.status, 307);
    assert.equal(r.destino, `${ORIGEN}/dashboard`);
    assert.deepEqual(intercambios, ["abc"]);
  });

  test("intercambio correcto: vincula la agencia a la sesión; si falla el intercambio, NO", async () => {
    await llamar("?code=abc");
    assert.deepEqual(contextosIniciados, ["iniciar"]);
    contextosIniciados.length = 0;
    errorIntercambio = { message: "invalid grant" };
    await llamar("?code=abc");
    assert.deepEqual(contextosIniciados, []);
  });

  test("next local se respeta (incluida query)", async () => {
    const r = await llamar(`?code=abc&next=${encodeURIComponent("/dashboard/cartera?mes=2026-10")}`);
    assert.equal(r.destino, `${ORIGEN}/dashboard/cartera?mes=2026-10`);
  });

  const maliciosos = [
    "@otro.example",
    "//otro.example",
    "https://otro.example",
    "/\\otro.example",
    "/%2F%2Fotro.example",
    "/.//otro.example",
    "/\t/otro.example",
  ];
  for (const m of maliciosos) {
    test(`next hostil ${JSON.stringify(m)} → /dashboard del mismo origen`, async () => {
      const r = await llamar(`?code=abc&next=${encodeURIComponent(m)}`);
      assert.equal(r.status, 307);
      assert.equal(r.destino, `${ORIGEN}/dashboard`);
      assert.equal(new URL(r.destino!).origin, ORIGEN);
      assert.deepEqual(intercambios, ["abc"], "el intercambio de sesión se hace igual");
    });
  }

  test("variantes sin re-codificar en la query (%2F, %5C, doble %25) tampoco escapan", async () => {
    for (const q of ["next=%2F%2Fotro.example", "next=/%5Cotro.example", "next=/%252F%252Fotro.example", "next=%40otro.example", "next=/%09/otro.example"]) {
      const r = await llamar(`?code=abc&${q}`);
      assert.equal(r.destino, `${ORIGEN}/dashboard`, q);
    }
  });

  test("si el intercambio falla, va al login con error (como antes), aunque next sea local", async () => {
    errorIntercambio = { message: "invalid grant" };
    const r = await llamar("?code=malo&next=/dashboard/ventas");
    assert.equal(r.destino, `${ORIGEN}/login?error=oauth`);
    assert.deepEqual(intercambios, ["malo"]);
  });

  test("sin código no intenta intercambiar y va al login con error, aunque next sea hostil", async () => {
    const r = await llamar("?next=//otro.example");
    assert.equal(r.destino, `${ORIGEN}/login?error=oauth`);
    assert.deepEqual(intercambios, []);
  });
});

describe("cableado de app/auth/callback/route.ts", () => {
  const fuente = readFileSync(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8");

  test("valida `next` con destinoLocalSeguro antes de redirigir", () => {
    assert.match(fuente, /import \{ destinoLocalSeguro \} from "@\/lib\/auth\/destinoSeguro";/);
    assert.match(fuente, /const next = destinoLocalSeguro\(searchParams\.get\("next"\), origin\);/);
    assert.doesNotMatch(fuente, /searchParams\.get\("next"\) \?\?/);
  });

  test("el intercambio de sesión y la ruta de error no cambian", () => {
    assert.match(fuente, /const \{ error \} = await supabase\.auth\.exchangeCodeForSession\(code\);/);
    assert.equal((fuente.match(/exchangeCodeForSession\(/g) ?? []).length, 1);
    assert.match(fuente, /return NextResponse\.redirect\(`\$\{origin\}\/login\?error=oauth`\);/);
  });
});
