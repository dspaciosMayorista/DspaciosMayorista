import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Hotfix de acceso a `crm_contactos` (migración 207). Fija el contrato
// entre la migración y los consumidores: la RLS es la frontera y cada alta
// nace con agencia. El comportamiento real (sesiones por rol/agencia) se
// prueba en supabase/scripts/pruebas/test_207_crm_contactos_acceso.sh.
// CRLF → LF: en Windows el checkout puede traer CRLF (core.autocrlf).
const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const migracion = leer("supabase/migrations/20260601000207_crm_contactos_acceso.sql");
const rollback = leer("supabase/scripts/rollback_207_crm_contactos_acceso.sql");
const atribuir = leer("supabase/scripts/atribuir_207_crm_contactos_acceso.sql");
const recuperacion = leer("supabase/scripts/recuperacion_207_crm_contactos_acceso.sql");
const preflight = leer("supabase/scripts/preflight_207_crm_contactos_acceso.sql");
const postcheck = leer("supabase/scripts/postcheck_207_crm_contactos_acceso.sql");
const matrizLocal = leer("supabase/scripts/pruebas/test_207_crm_contactos_matriz_local.sql");
const sonda = leer("supabase/scripts/pruebas/api_207_crm_contactos_acceso.mjs");
const accionesCrm = leer("app/(crm)/crm/actions.ts");
const accionesB2B = leer("app/(crm)/crm/b2b/actions.ts");
const checkout = leer("app/tarifario/checkout/actions.ts");
const campanas = leer("app/(crm)/crm/campanas/actions.ts");
const paginaCrm = leer("app/(crm)/crm/page.tsx");
const detalleCrm = leer("app/(crm)/crm/[id]/page.tsx");
const tipos = leer("types/database.ts");

// Quita comentarios SQL para no confundir la explicación con el código.
const sinComentarios = (sql: string) => sql.replace(/--.*$/gm, "");
// Además quita literales de texto: 'INSERT' como valor no es una sentencia.
const sentencias = (sql: string) => sinComentarios(sql).replace(/'[^']*'/g, "''");
const ESCRITURA_O_SESION = /\b(insert|update|delete|truncate|create|alter|drop|grant|revoke|begin|commit|rollback|set\s+role|set\s+local|copy)\b|\bdo\s+\$\$/i;

