// #14-A — el BNC (impuesto no comisionable) que liquida el servidor NO depende de lo que la sesión pueda leer: un aliado B2B (sin acceso a armado_paquetes por RLS) obtenía impuesto 0 y su plan
// de comisión nacía con la base inflada (hallado en el recorrido real de la app compilada). Prueba de cableado + recorrido real: 102/humo (escenario 2).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../lib/reservar/computo.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("el impuesto fijo del paquete se lee con la llave de servicio (con la sesión solo si no hay llave), nunca solo con la sesión", () => {
  const i = src.indexOf("const lectorImpuesto");
  assert.ok(i > 0, "existe el lector del impuesto");
  const trozo = src.slice(i, i + 700);
  assert.match(trozo, /process\.env\.SUPABASE_SERVICE_ROLE_KEY \? createAdminClient\(\) : sb/);
  assert.match(trozo, /srv:armado_paquetes:impuesto_fijo/);
  assert.match(trozo, /lectorImpuesto\s*\n\s*\.from\("armado_paquetes"\)/);
  assert.doesNotMatch(src, /sb:armado_paquetes:impuesto_fijo/, "ya no se lee con la sesión");
});
