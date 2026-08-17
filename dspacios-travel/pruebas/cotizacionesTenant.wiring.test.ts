import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// GUARDA CONTRA LA DIVERGENCIA — aislamiento por tenant de cotizaciones (V2)
//
// La migración 154 cierra la RLS de `cotizaciones`/`cotizacion_servicios`
// por tenant, pero la RLS sola no alcanza si el código de la aplicación
// vuelve a estampar/leer sin pasar por el contexto validado del servidor —
// exactamente el patrón que ya falló antes en `ventas.asesor` (emparejar
// por nombre) y en el checkout (confiar en un valor que puede mandar el
// cliente). Estas comprobaciones miran el CÓDIGO FUENTE, no el
// comportamiento en runtime (de eso se encarga
// `test_cotizaciones_tenant_rls.sql` contra una base real) — sirven para
// que un cambio futuro que reintroduzca el patrón viejo falle aquí, rápido
// y sin necesitar una base de datos.
// ───────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

test("el checkout público estampa tenant='mayorista' fijo, nunca desde el cliente", () => {
  const src = leer("app/tarifario/checkout/actions.ts");
  assert.match(
    src,
    /tenant:\s*"mayorista"/,
    "el insert de cotizaciones del checkout ya no estampa el literal 'mayorista'"
  );
  // No debe existir ningún camino donde el tenant salga de `input` (lo que
  // manda el navegador) en este archivo.
  assert.doesNotMatch(
    src,
    /tenant:\s*input\./,
    "el checkout público está leyendo `tenant` desde `input` — nunca debe aceptarlo del cliente"
  );
});

test("reservar/actions.ts: crearCotizacion usa getTenant() (contexto validado), no un valor fijo ni del cliente", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  assert.match(src, /import\s*\{\s*getTenant\s*\}\s*from\s*"@\/lib\/tenant\.server"/, "no importa getTenant()");
  const start = src.indexOf("export async function crearCotizacion(");
  const end = src.indexOf("export async function convertirCotizacion(");
  assert.ok(start !== -1 && end !== -1 && end > start, "no se pudo delimitar el cuerpo de crearCotizacion");
  const fn = src.slice(start, end);
  assert.match(fn, /tenant:\s*tenantCotizacion/, "crearCotizacion no estampa `tenant: tenantCotizacion`");
  assert.match(fn, /tenantCotizacion\s*=\s*await getTenant\(\)/, "crearCotizacion no resuelve tenantCotizacion con getTenant()");
});

test("reservar/actions.ts: convertirCotizacion y convertirCotizacionCarrito exigen tenant y conservan el de la cotización", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  for (const fnName of ["convertirCotizacion", "convertirCotizacionCarrito"]) {
    const start = src.indexOf(`export async function ${fnName}`);
    assert.notEqual(start, -1, `no se encontró ${fnName}`);
    const fn = src.slice(start, start + 4000);
    assert.match(fn, /if\s*\(!cot\.tenant\)/, `${fnName} no rechaza una cotización sin tenant`);
    assert.match(fn, /autorizaTenant\(ctx,\s*cot\.tenant\)/, `${fnName} no valida el acceso al tenant de la cotización`);
  }
  // convertirCotizacion pasa el tenant a reservarDesdeTarifario en vez de
  // dejar que el contrato resultante lo re-derive por su cuenta.
  const c1 = src.slice(src.indexOf("export async function convertirCotizacion("), src.indexOf("export async function convertirCotizacionCarrito"));
  assert.match(c1, /reservarDesdeTarifario\([^)]*\{\s*tenant:\s*cot\.tenant as Tenant\s*\}/, "convertirCotizacion no propaga el tenant a reservarDesdeTarifario");
  // convertirCotizacionCarrito estampa el mismo tenant en su propio insert de `ventas`.
  const c2 = src.slice(src.indexOf("export async function convertirCotizacionCarrito"));
  assert.match(c2, /tenant:\s*tenantCotizacion/, "convertirCotizacionCarrito no estampa tenant en el insert de ventas");
});

test("reservar/actions.ts: reservarDesdeTarifario nunca sobreescribe el tenant sin que se lo pidan explícitamente", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const start = src.indexOf("export async function reservarDesdeTarifario");
  const end = src.indexOf("export async function crearCotizacion(");
  assert.ok(start !== -1 && end !== -1 && end > start, "no se pudo delimitar el cuerpo de reservarDesdeTarifario");
  const fn = src.slice(start, end);
  assert.match(fn, /opts\?:\s*\{\s*tenant\?:\s*Tenant\s*\}/, "reservarDesdeTarifario perdió el parámetro opcional de tenant");
  assert.match(fn, /\.\.\.\(opts\?\.tenant\s*\?\s*\{\s*tenant:\s*opts\.tenant\s*\}\s*:\s*\{\}\)/, "el insert de ventas ya no condiciona el tenant a opts?.tenant");
});

