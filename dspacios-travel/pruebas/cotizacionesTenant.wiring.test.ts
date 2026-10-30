import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
  // #38 (migración 205): la comisión ya no se inserta desde TypeScript; la
  // crea `registrar_comision_b2b_reserva` copiando el tenant de la VENTA que
  // esta función acaba de insertar con el tenant validado — mismo criterio
  // que las CxP de abajo (no queda un tenant independiente que pueda divergir).
  assert.match(fn, /from\("ventas"\)\.insert\(\{\s*\n\s*numero_contrato:\s*numero,[\s\S]{0,300}\n\s*tenant,/, "la venta de reservarDesdeTarifarioInterno no estampa el tenant validado");
  assert.match(fn, /registrarComisionReserva\(sb, numero, aliadoB2B\)/, "la comisión B2B no cuelga de la venta recién creada");
  assert.match(
    leer("supabase/migrations/20260601000205_comisiones_b2b_integridad.sql"),
    /\) values \(\s*\n\s*v\.numero_contrato, v\.tenant,/,
    "registrar_comision_b2b_reserva no hereda el tenant de la venta"
  );
  // Las filas de CxP ya no llevan `tenant` en TypeScript: desde la migración
  // 171 lo estampa la propia transacción financiera a partir del parámetro
  // `p_tenant`, que es el tenant YA validado que recibe esta función. Es una
  // garantía más fuerte que la anterior (una fila del payload no puede
  // apuntar a otra agencia ni por error de construcción), así que la prueba
  // verifica el parámetro, no el campo de la fila.
  assert.match(fn, /registrarFinancieroContrato\([\s\S]{0,300}numeroContrato: numero, tenant,/, "la escritura financiera de reservarDesdeTarifarioInterno no recibe el tenant validado");
  assert.match(fn, /depsFinanciero\(numero, tenant, hoyISO\)/, "el asiento automático de CxP no recibe el tenant explícito");

  const carrito = src.slice(src.indexOf("export async function convertirCotizacionCarrito"));
  assert.match(carrito, /registrarFinancieroContrato\([\s\S]{0,300}tenant: tenantCotizacion/, "convertirCotizacionCarrito no pasa el tenant de la cotización a la escritura financiera");
  assert.match(carrito, /depsFinanciero\(numero, tenantCotizacion, hoyServidor\)/, "convertirCotizacionCarrito no pasa el tenant explícito al asiento automático");
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

  // #39 (migración 216): la cabecera y los servicios se crean en UNA transacción
  // por la RPC definer `crear_cotizacion_manual`. El tenant validado viaja como
  // `p_tenant` y el autor es el id de la sesión; nada se inserta directo desde
  // TS. Lo que la RPC hace con esos argumentos lo audita el test de la 216 más
  // abajo.
  const crear = cuerpoDeFuncion(src, "crearCotizacionManual");
  assert.match(crear, /const\s+ctx\s*=\s*await\s+contextoCotizacion\(\)/, "crearCotizacionManual no llama a contextoCotizacion()");
  assert.match(crear, /if\s*\(!ctx\.ok\)\s*return\s*\{\s*ok:\s*false/, "crearCotizacionManual no falla cerrado cuando el contexto no está autorizado");
  assert.match(crear, /tenantCotizacion\s*=\s*ctx\.tenant/, "crearCotizacionManual no resuelve el tenant desde el contexto validado");
  assert.match(crear, /const\s+usuario\s*=\s*await\s+usuarioSesion\(\)/, "crearCotizacionManual no toma el autor de la sesión");
  assert.match(crear, /if\s*\(!usuario\)\s*return\s*\{\s*ok:\s*false/, "crearCotizacionManual no falla cerrado sin usuario de sesión");
  assert.match(
    crear,
    /admin\.rpc\(\s*"crear_cotizacion_manual",\s*\{\s*\n\s*p_usuario_id:\s*usuario\.id,\s*\n\s*p_tenant:\s*tenantCotizacion,/,
    "crearCotizacionManual no delega en la RPC con el usuario de la sesión y el tenant validado"
  );
  const idxRpcCrear = crear.indexOf('admin.rpc("crear_cotizacion_manual"');
  assert.ok(crear.search(/contextoCotizacion\(\)/) < idxRpcCrear && crear.search(/usuarioSesion\(\)/) < idxRpcCrear,
    "crearCotizacionManual llama a la RPC antes de validar contexto y sesión");
  assert.doesNotMatch(crear, /\.from\(\s*"(cotizaciones|cotizacion_servicios)"\s*\)\s*\.(insert|upsert)/, "crearCotizacionManual volvió a insertar directo desde TS — se saltaría la RPC que estampa el autor");

  // Cada edición valida el acceso al tenant ANTES de su primera escritura
  // (update directo o RPC). Cuerpo completo (balanceo de llaves), no una ventana fija.
  for (const fnName of ["actualizarTitularCotizacionManual", "actualizarIncluyeCotizacionManual", "actualizarRecobroNinosCotizacionManual", "editarServiciosCotizacionManual"]) {
    const fn = cuerpoDeFuncion(src, fnName);
    const idxAcceso = fn.search(/autorizaTenant\(ctx,\s*cot\.tenant\)/);
    assert.ok(idxAcceso > -1, `${fnName} no valida el acceso al tenant antes de editar`);
    const idxEscritura = fn.search(/\.(update|insert|upsert|delete)\(|\.rpc\(/);
    assert.ok(idxEscritura > -1, `${fnName}: no se encontró su escritura`);
    assert.ok(idxAcceso < idxEscritura, `${fnName} escribe antes de validar el acceso al tenant`);
  }

  // convertirCotizacionManualAContrato: desde el Commit 5, la conversión es
  // ATÓMICA dentro del RPC `convertir_cotizacion_a_contrato` (164, vigente en la
  // 198) — esta Server Action YA NO valida tenant en TS ni construye la venta:
  // solo autentica al actor y delega. Desde #39 (migración 216) delega en el
  // wrapper `convertir_cotizacion_manual_controlada`, la ÚNICA puerta para una
  // manual: emite la autorización de la frontera y llama a la 198 con el MISMO
  // actor. La cobertura de "rechaza cotización sin tenant" / "valida acceso al
  // tenant" / "propaga el tenant a ventas" vive en el RPC de SQL — ver los tests
  // siguientes, que auditan el cuerpo del wrapper y el de la 198.
  const convertir = cuerpoDeFuncion(src, "convertirCotizacionManualAContrato");
  assert.match(convertir, /const\s+sesion\s*=\s*await\s+sesionConversionAutorizada\(\)/, "convertirCotizacionManualAContrato no autentica con sesionConversionAutorizada()");
  assert.match(convertir, /if\s*\(!sesion\)\s*\{/, "convertirCotizacionManualAContrato no falla cerrado sin sesión autorizada");
  assert.match(
    convertir,
    /admin\.rpc\(\s*"convertir_cotizacion_manual_controlada",\s*\{\s*\n\s*p_cotizacion_id:\s*cotizacionId,\s*\n\s*p_usuario_id:\s*sesion\.userId,\s*\n\s*\}\)/,
    "convertirCotizacionManualAContrato no delega en el wrapper controlado con el usuario de la sesión validada (y solo esos dos argumentos)"
  );
  assert.ok(
    convertir.search(/sesionConversionAutorizada\(\)/) < convertir.indexOf('admin.rpc("convertir_cotizacion_manual_controlada"'),
    "convertirCotizacionManualAContrato llama al RPC antes de autenticar al actor"
  );
  // La puerta vieja no se llama directo desde ningún lugar del archivo: se
  // saltaría la autorización de conversión que exige la frontera de la 217.
  assert.doesNotMatch(src, /\.rpc\(\s*["'`]convertir_cotizacion_a_contrato["'`]/, "manual-actions.ts volvió a llamar directo a convertir_cotizacion_a_contrato — debe pasar por convertir_cotizacion_manual_controlada");
  // Guarda de no-regresión: si el builder TS viejo reapareciera (insertar
  // directamente en ventas/aliados_b2b/cuentas_por_pagar desde esta Server
  // Action), la conversión dejaría de ser atómica — esa lógica debe vivir
  // ÚNICAMENTE dentro del RPC de SQL.
  assert.doesNotMatch(convertir, /\.from\(\s*"ventas"\s*\)\s*\.insert/, "convertirCotizacionManualAContrato volvió a insertar en ventas desde TS — la conversión debe ser atómica en el RPC, no repartida");
  assert.doesNotMatch(convertir, /\.from\(\s*"aliados_b2b"\s*\)\s*\.insert/, "convertirCotizacionManualAContrato volvió a insertar en aliados_b2b desde TS");
  assert.doesNotMatch(convertir, /\.from\(\s*"cuentas_por_pagar"\s*\)\s*\.insert/, "convertirCotizacionManualAContrato volvió a insertar en cuentas_por_pagar desde TS");
  assert.doesNotMatch(convertir, /\.(insert|update|upsert|delete)\(/, "convertirCotizacionManualAContrato escribe directo desde TS — toda la conversión debe vivir en el RPC");
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
// si eso cambiara, este extractor necesitaría revisarse. `esquema` permite
// auditar también funciones privadas (p. ej. `p39_priv`, migración 216).
function cuerpoDeFuncionSql(src: string, nombre: string, esquema = "public"): string {
  const marcaDDL = `create or replace function ${esquema}.${nombre}(`;
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

// `convertir_cotizacion_a_contrato` nace en la 164 y la 198 la redefine: la
// 198 es la versión VIGENTE, y en ella delega el wrapper de #39 (216). Las dos
// se auditan con las mismas reglas; la guarda de abajo exige que ninguna
// migración posterior la vuelva a definir sin sumarse a esta lista.
const MIGRACIONES_CONVERSION = [
  ["164", "supabase/migrations/20260601000164_condiciones_pago_componente.sql"],
  ["198", "supabase/migrations/20260601000198_fecha_negocio_bogota.sql"],
] as const;

test("convertir_cotizacion_a_contrato: la última migración que la define es la 198 (la que auditan los tests siguientes)", () => {
  const dir = join(raiz, "supabase/migrations");
  const definen = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => readFileSync(join(dir, f), "utf8").includes("create or replace function public.convertir_cotizacion_a_contrato("));
  assert.deepEqual(
    definen,
    MIGRACIONES_CONVERSION.map(([, archivo]) => archivo.split("/").pop()),
    "otra migración redefine convertir_cotizacion_a_contrato — súmala a MIGRACIONES_CONVERSION para auditar la versión vigente"
  );
});

for (const [num, archivo] of MIGRACIONES_CONVERSION) {
test(`migración ${num}: el RPC convertir_cotizacion_a_contrato valida actor y tenant ANTES de devolver una venta existente (idempotencia)`, () => {
  const migracion = leer(archivo);
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

test(`migración ${num}: aliados_b2b y cuentas_por_pagar heredan v_tenant (el validado bajo lock), no un valor independiente`, () => {
  const migracion = leer(archivo);
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
}

// ── #39 (migración 216): la puerta controlada y las RPC de creación/edición ──
const MIGRACION_216 = "supabase/migrations/20260601000216_cotizacion_manual_edicion_frontera.sql";
const MIGRACION_217 = "supabase/migrations/20260601000217_cotizacion_manual_cierre_frontera.sql";
const sinComentariosSql = (s: string) => s.replace(/--[^\n]*/g, "");

// Encabezado DDL de una función (desde `create or replace` hasta el `$$` de apertura):
// ahí se declaran SECURITY DEFINER/INVOKER y el search_path.
function encabezadoFuncionSql(src: string, nombre: string, esquema = "public"): string {
  const inicio = src.indexOf(`create or replace function ${esquema}.${nombre}(`);
  assert.ok(inicio > -1, `no se encontró la función ${esquema}.${nombre}`);
  return src.slice(inicio, src.indexOf("$$", inicio));
}

// Solo service_role ejecuta la función: la 216 se la quita a todos y se la
// devuelve únicamente a service_role, y ni la 216 ni la 217 la conceden a
// anon/authenticated/public.
function assertSoloServiceRole(firma: string) {
  const m216 = leer(MIGRACION_216);
  const ambas = m216 + leer(MIGRACION_217);
  const f = firma.replace(/[.()]/g, (c) => `\\${c}`);
  assert.match(m216, new RegExp(`revoke all on function public\\.${f} from public, anon, authenticated, service_role;`), `${firma}: falta el revoke a todos`);
  assert.match(m216, new RegExp(`grant execute on function public\\.${f} to service_role;`), `${firma}: falta el grant a service_role`);
  const nombre = firma.slice(0, firma.indexOf("("));
  assert.doesNotMatch(ambas, new RegExp(`grant[^;]*on function public\\.${nombre}\\([^)]*\\)[^;]*to[^;]*\\b(anon|authenticated|public)\\b`), `${firma} se concede a un rol de la API`);
}

test("migración 216: convertir_cotizacion_manual_controlada delega en la 198 con el MISMO actor y abre la autorización solo para una conversión nueva", () => {
  const m216 = leer(MIGRACION_216);
  const w = sinComentariosSql(cuerpoDeFuncionSql(m216, "convertir_cotizacion_manual_controlada"));

  // INVOKER: no gana privilegios propios; la autorización de actor y tenant la
  // hace la 198 (auditada arriba), con los mismos argumentos que recibe.
  assert.match(encabezadoFuncionSql(m216, "convertir_cotizacion_manual_controlada"), /security invoker/, "el wrapper dejó de ser SECURITY INVOKER");
  const llamadas = [...w.matchAll(/public\.convertir_cotizacion_a_contrato\(([^)]*)\)/g)].map((x) => x[1].replace(/\s+/g, " ").trim());
  assert.deepEqual(llamadas, ["p_cotizacion_id, p_usuario_id", "p_cotizacion_id, p_usuario_id"],
    "el wrapper llama a la 198 con otro actor u otra cotización");

  // Orden: bloqueo → madre comparativa → solo manuales → réplica → emitir → 198 → cerrar.
  assertOrdenSqlAntesDe(
    w,
    [
      "for update;",
      "COMPARATIVA_NO_COBRABLE",
      "if v_tipo is distinct from 'manual' then",
      "if exists (select 1 from public.ventas v where v.cotizacion_id = p_cotizacion_id) then",
      "return public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);",
      "v_aut := p39_priv.emitir(p_cotizacion_id, 'conversion', p_usuario_id);",
      "v_res := public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);",
    ],
    "perform p39_priv.cerrar(v_aut);",
    "convertir_cotizacion_manual_controlada"
  );
  // Una réplica (ya convertida) no abre autorización de conversión: la 198
  // devuelve el número existente tras validar actor y tenant.
  assert.equal([...w.matchAll(/p39_priv\.emitir\(/g)].length, 1, "el wrapper emite más de una autorización");

  // No escribe por su cuenta, ni ninguna migración de #39 redefine la 198.
  assert.doesNotMatch(w, /\b(insert into|update|delete from)\s+public\./, "el wrapper escribe directo: la conversión debe seguir dentro de la 198");
  for (const archivo of [MIGRACION_216, MIGRACION_217]) {
    assert.doesNotMatch(leer(archivo), /create or replace function public\.convertir_cotizacion_a_contrato\(/, `${archivo} redefine la 198`);
  }
  assertSoloServiceRole("convertir_cotizacion_manual_controlada(bigint, uuid)");
});

test("migración 216: crear y editar manuales validan actor y tenant (bajo lock al editar) ANTES de escribir", () => {
  const m216 = leer(MIGRACION_216);

  // Crear: el tenant lo decide el usuario de la BD; solo superadmin elige agencia.
  const crear = sinComentariosSql(cuerpoDeFuncionSql(m216, "crear_cotizacion_manual"));
  assertOrdenSqlAntesDe(
    crear,
    [
      "select * into u from public.usuarios where id = p_usuario_id;",
      "u.activo is not true",
      "v_tenant := case when u.rol = 'superadmin' then coalesce(nullif(btrim(coalesce(p_tenant, '')), ''), u.tenant) else u.tenant end;",
      "if v_tenant is null or v_tenant not in ('mayorista', 'minorista') then",
    ],
    "insert into public.cotizaciones",
    "crear_cotizacion_manual"
  );
  assert.match(crear, /\) values \(\s*\n\s*v_tenant, 'manual', 'abierta',/, "la fila no guarda el tenant resuelto por la RPC");
  assert.match(crear, /u\.email, u\.id\s*\n\s*\) returning id into v_id;/, "la fila no guarda el autor estable (creado_por_id = usuario de la BD)");

  // Editar: el candado común valida actor, bloquea la fila y compara su tenant.
  const bloquear = cuerpoDeFuncionSql(m216, "bloquear_para_editar", "p39_priv");
  assertOrdenSqlAntesDe(
    bloquear,
    [
      "u.activo is not true",
      "select * into c from public.cotizaciones where id = p_cotizacion_id for update;",
      "(u.rol <> 'superadmin' and u.tenant is distinct from c.tenant)",
    ],
    "return c;",
    "p39_priv.bloquear_para_editar"
  );
  for (const nombre of ["editar_servicios_cotizacion_manual", "actualizar_recobro_ninos_manual"]) {
    const cuerpo = sinComentariosSql(cuerpoDeFuncionSql(m216, nombre));
    const idxCandado = cuerpo.indexOf("c := p39_priv.bloquear_para_editar(p_cotizacion_id, p_usuario_id, p_rev_esperada, p_motivo);");
    assert.ok(idxCandado > -1, `${nombre} no pasa por p39_priv.bloquear_para_editar`);
    const idxEscritura = cuerpo.search(/\b(insert into|update|delete from)\s+public\./);
    assert.ok(idxEscritura > idxCandado, `${nombre} escribe antes de validar actor y tenant`);
  }

  assertSoloServiceRole("crear_cotizacion_manual(uuid, text, jsonb, jsonb)");
  assertSoloServiceRole("editar_servicios_cotizacion_manual(uuid, bigint, integer, text, jsonb, jsonb)");
  assertSoloServiceRole("actualizar_recobro_ninos_manual(uuid, bigint, integer, text, jsonb)");
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
