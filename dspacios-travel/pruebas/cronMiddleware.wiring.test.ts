import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("cron: el proxy deja llegar a Vercel y cada handler conserva su secreto", () => {
  const proxy = leer("proxy.ts");
  const rutas = [
    "/api/cron/liberar-vencidas",
    "/api/cron/notificaciones",
    "/api/cron/reconciliar-financiero",
  ];

  test("el bypass es una lista cerrada con las tres rutas registradas", () => {
    for (const ruta of rutas) assert.match(proxy, new RegExp(`"${ruta}"`));
    assert.match(proxy, /RUTAS_CRON\.has\(pathname\)/);
    assert.doesNotMatch(proxy, /pathname\.startsWith\("\/api\/cron/);
  });

  test("el bypass ocurre antes de consultar la sesion de Supabase", () => {
    const inicioProxy = proxy.indexOf("export async function proxy(");
    const bypass = proxy.indexOf("RUTAS_CRON.has(pathname)", inicioProxy);
    const auth = proxy.indexOf("supabase.auth.getUser()", inicioProxy);
    assert.ok(inicioProxy >= 0 && bypass > inicioProxy && auth > bypass);
  });

  for (const ruta of rutas) {
    test(`${ruta} falla cerrado sin CRON_SECRET o con Bearer invalido`, () => {
      const fuente = leer(`app${ruta}/route.ts`);
      assert.match(fuente, /process\.env\.CRON_SECRET/);
      assert.match(fuente, /if \(!secret\)/);
      assert.match(fuente, /status: 503/);
      assert.match(fuente, /auth !== `Bearer \$\{secret\}`/);
      assert.match(fuente, /status: 401/);
    });
  }
});
