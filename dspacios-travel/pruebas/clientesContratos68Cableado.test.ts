// #68 (migración 221) — cableado estático: qué NO puede hacer la superficie «Clientes de contratos».
// Son aserciones sobre el TEXTO de los archivos (sin comentarios): no ejecutan SQL ni la página. La ejecución real
// está en test_221_clientes_contratos_crm.sh (Postgres + PostgREST) y en clientesContratos68UI.react.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const HELPER = "lib/crm/clientesContratos68.ts";
const LISTA = "app/(crm)/crm/clientes-contratos/page.tsx";
const FICHA = "app/(crm)/crm/clientes-contratos/[numero_contrato]/page.tsx";
const SUPERFICIE = [HELPER, LISTA, FICHA];

test("la página no lee crm_contactos ni las tablas de campañas (separado de Contactos)", () => {
  for (const f of SUPERFICIE) {
    const c = sinComentarios(leer(f));
    assert.ok(!/crm_contactos|crm_campan|crm_difusion|crm_envio|crm_leads/.test(c), f);
  }
  const sql = leer("supabase/migrations/20260601000221_clientes_contratos_crm.sql").replace(/--.*$/gm, "").replace(/comment on function[\s\S]*?';/gi, "");
  assert.ok(!/crm_contactos/.test(sql), "la migración tampoco cruza con Contactos");
});

test("solo el cliente de sesión: sin service-role ni lectura directa de ventas, de su vista o de otras tablas del contrato", () => {
  for (const f of SUPERFICIE) {
    const c = sinComentarios(leer(f));
    assert.ok(!/createAdminClient|service[_-]?role|SUPABASE_SERVICE/i.test(c), `${f}: sin service-role`);
    assert.ok(!/\.from\(\s*["'](ventas|ventas_basica|abonos|cuentas_por_pagar|contrato_[a-z_]+|usuarios_basica)["']/.test(c), `${f}: sin lecturas directas del contrato`);
  }
  // La única tabla que toca la superficie es usuarios, para ocultar el módulo (rol y activo del propio actor).
  const helper = sinComentarios(leer(HELPER));
  assert.deepEqual([...helper.matchAll(/\.from\(\s*["']([a-z_]+)["']/g)].map((m) => m[1]), ["usuarios"]);
  assert.deepEqual(
    [...helper.matchAll(/\.rpc\(\s*["']([a-z_0-9]+)["']/g)].map((m) => m[1]).sort(),
    ["crm_contrato_cliente_ficha", "crm_contratos_clientes_buscar"],
  );
});

test("la página no manda datos de actor ni de asesor a la RPC y solo el superadmin envía filtro de agencia", () => {
  const helper = sinComentarios(leer(HELPER));
  assert.ok(!/p_asesor|p_rol|p_usuario|p_email|p_actor/.test(helper));
  assert.match(helper, /return rol === "superadmin" \? tenantActivo : null/);
  const lista = sinComentarios(leer(LISTA));
  assert.match(lista, /tenant:\s*tenantParaRpc\(rol,\s*tenantActivo\)/);
});

test("el texto buscado vive en una cookie httpOnly, no en la URL", () => {
  const lista = sinComentarios(leer(LISTA));
  assert.match(lista, /httpOnly:\s*true/);
  assert.match(lista, /ck\.set\(COOKIE_BUSQUEDA/);
  assert.ok(!/searchParams[\s\S]{0,80}\bq\b/.test(lista.replace(/c\?:\s*string/g, "")), "no se lee q de searchParams");
  assert.ok(!/\?q=|&q=/.test(lista));
  // Lo único que va en la URL es el cursor (un número de contrato), nunca nombre, documento, correo ni teléfono.
  assert.match(lista, /\?c=\$\{encodeURIComponent\(/);
});

test("sin escrituras ni rutas de consentimiento: la superficie es de solo lectura", () => {
  for (const f of SUPERFICIE) {
    const c = sinComentarios(leer(f));
    // `\)\.delete\(` = borrado de una consulta Supabase; `ck.delete(` (cookie de búsqueda) no es DML.
    assert.ok(!/\.(insert|update|upsert)\(|\)\.delete\(/.test(c), `${f}: sin DML`);
    assert.ok(!/consentimiento|acepta_publicidad|opt[-_ ]?in|agregar a campa/i.test(c), `${f}: sin inferir consentimiento`);
    assert.ok(!/groupBy|agrupar|Map<\s*string,\s*ContratoCliente\[\]/i.test(c), `${f}: sin agrupar por persona`);
  }
});

test("el menú del CRM trae la entrada y no toca las demás", () => {
  const layout = leer("app/(crm)/layout.tsx");
  assert.match(layout, /href:\s*"\/crm\/clientes-contratos",\s*label:\s*"Clientes de contratos"/);
  for (const href of ["/crm\"", "/crm/leads", "/crm/pasajeros", "/crm/personas-cotizacion", "/crm/campanas", "/crm/difusion", "/crm/b2b", "/crm/email"]) {
    assert.ok(layout.includes(`href: "${href.replace(/"$/, "")}"`), href);
  }
});

test("la migración 221 existe, usa las dos funciones esperadas y la guarda de homónimos de venta", () => {
  const rel = "supabase/migrations/20260601000221_clientes_contratos_crm.sql";
  assert.ok(existsSync(new URL(`../${rel}`, import.meta.url)));
  const m = leer(rel);
  assert.match(m, /crm_contratos_clientes_buscar/);
  assert.match(m, /crm_contrato_cliente_ficha/);
  assert.match(m, /soy_asesor_del_contrato\(b\.numero_contrato\)/);
  assert.match(m, /count\(\*\)\s*from public\.usuarios u2[\s\S]*u2\.activo is true[\s\S]*u2\.tenant = v_t[\s\S]*\)\s*=\s*1/);
  for (const prohibida of ["alter table", "create policy", "drop policy", "create view", "create or replace view"]) {
    assert.ok(!m.toLowerCase().replace(/--.*$/gm, "").includes(prohibida), `la 221 no hace «${prohibida}»`);
  }
});

test("el workflow de #68 nombra las pruebas TS y no usa secretos ni pull_request_target", () => {
  const w = leer("../.github/workflows/test-221-clientes-contratos-68.yml");
  for (const t of ["clientesContratos68Acceso.test.ts", "clientesContratos68Cableado.test.ts", "clientesContratos68UI.react.ts"]) {
    assert.ok(w.includes(t), t);
    assert.ok(existsSync(new URL(`../pruebas/${t}`, import.meta.url)), `${t} existe`);
  }
  assert.ok(!/pull_request_target|secrets\./.test(w.replace(/^\s*#.*$/gm, "")));
  assert.match(w, /permissions:\s*\n\s*contents: read/);
});

test("types/database.ts declara las dos funciones con el contrato de la 221", () => {
  const t = leer("types/database.ts");
  const i = t.indexOf("crm_contratos_clientes_buscar: {");
  const j = t.indexOf("crm_contrato_cliente_ficha: {");
  assert.ok(i > 0 && j > 0);
  const bloque = t.slice(i, j + 1200);
  for (const col of ["p_tenant", "p_busqueda", "p_cursor", "p_tam", "p_numero_contrato", "hay_mas", "numero_contrato", "cliente_documento"]) {
    assert.ok(bloque.includes(col), col);
  }
  assert.ok(!/precio_venta|costo_|share_token/.test(bloque.slice(0, bloque.indexOf("crm_contrato_cliente_ficha") + 1200)), "sin columnas financieras");
});