describe("crm_contactos: migración de acceso", () => {
  const cuerpo = sinComentarios(migracion);

  test("no vuelve a crear la lectura abierta a cualquier UID ni policies para public/anon", () => {
    assert.doesNotMatch(cuerpo, /create policy[^;]*auth\.uid\(\)\s+is\s+not\s+null/i);
    assert.doesNotMatch(cuerpo, /using\s*\(\s*true\s*\)/i);
    assert.doesNotMatch(cuerpo, /create policy[^;]*\bto\s+(public|anon)\b/i);
    assert.match(cuerpo, /drop policy if exists "crm_contactos: lectura"/);
    assert.match(cuerpo, /drop policy if exists "crm_contactos: escritura"/);
  });

  test("las cuatro policies nuevas son de authenticated y exigen rol interno + agencia", () => {
    const policies = cuerpo.match(/create policy "crm_contactos: interno [^"]+"[\s\S]*?;/g) ?? [];
    assert.equal(policies.length, 4);
    for (const p of policies) {
      assert.match(p, /\bto authenticated\b/);
      assert.match(p, /public\.mi_rol\(\) in \('superadmin','gerencia','administracion','operaciones','venta'\)/);
      assert.match(p, /puede_ver_tenant\(tenant\)/);
      assert.doesNotMatch(p, /control_vuelo|'agencia'|'freelance'|cliente_final/);
    }
  });

  test("lo no atribuido (tenant NULL) solo para superadmin y gerencia; insertar nunca deja NULL", () => {
    assert.match(cuerpo, /tenant is null and public\.mi_rol\(\) in \('superadmin','gerencia'\)/);
    const insertar = cuerpo.match(/create policy "crm_contactos: interno insertar"[\s\S]*?;/)?.[0] ?? "";
    assert.match(insertar, /tenant is not null/);
    assert.doesNotMatch(insertar, /tenant is null/);
  });

  test("no atribuye filas históricas dentro de la migración", () => {
    assert.doesNotMatch(cuerpo, /update\s+public\.crm_contactos/i);
    assert.match(cuerpo, /add column if not exists tenant text;/);
    assert.doesNotMatch(cuerpo, /tenant text not null/i);
  });

  test("el default no adivina sin sesión y el tenant atribuido no se reescribe", () => {
    assert.match(cuerpo, /case when auth\.uid\(\) is null then null else public\.mi_tenant\(\) end/);
    assert.match(cuerpo, /old\.tenant is not null and new\.tenant is distinct from old\.tenant/);
  });

  test("anon pierde privilegios y no aparece ninguna vista, RPC ni SECURITY DEFINER nuevo", () => {
    assert.match(cuerpo, /revoke all on table public\.crm_contactos from anon;/);
    assert.match(cuerpo, /revoke truncate, references, trigger on table public\.crm_contactos from authenticated;/);
    assert.doesNotMatch(cuerpo, /create (or replace )?view/i);
    assert.doesNotMatch(cuerpo, /security definer/i);
  });

  test("no toca la 042/047 ni crm_leads", () => {
    assert.doesNotMatch(cuerpo, /uq_crm_documento|uq_crm_email|uq_crm_telefono/);
    assert.doesNotMatch(cuerpo, /crm_leads/);
  });

  test("re-correr la migración borra también las policies de recuperación", () => {
    for (const cmd of ["lectura", "insertar", "actualizar", "eliminar"]) {
      assert.match(cuerpo, new RegExp(`drop policy if exists "crm_contactos: recuperacion ${cmd}"`));
    }
  });

  test("rollback de último recurso: candado explícito y conserva la columna", () => {
    const rb = sinComentarios(rollback);
    assert.doesNotMatch(rb, /drop column/i);
    assert.match(rollback, /ÚLTIMO RECURSO/);
    // El candado va ANTES de cualquier DROP/CREATE.
    const candado = rb.indexOf("current_setting('app.reabrir_crm_contactos', true)");
    assert.ok(candado > 0 && candado < rb.indexOf("drop policy"), "el candado debe ir antes de tocar policies");
    assert.match(rb, /<> 'REABRIR_FUGA:' \|\| txid_current\(\)/);
  });

  test("rollback: la confirmación es LOCAL a la transacción y viene apagada", () => {
    // La línea de confirmación existe solo comentada en el archivo distribuido…
    assert.match(rollback, /^-- select set_config\('app\.reabrir_crm_contactos', 'REABRIR_FUGA:' \|\| txid_current\(\), true\);$/m);
    assert.doesNotMatch(sinComentarios(rollback), /set_config\('app\.reabrir_crm_contactos'/);
    // …y no hay ningún `set` de sesión que la sobreviva.
    assert.doesNotMatch(sinComentarios(rollback), /\bset\s+app\.reabrir_crm_contactos\b/i);
    // Va dentro del begin, antes del candado; el candado antes de tocar policies.
    const rb = rollback;
    const ini = rb.indexOf("\nbegin;\n");
    const conf = rb.indexOf("-- select set_config('app.reabrir_crm_contactos'");
    const candado = rb.indexOf("current_setting('app.reabrir_crm_contactos', true)");
    const primerDrop = rb.indexOf("\ndrop policy");
    assert.ok(ini > 0 && ini < conf && conf < candado && candado < primerDrop);
  });

  test("recuperación conserva el cierre: solo authenticated + rol interno, sin uid() ni roles externos", () => {
    const rec = sinComentarios(recuperacion);
    const policies = rec.match(/create policy "crm_contactos: recuperacion [^"]+"[\s\S]*?;/g) ?? [];
    assert.equal(policies.length, 4);
    for (const p of policies) {
      assert.match(p, /\bto authenticated\b/);
      assert.match(p, /public\.mi_rol\(\) in \('superadmin','gerencia','administracion','operaciones','venta'\)/);
    }
    assert.doesNotMatch(rec, /auth\.uid\(\)|\bto\s+(public|anon)\b|control_vuelo|'agencia'|'freelance'|cliente_final|grant /i);
  });

  test("la atribución histórica arranca apagada y en ROLLBACK", () => {
    assert.match(atribuir, /\('E1', false\)/);
    assert.match(atribuir, /\('E2', false\)/);
    assert.match(atribuir, /^rollback;$/m);
  });
});

describe("crm_contactos: scripts para Producción son de solo lectura", () => {
  test("preflight y postcheck: sin escrituras, transacciones ni cambio de rol", () => {
    assert.doesNotMatch(sentencias(preflight), ESCRITURA_O_SESION);
    assert.doesNotMatch(sentencias(postcheck), ESCRITURA_O_SESION);
  });

  test("la matriz con INSERT/UPDATE/DELETE es solo local y aborta fuera de una base desechable", () => {
    assert.match(matrizLocal, /SOLO BASE LOCAL DESECHABLE/);
    const guarda = matrizLocal.indexOf("current_database() !~ '^crm(acc|api)_[0-9]+$'");
    assert.ok(guarda > 0 && guarda < matrizLocal.indexOf("insert into public.crm_contactos"), "la guarda debe ir antes de cualquier mutación");
  });

  test("sonda API: solo HEAD con conteo, sin mutaciones, sin service-role", () => {
    assert.doesNotMatch(sonda, /\.(insert|update|upsert|delete|rpc)\(/);
    assert.doesNotMatch(sonda, /createAdminClient|service_role|SERVICE_ROLE/);
    assert.match(sonda, /select\("id", \{ count: "exact", head: true \}\)/);
    assert.equal((sonda.match(/from\("crm_contactos"\)/g) ?? []).length, 1);
    assert.match(sonda, /signOut\(\{ scope: "local" \}\)/);
  });

  test("sonda API: en post exige los totales del postcheck y falla también por PÉRDIDA de acceso", () => {
    assert.match(sonda, /falta --totales=/);
    assert.match(sonda, /process\.exit\(2\)/);
    assert.match(sonda, /if \(visto > esp\) problemas\.push\(`FUGA:/);
    assert.match(sonda, /if \(visto < esp\) problemas\.push\(`PÉRDIDA de acceso legítimo:/);
    // interno = total de su agencia; gerencia/superadmin = las dos + sin atribuir.
    assert.match(sonda, /esperado = \{ propia: TOTALES\[perfil\.tenant\], otra: 0, sin: 0 \}/);
    assert.match(sonda, /esperado = \{ propia: TOTALES\[perfil\.tenant\], otra: TOTALES\[otra\], sin: TOTALES\.null \}/);
  });

  test("sonda API: la fase pre no filtra por tenant y un error nunca cuenta como cero", () => {
    const pre = sonda.slice(sonda.indexOf('if (FASE === "pre")'), sonda.indexOf("// ── post ──"));
    assert.ok(pre.length > 0);
    assert.doesNotMatch(pre, /q\.(eq|is|neq)\(/);
    assert.match(sonda, /if \(error \|\| typeof count !== "number"\) return \{ ok: false, status, n: null \}/);
    assert.doesNotMatch(sonda, /\?\? 0/);
  });
});

describe("crm_contactos: consumidores", () => {
  test("CRM interno: altas con la agencia activa y sesión del usuario, nunca service-role", () => {
    assert.match(accionesCrm, /import \{ getTenant \} from "@\/lib\/tenant\.server";/);
    assert.equal((accionesCrm.match(/const tenant = await getTenant\(\);/g) ?? []).length, 2);
    assert.match(accionesCrm, /insert\(\{\n\s+tenant,/);
    assert.match(accionesCrm, /const fila: CrmInsert = \{\n\s+tenant,/);
    assert.doesNotMatch(accionesCrm, /createAdminClient|SUPABASE_SERVICE_ROLE/);
  });

  test("CRM interno: editar/eliminar sin fila visible ya no responde ok", () => {
    assert.match(accionesCrm, /\.eq\("id", id\)\.select\("id"\);[\s\S]*?if \(!data\?\.length\) return \{ ok: false, error: SIN_ACCESO \}/);
    assert.match(accionesCrm, /\.delete\(\)\.eq\("id", id\)\.select\("id"\);\n\s+if \(error\)[^\n]*\n\s+if \(!data\?\.length\) return \{ ok: false, error: SIN_ACCESO \}/);
    // Actualizar no reasigna agencia.
    const actualizar = accionesCrm.slice(accionesCrm.indexOf("export async function actualizarContacto"), accionesCrm.indexOf("export async function eliminarContacto"));
    assert.doesNotMatch(actualizar, /tenant/);
  });

  test("cargue B2B: contacto con agencia activa, sesión del usuario y error visible", () => {
    assert.match(accionesB2B, /const tenant = await getTenant\(\);/);
    assert.match(accionesB2B, /const \{ error: errCrm \} = await sb\.from\("crm_contactos"\)\.insert\(\{\n\s+tenant,/);
    assert.match(accionesB2B, /if \(errCrm\)/);
    assert.doesNotMatch(accionesB2B, /admin\.from\("crm_contactos"\)/);
  });

  test("checkout público: el contacto lleva la misma agencia fija que su cotización", () => {
    const i = checkout.indexOf('admin.from("crm_contactos").insert({');
    assert.ok(i > 0);
    const bloque = checkout.slice(i, checkout.indexOf("});", i));
    assert.match(bloque, /tenant: "mayorista",/);
  });

  test("lecturas del CRM siguen con cliente de sesión (la RLS filtra)", () => {
    for (const src of [campanas, paginaCrm, detalleCrm]) {
      assert.doesNotMatch(src, /createAdminClient|SUPABASE_SERVICE_ROLE/);
    }
  });

  test("tipos: tenant en Row e Insert de crm_contactos", () => {
    const i = tipos.indexOf("crm_contactos: {");
    const bloque = tipos.slice(i, tipos.indexOf("Relationships", i));
    assert.match(bloque, /tenant: string \| null;/);
    assert.match(bloque, /tenant\?: string \| null;/);
  });
});
