import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// `next` no publica mapa "exports": en ESM plano sus subrutas no resuelven (mismo truco que callbackDestinoSeguro).
register(
  "data:text/javascript," +
    encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/headers" || s === "next/cache" ? s + ".js" : s, c); }'),
);

// #5 D8/D9: el selector de agencia mueve primero el contexto en la base y SOLO si salió bien cambia la
// cookie. Con la RPC fallando no puede quedar una apariencia de Minorista con permiso de Mayorista.

let perfil = { tenant: "mayorista", permitidos: ["mayorista", "minorista"], puedeCambiar: true };
let resultadoRpc: { ok: boolean; codigo: string } | "lanza" = { ok: true, codigo: "ok" };
// Cola opcional por llamada (la primera RPC y la de restauración pueden tener resultados distintos).
let colaRpc: ({ ok: boolean; codigo: string } | "lanza")[] = [];
let cookieLanza = false;
const llamadasRpc: string[] = [];
const cookiesEscritas: string[] = [];
let revalidaciones = 0;

mock.module(new URL("../lib/tenant.server.ts", import.meta.url).href, {
  namedExports: { tenantContext: async () => ({ ...perfil, userTenant: "mayorista" }) },
});
mock.module(new URL("../lib/auth/contextoAgencia.ts", import.meta.url).href, {
  namedExports: {
    cambiarContextoAgencia: async (t: string) => {
      llamadasRpc.push(t);
      const r = colaRpc.length ? colaRpc.shift()! : resultadoRpc;
      if (r === "lanza") throw new Error("red");
      return r;
    },
  },
});
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      set: (_n: string, v: string) => { if (cookieLanza) throw new Error("solo lectura"); cookiesEscritas.push(v); },
    }),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => { revalidaciones++; } } });

const { cambiarTenant } = await import("../app/(dashboard)/tenant-actions.ts");

describe("cambiarTenant — la cookie solo cambia si la base cambió", () => {
  beforeEach(() => {
    perfil = { tenant: "mayorista", permitidos: ["mayorista", "minorista"], puedeCambiar: true };
    resultadoRpc = { ok: true, codigo: "ok" }; cookieLanza = false;
    colaRpc = [];
    llamadasRpc.length = 0; cookiesEscritas.length = 0; revalidaciones = 0;
  });

  test("RPC ok: mueve el contexto y luego la cookie", async () => {
    const r = await cambiarTenant("minorista");
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(llamadasRpc, ["minorista"]);
    assert.deepEqual(cookiesEscritas, ["minorista"]);
    assert.equal(revalidaciones, 1);
  });

  for (const codigo of ["sin_contexto", "sesion_inexistente", "sin_sesion", "error", "usuario_inactivo"]) {
    test(`RPC falla (${codigo}): NO cambia la cookie, NO revalida y devuelve el error`, async () => {
      resultadoRpc = { ok: false, codigo };
      const r = await cambiarTenant("minorista");
      assert.equal(r.ok, false);
      assert.match((r as { error: string }).error, /\S/);
      assert.deepEqual(cookiesEscritas, []);
      assert.equal(revalidaciones, 0);
    });
  }

  test("sin vínculo de sesión el mensaje pide volver a ingresar", async () => {
    resultadoRpc = { ok: false, codigo: "sin_contexto" };
    const r = await cambiarTenant("minorista");
    assert.match((r as { error: string }).error, /vuelve a ingresar/);
  });

  test("la RPC lanza una excepción: tampoco se toca la cookie", async () => {
    resultadoRpc = "lanza";
    const r = await cambiarTenant("minorista");
    assert.equal(r.ok, false);
    assert.deepEqual(cookiesEscritas, []);
  });

  test("la cookie no se puede escribir tras mover la base: devuelve el contexto a la agencia anterior", async () => {
    cookieLanza = true;
    const r = await cambiarTenant("minorista");
    assert.equal(r.ok, false);
    assert.deepEqual(llamadasRpc, ["minorista", "mayorista"]);
    assert.equal(revalidaciones, 0);
  });

  test("Minorista -> Mayorista: RPC ok, cookie falla y la RESTAURACIÓN también falla -> exige recargar y no deja cookie", async () => {
    perfil = { tenant: "minorista", permitidos: ["mayorista", "minorista"], puedeCambiar: true };
    colaRpc = [{ ok: true, codigo: "ok" }, { ok: false, codigo: "error" }];
    cookieLanza = true;
    const r = await cambiarTenant("mayorista");
    assert.equal(r.ok, false);
    assert.equal((r as { recargar?: boolean }).recargar, true);
    assert.match((r as { error: string }).error, /a medias/);
    assert.deepEqual(llamadasRpc, ["mayorista", "minorista"]);
    assert.deepEqual(cookiesEscritas, []);
    assert.equal(revalidaciones, 1);
  });

  test("Minorista -> Mayorista: la restauración LANZA una excepción -> también exige recargar", async () => {
    perfil = { tenant: "minorista", permitidos: ["mayorista", "minorista"], puedeCambiar: true };
    colaRpc = [{ ok: true, codigo: "ok" }, "lanza"];
    cookieLanza = true;
    const r = await cambiarTenant("mayorista");
    assert.equal((r as { recargar?: boolean }).recargar, true);
  });

  test("cookie falla pero la restauración sale bien: error normal, SIN recargar", async () => {
    perfil = { tenant: "minorista", permitidos: ["mayorista", "minorista"], puedeCambiar: true };
    colaRpc = [{ ok: true, codigo: "ok" }, { ok: true, codigo: "ok" }];
    cookieLanza = true;
    const r = await cambiarTenant("mayorista");
    assert.equal(r.ok, false);
    assert.equal((r as { recargar?: boolean }).recargar, undefined);
  });

  test("agencia no permitida: ni RPC ni cookie", async () => {
    perfil = { tenant: "mayorista", permitidos: ["mayorista"], puedeCambiar: false };
    const r = await cambiarTenant("minorista");
    assert.equal(r.ok, false);
    assert.deepEqual(llamadasRpc, []);
    assert.deepEqual(cookiesEscritas, []);
  });

  test("rol sin cambio de agencia, su propia agencia: sin RPC, cookie normal", async () => {
    perfil = { tenant: "mayorista", permitidos: ["mayorista"], puedeCambiar: false };
    const r = await cambiarTenant("mayorista");
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(llamadasRpc, []);
    assert.deepEqual(cookiesEscritas, ["mayorista"]);
  });
});

test("el selector muestra el error y no recarga cuando el cambio falla", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../app/(dashboard)/TenantSwitcher.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(!r\.ok\) \{[\s\S]*?setError\(r\.error\);[\s\S]*?return;/);
  assert.ok(src.indexOf("setError(r.error)") < src.lastIndexOf("window.location.reload()"));
  assert.match(src, /role="alert"/);
  // Doble fallo: recarga (sin quedarse con la vista vieja) antes de mostrar un error que desaparecería.
  assert.match(src, /if \(r\.recargar\) \{ window\.location\.reload\(\); return; \}/);
  assert.ok(src.indexOf("r.recargar") < src.indexOf("setError(r.error)"));
});
