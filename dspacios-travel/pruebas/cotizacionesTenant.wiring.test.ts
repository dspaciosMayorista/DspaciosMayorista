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

test("reservar/actions.ts: crearCotizacion usa contextoCotizacion() (falla cerrado sin sesión), nunca getTenant() a secas", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  // Defecto corregido (revisión de PR #267, punto 7): `getTenant()` a secas
  // cae en silencio a "mayorista" sin sesión — una acción interna/autenticada
  // NUNCA debe depender solo de eso. El archivo no debe importar `getTenant`
  // en absoluto: toda resolución de tenant pasa por `contextoCotizacion()`.
  assert.doesNotMatch(src, /import\s*\{\s*getTenant\s*\}\s*from\s*"@\/lib\/tenant\.server"/, "reservar/actions.ts volvió a importar getTenant() a secas");
  const start = src.indexOf("export async function crearCotizacion(");
  const end = src.indexOf("export async function convertirCotizacion(");
  assert.ok(start !== -1 && end !== -1 && end > start, "no se pudo delimitar el cuerpo de crearCotizacion");
  const fn = src.slice(start, end);
  assert.match(fn, /tenant:\s*tenantCotizacion/, "crearCotizacion no estampa `tenant: tenantCotizacion`");
  assert.match(fn, /const\s+ctx\s*=\s*await\s+contextoCotizacion\(\)/, "crearCotizacion no llama a contextoCotizacion()");
  assert.match(fn, /if\s*\(!ctx\.ok\)\s*return\s*\{\s*ok:\s*false/, "crearCotizacion no falla cerrado cuando el contexto no está autorizado");
  assert.match(fn, /tenantCotizacion\s*=\s*ctx\.tenant/, "crearCotizacion no resuelve tenantCotizacion desde el contexto validado");
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
  // convertirCotizacion pasa el tenant a la función INTERNA (no exportada),
  // nunca por un `opts` serializable — ver el test de la firma más abajo.
  const c1 = src.slice(src.indexOf("export async function convertirCotizacion("), src.indexOf("export async function convertirCotizacionCarrito"));
  assert.match(c1, /reservarDesdeTarifarioInterno\([^)]*,\s*cot\.tenant as Tenant\s*\)/, "convertirCotizacion no propaga el tenant a reservarDesdeTarifarioInterno");
  // convertirCotizacionCarrito estampa el mismo tenant en su propio insert de `ventas`.
  const c2 = src.slice(src.indexOf("export async function convertirCotizacionCarrito"));
  assert.match(c2, /tenant:\s*tenantCotizacion/, "convertirCotizacionCarrito no estampa tenant en el insert de ventas");
});

test("reservar/actions.ts: reservarDesdeTarifario* NUNCA vuelve a ser una Server Action exportada con tenant elegible por el cliente", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  // Defecto corregido (revisión de PR #267, punto 3): una Server Action
  // exportada es alcanzable por red con CUALQUIER argumento serializable —
  // un `opts?: { tenant?: Tenant }` en la firma pública permitía que el
  // cliente intentara elegir su propio tenant. Guarda de no-regresión: el
  // patrón viejo no debe reaparecer en ningún lado del archivo.
  assert.doesNotMatch(src, /export\s+async\s+function\s+reservarDesdeTarifario\s*\(/, "reservarDesdeTarifario volvió a exportarse — el tenant sería elegible por el cliente");
  assert.doesNotMatch(src, /opts\?:\s*\{\s*tenant\?:\s*Tenant\s*\}/, "reapareció `opts?: { tenant?: Tenant }` — patrón vulnerable (tenant elegible por el cliente)");
  assert.doesNotMatch(src, /opts\?\.tenant/, "reapareció una lectura de `opts?.tenant` — patrón vulnerable");
  // La función real es interna (no exportada) y exige el tenant como
  // parámetro POSICIONAL obligatorio — nunca opcional ni dentro de un objeto
  // que un caller pueda omitir u override parcialmente.
  const start = src.indexOf("async function reservarDesdeTarifarioInterno");
  const end = src.indexOf("export async function crearCotizacion(");
  assert.ok(start !== -1 && end !== -1 && end > start, "no se pudo delimitar el cuerpo de reservarDesdeTarifarioInterno");
  assert.doesNotMatch(src.slice(0, start), /export\s+async\s+function\s+reservarDesdeTarifarioInterno/, "reservarDesdeTarifarioInterno está exportada — debe ser interna");
  assert.match(src.slice(start, start + 200), /reservarDesdeTarifarioInterno\(input:\s*ReservaInput,\s*tenant:\s*Tenant\)/, "reservarDesdeTarifarioInterno no exige `tenant: Tenant` como parámetro obligatorio");
  const fn = src.slice(start, end);
  assert.match(fn, /tenant,\s*\n\s*cliente:/, "el insert de ventas dentro de reservarDesdeTarifarioInterno no estampa el tenant recibido");
});

