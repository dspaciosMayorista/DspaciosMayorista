import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

test("la cotizacion B2C por share_token abre sin login", () => {
  const proxy = leer("proxy.ts");
  const checkout = leer("app/tarifario/checkout/actions.ts");
  const paginaPublica = leer("app/cot/[token]/page.tsx");

  assert.match(proxy, /RUTAS_PUBLICAS\s*=\s*\[[\s\S]*?"\/cot\/"/);
  assert.match(checkout, /`\$\{origin\}\/cot\/\$\{row\.share_token\}`/);
  assert.match(paginaPublica, /\.eq\("share_token",\s*token\)/);
  assert.doesNotMatch(paginaPublica, /auth\.getUser\(/);
});
