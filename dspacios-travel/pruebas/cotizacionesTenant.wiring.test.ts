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

// Extrae el cuerpo de una función TS top-level (declarada como
// `export (async )?function NOMBRE(` ... balanceando llaves) para no
// depender de una ventana de caracteres fija — un candado agregado más
// adelante en la función (ej. el pre-chequeo A3 de pagos previos activos,
// migración 164) desplaza todo lo que viene después, y una ventana fija
// puede dejar afuera código que sigue intacto. Mismo patrón ya usado en
// pruebas/numeracionOrdenWiring.test.ts y pruebas/contratoContexto.test.ts —
// duplicado aquí a propósito (cada archivo de wiring es independiente).
function cuerpoDeFuncion(src: string, nombre: string): string {
  const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${nombre}\\s*\\(`);
  const m = re.exec(src);
  assert.ok(m, `no se encontró la función ${nombre}`);

  // 1) Cierra la lista de parámetros balanceando paréntesis.
  let i = src.indexOf("(", m!.index);
  let profParen = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") profParen++;
    else if (src[i] === ")") {
      profParen--;
      if (profParen === 0) { i++; break; }
    }
  }
  assert.ok(profParen === 0, `no se pudo balancear los paréntesis de ${nombre}`);

  // 2) El tipo de retorno puede traer sus propias llaves dentro de `<...>`;
  //    se ignoran mientras la profundidad de `<>` sea > 0. La `{` real del
  //    cuerpo es la primera que aparece con profundidad de `<>` en 0.
  let profAngulo = 0;
  for (; i < src.length; i++) {
    if (src[i] === "<") profAngulo++;
    else if (src[i] === ">") profAngulo--;
    else if (src[i] === "{" && profAngulo === 0) break;
  }
  assert.ok(src[i] === "{", `no se encontró la '{' del cuerpo de ${nombre}`);

  // 3) Balancea llaves desde ahí para obtener el cuerpo completo.
  let depth = 0;
  const inicio = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(inicio, i + 1);
    }
  }
  throw new Error(`no se pudo balancear las llaves de ${nombre}`);
}

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
    // Extracción robusta (balanceo de llaves), no una ventana de caracteres
    // fija: el candado A3 de descartarCotizacion (pagos previos activos,
    // migración 164) agregó ~180 caracteres ANTES del filtro de tenant, y
    // una ventana fija de 1200 dejaba ese filtro afuera aunque el código
    // siguiera intacto (falso negativo).
    const fn = cuerpoDeFuncion(src, fnName);
    assert.match(fn, /contextoCotizacion\(\)/, `${fnName} no usa contextoCotizacion()`);
    // superadmin omite el filtro; el resto de roles lo aplica.
    assert.match(fn, /if\s*\(!ctx\.superadmin\)\s*q\s*=\s*q\.eq\("tenant",\s*ctx\.tenant\)/, `${fnName} no filtra por tenant salvo superadmin`);
  }

  // El candado de pagos previos activos/aplicados (A3, migración 164) vive
  // DENTRO de descartarCotizacion, antes del filtro de tenant. Verifica que
  // uno no reemplazó al otro: ambos deben coexistir, con el candado primero
  // y el filtro de tenant después, en el mismo cuerpo de función.
  const fnDescartar = cuerpoDeFuncion(src, "descartarCotizacion");
  const idxCandado = fnDescartar.indexOf("cotizacion_pagos_previos");
  assert.ok(idxCandado > -1, "descartarCotizacion perdió el candado de pagos previos activos (A3)");
  const idxTenant = fnDescartar.search(/if\s*\(!ctx\.superadmin\)\s*q\s*=\s*q\.eq\("tenant",\s*ctx\.tenant\)/);
  assert.ok(idxTenant > -1, "descartarCotizacion perdió el filtro de tenant");
  assert.ok(
    idxTenant > idxCandado,
    "el candado de pagos activos (A3) no debe eliminar el filtro de tenant: debe seguir apareciendo DESPUÉS del candado en la misma función"
  );
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

  // convertirCotizacionManualAContrato: desde el Commit 5, la conversión es
  // ATÓMICA dentro del RPC `convertir_cotizacion_a_contrato` (migración 164) —
  // esta Server Action YA NO valida tenant en TS ni construye la venta: solo
  // autentica al actor y delega. La cobertura de "rechaza cotización sin
  // tenant" / "valida acceso al tenant" / "propaga el tenant a ventas" migró
  // con la lógica al RPC de SQL — ver el test siguiente, que audita el
  // CUERPO DE ESA FUNCIÓN SQL en la migración real.
  const convertir = cuerpoDeFuncion(src, "convertirCotizacionManualAContrato");
  assert.match(convertir, /const\s+sesion\s*=\s*await\s+sesionConversionAutorizada\(\)/, "convertirCotizacionManualAContrato no autentica con sesionConversionAutorizada()");
  assert.match(convertir, /if\s*\(!sesion\)\s*\{/, "convertirCotizacionManualAContrato no falla cerrado sin sesión autorizada");
  assert.match(
    convertir,
    /admin\.rpc\(\s*"convertir_cotizacion_a_contrato",\s*\{\s*\n\s*p_cotizacion_id:\s*cotizacionId,\s*\n\s*p_usuario_id:\s*sesion\.userId,/,
    "convertirCotizacionManualAContrato no delega en el RPC atómico con el usuario de la sesión validada"
  );
  // Guarda de no-regresión: si el builder TS viejo reapareciera (insertar
  // directamente en ventas/aliados_b2b/cuentas_por_pagar desde esta Server
  // Action), la conversión dejaría de ser atómica — esa lógica debe vivir
  // ÚNICAMENTE dentro del RPC de SQL.
  assert.doesNotMatch(convertir, /\.from\(\s*"ventas"\s*\)\s*\.insert/, "convertirCotizacionManualAContrato volvió a insertar en ventas desde TS — la conversión debe ser atómica en el RPC, no repartida");
  assert.doesNotMatch(convertir, /\.from\(\s*"aliados_b2b"\s*\)\s*\.insert/, "convertirCotizacionManualAContrato volvió a insertar en aliados_b2b desde TS");
  assert.doesNotMatch(convertir, /\.from\(\s*"cuentas_por_pagar"\s*\)\s*\.insert/, "convertirCotizacionManualAContrato volvió a insertar en cuentas_por_pagar desde TS");
});

// Extrae el cuerpo de una función SQL `language plpgsql` definida como
// `create or replace function public.NOMBRE(...) ... as $$ ... $$;` — el
// delimitador de dólar ($$) es el que usa PostgreSQL mismo para marcar el
// cuerpo de la función, así que es un límite estructural estable (no un
// número de caracteres arbitrario). Ancla en la sentencia DDL completa
// (`create or replace function public.<nombre>(`) para no confundirse con
// una simple mención del nombre en un comentario u otra función.
//
// Asume que la función no contiene un segundo par de `$$` anidado (SQL
// dinámico con `execute format($$...$$)`, etc.) — cierto para las funciones
// de este archivo (`convertir_cotizacion_a_contrato` no usa SQL dinámico);
// si eso cambiara, este extractor necesitaría revisarse.
function cuerpoDeFuncionSql(src: string, nombre: string): string {
  const marcaDDL = `create or replace function public.${nombre}(`;
  const inicioDDL = src.indexOf(marcaDDL);
  assert.ok(inicioDDL > -1, `no se encontró "${marcaDDL}" en la migración`);
  const abre = src.indexOf("$$", inicioDDL);
  assert.ok(abre > -1, `no se encontró el delimitador $$ de apertura de ${nombre}`);
  const cierra = src.indexOf("$$", abre + 2);
  assert.ok(cierra > -1, `no se encontró el delimitador $$ de cierre de ${nombre}`);
  return src.slice(abre, cierra + 2);
}

// Todas las posiciones (una por marcador) deben aparecer, en ese orden,
// antes del marcador final indicado. Mismo criterio que
// `assertOrdenAntesDeGenerar` de pruebas/numeracionOrdenWiring.test.ts,
// aplicado aquí al cuerpo SQL en vez de a un archivo TS.
function assertOrdenSqlAntesDe(cuerpo: string, marcadores: string[], antesDe: string, etiqueta: string) {
  const idxFinal = cuerpo.indexOf(antesDe);
  assert.ok(idxFinal > -1, `${etiqueta}: no se encontró el marcador final "${antesDe}"`);
  let ultimo = -1;
  for (const marcador of marcadores) {
    const idx = cuerpo.indexOf(marcador);
    assert.ok(idx > -1, `${etiqueta}: no se encontró el marcador "${marcador}"`);
    assert.ok(idx > ultimo, `${etiqueta}: el marcador "${marcador}" está fuera de orden`);
    assert.ok(idx < idxFinal, `${etiqueta}: el marcador "${marcador}" aparece DESPUÉS de "${antesDe}"`);
    ultimo = idx;
  }
}

test("migración 164: el RPC convertir_cotizacion_a_contrato valida actor y tenant ANTES de devolver una venta existente (idempotencia)", () => {
  const migracion = leer("supabase/migrations/20260601000164_condiciones_pago_componente.sql");
  const rpc = cuerpoDeFuncionSql(migracion, "convertir_cotizacion_a_contrato");

  // Autorización del actor (rol interno + activo) y tenant AUTORITATIVO,
  // ambos ANTES de la rama de idempotencia que devolvería una venta ya
  // convertida — así un replay desde un tenant ajeno se rechaza antes de
  // poder "asomarse" al número de contrato existente.
  assertOrdenSqlAntesDe(
    rpc,
    [
      "v_rol := public._autorizado_pago_previo(p_usuario_id);",
      "if v_rol <> 'superadmin' and v_actor_tenant is distinct from v_tenant then",
    ],
    "return v_existente;",
    "convertir_cotizacion_a_contrato"
  );

  // Tras la idempotencia (y tras el chequeo de tenant, ya probado arriba),
  // el resto de validaciones —tipo, estado, congelado, mínimo— también
  // ocurren ANTES de consumir el consecutivo.
  assertOrdenSqlAntesDe(
    rpc,
    [
      "return v_existente;",
      "perform public._tipo_cotizacion_convertible(v_tipo);",
      "if v_estado <> 'abierta' then",
      "no está congelada",
      "no alcanza el mínimo exigido",
    ],
    "v_numero := public.siguiente_numero_contrato_para_tenant(v_tenant);",
    "convertir_cotizacion_a_contrato"
  );

  // La numeración usa la MISMA función real por tenant (nextval, sin
  // reaplicar prefijo DTM/MIN a mano) — exactamente una vez en todo el RPC.
  const llamadasNumeracion = [...rpc.matchAll(/siguiente_numero_contrato_para_tenant\(/g)];
  assert.equal(llamadasNumeracion.length, 1, "convertir_cotizacion_a_contrato debe llamar a siguiente_numero_contrato_para_tenant EXACTAMENTE una vez");
  assert.doesNotMatch(rpc, /'DTM-'\s*\|\|/, "convertir_cotizacion_a_contrato no debe re-anteponer 'DTM-' al número — eso ya lo hace la función de numeración");
  assert.doesNotMatch(rpc, /'MIN-'\s*\|\|/, "convertir_cotizacion_a_contrato no debe re-anteponer 'MIN-' al número — eso ya lo hace la función de numeración");
});

test("migración 164: aliados_b2b y cuentas_por_pagar heredan v_tenant (el validado bajo lock), no un valor independiente", () => {
  const migracion = leer("supabase/migrations/20260601000164_condiciones_pago_componente.sql");
  const rpc = cuerpoDeFuncionSql(migracion, "convertir_cotizacion_a_contrato");

  assert.match(
    rpc,
    /insert into public\.aliados_b2b\s*\n\s*\(numero_contrato,\s*tenant,/,
    "el insert de aliados_b2b dejó de declarar la columna tenant"
  );
  assert.match(
    rpc,
    /\(v_numero,\s*v_tenant,\s*v_aliado_nombre,/,
    "el insert de aliados_b2b no estampa v_tenant (el tenant validado bajo lock)"
  );

  assert.match(
    rpc,
    /insert into public\.cuentas_por_pagar\s*\n\s*\(numero_contrato,\s*tenant,/,
    "el insert de cuentas_por_pagar (CxP) dejó de declarar la columna tenant"
  );
  assert.match(
    rpc,
    /\(v_numero,\s*v_tenant,\s*v_proveedor,/,
    "el insert de cuentas_por_pagar no estampa v_tenant (el tenant validado bajo lock)"
  );
});

test("migración 154: cotizaciones.tenant sigue siendo NOT NULL — el candado de esquema que hace redundante el chequeo TS eliminado", () => {
  // `convertirCotizacionManualAContrato` (TS) ya no rechaza "una cotización
  // sin tenant" a mano: el Commit 5 delegó esa validación al RPC de SQL, que
  // a su vez puede confiar en que `cotizaciones.tenant` NUNCA es NULL porque
  // el esquema mismo lo impide desde la migración 154. Si esta migración
  // alguna vez se revirtiera o esa columna volviera a admitir NULL, este
  // test debe fallar para que alguien reintroduzca el chequeo explícito.
  const migracion154 = leer("supabase/migrations/20260601000154_cotizaciones_tenant_cierre.sql");
  assert.match(
    migracion154,
    /alter table public\.cotizaciones alter column tenant set not null;/,
    "la migración 154 dejó de forzar cotizaciones.tenant NOT NULL"
  );
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