test("reservar/actions.ts: las filas derivadas (aliados_b2b, CxP, asientos) heredan el tenant validado, no uno independiente", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const start = src.indexOf("async function reservarDesdeTarifarioInterno");
  const end = src.indexOf("export async function crearCotizacion(");
  const fn = src.slice(start, end);
  assert.match(fn, /aliados_b2b"\)\.insert\(\{\s*\n\s*numero_contrato:\s*numero,\s*\n\s*tenant,/, "el insert de aliados_b2b en reservarDesdeTarifarioInterno no estampa tenant");
  assert.match(fn, /type CxPRow\s*=\s*\{\s*\n\s*numero_contrato:\s*string;\s*tenant:\s*Tenant;/, "el tipo CxPRow perdió el campo tenant");
  assert.match(fn, /postearAsientoCxP\(\{[\s\S]{0,300}fecha:\s*hoyISO,\s*tenant,/, "el asiento automático de CxP en reservarDesdeTarifarioInterno no recibe el tenant explícito");

  const carrito = src.slice(src.indexOf("export async function convertirCotizacionCarrito"));
  assert.match(carrito, /tenant:\s*tenantCotizacion,\s*proveedor:/, "convertirCotizacionCarrito no estampa tenant en las filas de cuentas_por_pagar");
  assert.match(carrito, /postearAsientoCxP\(\{[\s\S]{0,300}tenant:\s*tenantCotizacion/, "convertirCotizacionCarrito no pasa el tenant explícito al asiento automático");
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

test("manual-actions.ts: crearCotizacionManual falla cerrado con contextoCotizacion(), y las conversiones/ediciones exigen acceso al tenant", () => {
  const src = leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
  // Defecto corregido (revisión de PR #267, punto 7): mismo criterio que
  // crearCotizacion — `getTenant()` a secas no debe volver a importarse aquí.
  assert.doesNotMatch(src, /import\s*\{\s*getTenant\s*\}\s*from\s*"@\/lib\/tenant\.server"/, "manual-actions.ts volvió a importar getTenant() a secas");
  assert.match(src, /import\s*\{\s*contextoCotizacion,\s*autorizaTenant\s*\}\s*from\s*"@\/lib\/cotizacion\/acceso"/, "no importa el helper de acceso");

  const crear = src.slice(src.indexOf("export async function crearCotizacionManual"), src.indexOf("export async function actualizarTitularCotizacionManual"));
  assert.match(crear, /tenant:\s*tenantCotizacion/, "crearCotizacionManual no estampa tenant");
  assert.match(crear, /const\s+ctx\s*=\s*await\s+contextoCotizacion\(\)/, "crearCotizacionManual no llama a contextoCotizacion()");
  assert.match(crear, /if\s*\(!ctx\.ok\)\s*return\s*\{\s*ok:\s*false/, "crearCotizacionManual no falla cerrado cuando el contexto no está autorizado");
  assert.match(crear, /tenantCotizacion\s*=\s*ctx\.tenant/, "crearCotizacionManual no resuelve el tenant desde el contexto validado");

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

test("manual-actions.ts: aliados_b2b y las CxP de convertirCotizacionManualAContrato heredan el tenant validado", () => {
  const src = leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
  const convertir = src.slice(src.indexOf("export async function convertirCotizacionManualAContrato"));
  assert.match(convertir, /aliados_b2b"\)\.insert\(\{\s*\n\s*numero_contrato:\s*numero,\s*\n\s*tenant:\s*tenantCotizacion,/, "el insert de aliados_b2b no estampa tenant");
  assert.match(convertir, /numero_contrato:\s*numero,\s*\n\s*tenant:\s*tenantCotizacion,\s*\n\s*proveedor,/, "las filas de cuentas_por_pagar (CxP) no estampan tenant");
  assert.match(convertir, /postearAsientoCxP\(\{[\s\S]{0,300}tenant:\s*tenantCotizacion/, "el asiento automático de CxP no recibe el tenant explícito");
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
