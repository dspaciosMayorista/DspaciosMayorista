// 294 · Excepción de mantenimiento en los clientes de SERVIDOR (lib/supabase/mantenimiento.ts): cabeceras, operador verificado, memo por petición,
// solicitudes añadidas, nada de registros, y que el secreto no tiene camino al navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fetchMantenimiento, memoPorPeticion, CABECERA_CLAVE, CABECERA_OPERADOR } from "../lib/supabase/mantenimiento.ts";

const SECRETO = "s".repeat(16) + "e".repeat(16) + "cret0";
const REST = "https://x.supabase.co/rest/v1/ventas?select=*";
const AUTH = "https://x.supabase.co/auth/v1/user";
const STORAGE = "https://x.supabase.co/storage/v1/object/contratos/a.pdf";

function falso() {
  const llamadas: Array<{ url: string; headers: Headers }> = [];
  const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    llamadas.push({ url, headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)) });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { base, llamadas };
}

test("sin MANTENIMIENTO_CLAVE no se toca el fetch (undefined → supabase usa el de siempre; 0 solicitudes extra)", () => {
  let verificaciones = 0;
  assert.equal(fetchMantenimiento(async () => { verificaciones++; return "u"; }, undefined), undefined);
  assert.equal(fetchMantenimiento(async () => { verificaciones++; return "u"; }, ""), undefined);
  assert.equal(verificaciones, 0);
});

test("con la clave y un usuario verificado: PostgREST y Storage llevan clave + operador; Auth nunca; las cabeceras existentes se conservan", async () => {
  const { base, llamadas } = falso();
  const f = fetchMantenimiento(async () => "11111111-1111-4111-8111-111111111111", SECRETO, base)!;
  await f(REST, { headers: { "x-contratos": "{\"DTM-1\":\"u\"}", apikey: "k" } });
  await f(new Request(STORAGE, { method: "POST", headers: { authorization: "Bearer t" } }));
  await f(AUTH, { headers: { apikey: "k" } });
  assert.equal(llamadas[0].headers.get(CABECERA_CLAVE), SECRETO);
  assert.equal(llamadas[0].headers.get(CABECERA_OPERADOR), "11111111-1111-4111-8111-111111111111");
  assert.equal(llamadas[0].headers.get("x-contratos"), "{\"DTM-1\":\"u\"}", "la identidad de contrato (#75) no se pierde");
  assert.equal(llamadas[1].headers.get(CABECERA_CLAVE), SECRETO, "Storage también");
  assert.equal(llamadas[1].headers.get("authorization"), "Bearer t");
  assert.equal(llamadas[2].headers.get(CABECERA_CLAVE), null, "Auth no recibe el secreto");
});

test("sin usuario verificado (cron sin sesión, visitante): no se añade NADA — la base bloquea", async () => {
  const { base, llamadas } = falso();
  const f = fetchMantenimiento(async () => null, SECRETO, base)!;
  await f(REST, { method: "POST" });
  assert.equal(llamadas[0].headers.get(CABECERA_CLAVE), null);
  assert.equal(llamadas[0].headers.get(CABECERA_OPERADOR), null);
});

test("una verificación por PETICIÓN aunque se creen varios clientes; peticiones distintas no comparten; un fallo de verificación = sin excepción", async () => {
  let n = 0;
  const memo = memoPorPeticion(async () => { n++; return "u-" + n; });
  const peticionA = {}, peticionB = {};
  const r = await Promise.all([memo(peticionA), memo(peticionA), memo(peticionA)]);
  assert.deepEqual(r, ["u-1", "u-1", "u-1"]); assert.equal(n, 1);
  assert.equal(await memo(peticionB), "u-2"); assert.equal(n, 2);
  const falla = memoPorPeticion(async () => { throw new Error("auth caído"); });
  assert.equal(await falla({}), null);
});