test("reservar/actions.ts: actualizarVigenciaCotizacion y descartarCotizacion filtran por tenant salvo superadmin", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  for (const fnName of ["actualizarVigenciaCotizacion", "descartarCotizacion"]) {
    const start = src.indexOf(`export async function ${fnName}`);
    const fn = src.slice(start, start + 1200);
    assert.match(fn, /contextoCotizacion\(\)/, `${fnName} no usa contextoCotizacion()`);
    assert.match(fn, /if\s*\(!ctx\.superadmin\)\s*q\s*=\s*q\.eq\("tenant",\s*ctx\.tenant\)/, `${fnName} no filtra por tenant salvo superadmin`);
  }
});

test("manual-actions.ts: crearCotizacionManual usa getTenant(), y las conversiones/ediciones exigen acceso al tenant", () => {
  const src = leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
  assert.match(src, /import\s*\{\s*getTenant\s*\}\s*from\s*"@\/lib\/tenant\.server"/, "no importa getTenant()");
  assert.match(src, /import\s*\{\s*contextoCotizacion,\s*autorizaTenant\s*\}\s*from\s*"@\/lib\/cotizacion\/acceso"/, "no importa el helper de acceso");

  const crear = src.slice(src.indexOf("export async function crearCotizacionManual"), src.indexOf("export async function actualizarTitularCotizacionManual"));
  assert.match(crear, /tenant:\s*tenantCotizacion/, "crearCotizacionManual no estampa tenant");
  assert.match(crear, /tenantCotizacion\s*=\s*await getTenant\(\)/, "crearCotizacionManual no resuelve el tenant con getTenant()");

  for (const fnName of ["actualizarTitularCotizacionManual", "actualizarIncluyeCotizacionManual", "actualizarRecobroNinosCotizacionManual"]) {
    const start = src.indexOf(`export async function ${fnName}`);
    assert.notEqual(start, -1, `no se encontró ${fnName}`);
    const fn = src.slice(start, start + 1500);
    assert.match(fn, /autorizaTenant\(ctx,\s*cot\.tenant\)/, `${fnName} no valida el acceso al tenant antes de editar`);
  }

  const convertir = src.slice(src.indexOf("export async function convertirCotizacionManualAContrato"));
  assert.match(convertir, /if\s*\(!cot\.tenant\)/, "convertirCotizacionManualAContrato no rechaza una cotización sin tenant");
  assert.match(convertir, /autorizaTenant\(ctx,\s*cot\.tenant\)/, "convertirCotizacionManualAContrato no valida el acceso al tenant");
  assert.match(convertir, /tenant:\s*tenantCotizacion/, "convertirCotizacionManualAContrato no propaga el tenant al insert de ventas");
});

test("las páginas de cotización por id exigen acceso al tenant (cierre de la vía enumerable V2)", () => {
  for (const archivo of [
    "app/cotizacion/[id]/page.tsx",
    "app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx",
  ]) {
    const src = leer(archivo);
    assert.match(src, /import\s*\{\s*contextoCotizacion,\s*autorizaTenant\s*\}\s*from\s*"@\/lib\/cotizacion\/acceso"/, `${archivo} no importa el helper de acceso`);
    assert.match(src, /autorizaTenant\(/, `${archivo} no llama a autorizaTenant`);
    assert.match(src, /notFound\(\)/, `${archivo} no corta con notFound() cuando no autoriza`);
  }
  // generateMetadata de /cotizacion/[id] no debe poder devolver el título
  // real sin haber pasado por el mismo chequeo — si construyera el título
  // ANTES de comprobar el acceso, filtraría datos por fuera del render.
  const src = leer("app/cotizacion/[id]/page.tsx");
  const meta = src.slice(src.indexOf("export async function generateMetadata"), src.indexOf("export default async function"));
  assert.match(meta, /autorizaTenant\(/, "generateMetadata no valida el acceso — puede filtrar título/código/cliente");
});

test("/dashboard/cotizaciones (listado) filtra por tenant salvo superadmin", () => {
  const src = leer("app/(dashboard)/dashboard/cotizaciones/page.tsx");
  assert.match(src, /import\s*\{\s*contextoCotizacion\s*\}\s*from\s*"@\/lib\/cotizacion\/acceso"/, "no importa contextoCotizacion");
  assert.match(src, /if\s*\(ctx\.ok\s*&&\s*!ctx\.superadmin\)\s*q\s*=\s*q\.eq\("tenant",\s*ctx\.tenant\)/, "el listado no filtra por tenant salvo superadmin");
});

test("/cot/[token] sigue resolviendo únicamente por share_token, nunca por id", () => {
  const src = leer("app/cot/[token]/page.tsx");
  assert.match(src, /\.eq\("share_token",\s*token\)/, "dejó de filtrar por share_token");
  assert.doesNotMatch(src, /\.eq\("id",/, "empezó a filtrar/aceptar acceso por id — reabriría la enumeración");
});

test("portal B2B: la lista de cotizaciones sigue por creado_por (vínculo estable), con tenant como segunda capa", () => {
  const src = leer("app/portal/b2b/page.tsx");
  assert.match(src, /\.eq\("creado_por",\s*user\.email/, "dejó de filtrar por el email exacto del usuario autenticado");
  assert.doesNotMatch(
    src,
    /cotizaciones[\s\S]{0,400}\.eq\(\s*"asesor"/,
    "la consulta de cotizaciones del portal B2B empezó a emparejar por nombre — vínculo débil, ya prohibido para este flujo"
  );
});