test("solicitudes añadidas (medido): sin clave 0; con clave 1 verificación por petición, sin reintentos ni sondeos", async () => {
  const { base, llamadas } = falso();
  let verificaciones = 0;
  const memo = memoPorPeticion(async () => { verificaciones++; return "11111111-1111-4111-8111-111111111111"; });
  const peticion = {};
  const f = fetchMantenimiento(() => memo(peticion), SECRETO, base)!;
  for (let i = 0; i < 25; i++) await f(REST, { method: i % 2 ? "POST" : "GET" });
  assert.equal(llamadas.length, 25, "cada petición sale UNA vez (sin reintentos)");
  assert.equal(verificaciones, 1, "una sola verificación de usuario para toda la petición");
  await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(llamadas.length, 25, "nada sigue saliendo después (sin sondeos)");
});

test("el secreto no se registra: ninguna salida de consola en todo el recorrido", async () => {
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const salidas: string[] = [];
  for (const k of Object.keys(orig) as Array<keyof typeof orig>) (console as unknown as Record<string, (...a: unknown[]) => void>)[k] = (...a: unknown[]) => { salidas.push(a.map(String).join(" ")); };
  try {
    const { base } = falso();
    const f = fetchMantenimiento(async () => "u", SECRETO, base)!;
    await f(REST, { method: "POST" });
    await fetchMantenimiento(async () => { throw new Error("x"); }, SECRETO, base)!(REST).catch(() => undefined);
  } finally { Object.assign(console, orig); }
  assert.deepEqual(salidas, []);
});

const RAIZ = path.resolve(import.meta.dirname, "..");
const fuentes = (dir: string): string[] => fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === "node_modules" || e.name.startsWith(".") ? [] : fuentes(path.join(dir, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []);
const app = [...fuentes("app"), ...fuentes("components"), ...fuentes("lib")];

test("ningún componente de CLIENTE importa el módulo ni los clientes de servidor; el navegador (client.ts) no lo usa", () => {
  const malos = app.filter((f) => {
    const t = fs.readFileSync(path.join(RAIZ, f), "utf8");
    return /^\s*["']use client["']/m.test(t.slice(0, 200)) && /@\/lib\/supabase\/(mantenimiento|admin|server)["']/.test(t);
  });
  assert.deepEqual(malos, []);
  assert.doesNotMatch(fs.readFileSync(path.join(RAIZ, "lib/supabase/client.ts"), "utf8"), /mantenimiento|MANTENIMIENTO_CLAVE/);
});

test("la variable del secreto no es pública en ningún sitio y el módulo no escribe en consola", () => {
  const publicos = app.filter((f) => /NEXT_PUBLIC_MANTENIMIENTO/.test(fs.readFileSync(path.join(RAIZ, f), "utf8")));
  assert.deepEqual(publicos, []);
  const usos = app.filter((f) => /process\.env\.MANTENIMIENTO_CLAVE/.test(fs.readFileSync(path.join(RAIZ, f), "utf8")));
  assert.deepEqual(usos.map((f) => f.replace(/\\/g, "/")), ["lib/supabase/mantenimiento.ts"], "solo el módulo de servidor lee la variable");
  assert.doesNotMatch(fs.readFileSync(path.join(RAIZ, "lib/supabase/mantenimiento.ts"), "utf8"), /console\./);
});

test("server.ts y admin.ts pasan el fetch de mantenimiento; ningún otro archivo de app/components/lib crea clientes de Supabase (proxy.ts solo lee la sesión)", () => {
  for (const f of ["lib/supabase/server.ts", "lib/supabase/admin.ts"]) assert.match(fs.readFileSync(path.join(RAIZ, f), "utf8"), /fetch: fetchMantenimiento\(usuarioDeSesion\)/, f);
  // importación REAL (no `import type`) de un constructor de cliente desde los paquetes de Supabase
  const creadores = app.filter((f) => /^import\s+(?!type\b)\{[^}]*\bcreate(Server|Browser)?Client\b[^}]*\}\s*from\s*["']@supabase\/(supabase-js|ssr)["']/m.test(fs.readFileSync(path.join(RAIZ, f), "utf8")));
  assert.deepEqual(creadores.map((f) => f.replace(/\\/g, "/")).filter((f) => !f.startsWith("lib/supabase/")), [], "clientes creados fuera de lib/supabase (no llevarían la excepción)");
});
