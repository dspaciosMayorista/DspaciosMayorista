/**
 * SONDA POR API (PostgREST) del acceso a `crm_contactos` · hotfix de acceso.
 * SOLO LECTURA: únicamente peticiones HEAD con `count=exact`. No descarga
 * contactos, no inserta, no actualiza, no borra. Nunca usa service-role.
 *
 *   node supabase/scripts/pruebas/api_207_crm_contactos_acceso.mjs --fase=pre
 *   node supabase/scripts/pruebas/api_207_crm_contactos_acceso.mjs --fase=post --totales="S / M / N"
 *
 * FASES
 *   pre   ANTES de la migración. La columna `tenant` aún no existe, así que
 *         solo se pide el TOTAL visible y el estado HTTP. Deja constancia del
 *         estado inicial (con la policy de la 042 una cuenta B2B ve > 0: eso
 *         se reporta como EVIDENCIA de la fuga, no como fallo de la sonda).
 *   post  DESPUÉS de la migración y del despliegue. Además del total, cuenta
 *         por agencia (propia / la otra) y sin atribuir (tenant NULL), y
 *         compara con la regla Y con los totales autorizados:
 *           anon ............. negado por privilegio (HTTP 401/403)
 *           B2B .............. HTTP 200 y 0 visibles
 *           interno .......... ve EXACTAMENTE el total de su agencia; 0 de la
 *                              otra y 0 sin atribuir
 *           gerencia/superadm. ve EXACTAMENTE el total agregado (las dos
 *                              agencias + sin atribuir), grupo por grupo
 *         Falla tanto por FUGA (ve de más) como por PÉRDIDA de acceso
 *         legítimo (ve de menos): un candado demasiado cerrado también rompe
 *         el CRM interno.
 *
 *   --totales es OBLIGATORIO en post: el valor de la fila 20 del postcheck
 *   ("informativo: filas sin atribuir / mayorista / minorista"), copiado tal
 *   cual, p. ej. --totales="27 / 0 / 0". Correr la sonda inmediatamente
 *   después del postcheck: si alguien crea o borra contactos entre medias,
 *   los totales cambian y hay que repetir ambos (falla cerrado, no abierto).
 *
 * Un error HTTP o SQL NUNCA se interpreta como "0 visibles": es FALLO. La
 * única negación aceptada es la de `anon` en fase post, y solo con el estado
 * HTTP de falta de privilegio.
 *
 * SESIONES (cuentas de prueba que el usuario ya tiene o crea por la app;
 * este script no crea usuarios). Archivo JSON LOCAL, FUERA del repo, con la
 * ruta en CRM_ACCESO_CUENTAS:
 *   [
 *     { "categoria": "b2b",                "email": "...", "password": "..." },
 *     { "categoria": "interno_mayorista",  "email": "...", "password": "..." },
 *     { "categoria": "interno_minorista",  "email": "...", "password": "..." },
 *     { "categoria": "gerencia",           "email": "...", "password": "..." },
 *     { "categoria": "superadmin",         "email": "...", "password": "..." }
 *   ]
 *   `anon` se prueba siempre, sin cuenta. Si falta alguna categoría la sonda
 *   termina INCOMPLETA (código de salida distinto de 0).
 *
 *   ÚNICA OMISIÓN PERMITIDA: `interno_minorista`, solo si el preflight FRESCO
 *   de solo lectura demuestra que no existe ningún usuario interno activo de
 *   minorista (en Producción hoy hay 0: no hay a quién probar). Se declara con
 *       --sin-interno-minorista="<valor de la fila 30 del preflight, tal cual>"
 *   La sonda lee ese valor ("rol·agencia=n, ...") y:
 *     · si hay ALGÚN administracion/operaciones/venta de minorista con n > 0,
 *       FALLA (hay a quién probar: se vuelve a exigir una sesión real);
 *     · si el valor no se puede interpretar, FALLA (nada de omisiones a ciegas);
 *     · si además el JSON trae una cuenta interno_minorista, se niega (código
 *       2): o se prueba la cuenta real o se omite, no ambas.
 *   La omisión nunca cuenta como prueba superada: la salida dice "NO PROBADO",
 *   el resumen final lo repite y las demás categorías siguen obligatorias.
 *   El aislamiento de interno_minorista se prueba de verdad en la suite local
 *   (test_207_api_crm_contactos_acceso.sh), con una cuenta real de esa base.
 *   La frescura del preflight es responsabilidad de quien lo corre: pegar el
 *   valor de la ejecución inmediatamente anterior a la sonda.
 *   interno_* = administracion, operaciones o venta ACTIVO de esa agencia.
 *   La categoría declarada se contrasta con el perfil real (rol/agencia/activo
 *   de la propia fila de `usuarios`, que la RLS deja leer); si no coincide,
 *   FALLO: evita sacar conclusiones con una cuenta mal elegida.
 *
 * VARIABLES DE ENTORNO (nombres; los valores no se imprimen):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, CRM_ACCESO_CUENTAS
 *
 * SALIDA: categoría, rol, agencia, estado HTTP y conteos. Nunca imprime
 * emails, contraseñas, tokens, claves, ids ni datos de contactos.
 *
 * Al terminar cada cuenta se cierra la sesión con `scope: "local"`: no revoca
 * las otras sesiones abiertas de esa cuenta (p. ej. la del navegador).
 */
import { readFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const arg = process.argv.find((a) => a.startsWith("--fase="));
const FASE = arg?.slice("--fase=".length);
if (FASE !== "pre" && FASE !== "post") {
  console.error("Indica --fase=pre (antes de la migración) o --fase=post (después).");
  process.exit(2);
}

// Omisión explícita de interno_minorista (ver cabecera). Se valida contra el
// valor de la fila 30 del preflight; sin el flag no cambia nada.
const argOmision = process.argv.find((a) => a.startsWith("--sin-interno-minorista="));
let OMITE_MINORISTA = false;
if (argOmision) {
  const valor = argOmision.slice("--sin-interno-minorista=".length).trim();
  const INTERNOS_FILA = ["administracion", "operaciones", "venta"];
  const sinDatos = valor === "(ninguno)";
  const entradas = sinDatos ? [] : valor.split(",").map((x) => x.trim());
  const formaOk = sinDatos || (entradas.length > 0 && entradas.every((x) => /^[a-z_]+·(mayorista|minorista)=\d+$/.test(x)));
  if (!formaOk) {
    console.error("--sin-interno-minorista: el valor no es la fila 30 del preflight (esperado: rol·agencia=n, …). No se omite nada.");
    process.exit(2);
  }
  const hay = entradas
    .map((x) => x.match(/^([a-z_]+)·(mayorista|minorista)=(\d+)$/))
    .filter((m) => m && m[2] === "minorista" && INTERNOS_FILA.includes(m[1]) && Number(m[3]) > 0)
    .map((m) => `${m[1]}=${m[3]}`);
  if (hay.length) {
    console.log(`FALLO interno_minorista: el preflight cuenta usuarios internos de minorista (${hay.join(", ")}); hay a quién probar. Quitar --sin-interno-minorista y aportar una sesión real.`);
    process.exit(1);
  }
  OMITE_MINORISTA = true;
}

// Totales autorizados (solo post): "sin_atribuir / mayorista / minorista".
let TOTALES = null;
if (FASE === "post") {
  const t = process.argv.find((a) => a.startsWith("--totales="))?.slice("--totales=".length) ?? "";
  const m = t.match(/^\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*$/);
  if (!m) {
    console.error('Fase post: falta --totales="S / M / N" (fila 20 del postcheck: sin atribuir / mayorista / minorista).');
    process.exit(2);
  }
  TOTALES = { null: Number(m[1]), mayorista: Number(m[2]), minorista: Number(m[3]) };
}

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const RUTA = process.env.CRM_ACCESO_CUENTAS;
if (!URL_SB || !ANON) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(2);
}
if (!RUTA) {
  console.error("Falta CRM_ACCESO_CUENTAS (ruta a un JSON local fuera del repo).");
  process.exit(2);
}
// El archivo de credenciales no puede vivir dentro del repositorio.
const raizRepo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const relRuta = relative(realpathSync(raizRepo), realpathSync(resolve(RUTA)));
if (!relRuta.startsWith("..") && !isAbsolute(relRuta)) {
  console.error("CRM_ACCESO_CUENTAS apunta DENTRO del repositorio. Muévelo fuera.");
  process.exit(2);
}

const cuentas = JSON.parse(readFileSync(RUTA, "utf8"));
const CATEGORIAS = ["b2b", "interno_mayorista", "interno_minorista", "gerencia", "superadmin"];
const EXTERNOS = ["agencia", "freelance", "cliente_final"];
const INTERNOS_AGENCIA = ["administracion", "operaciones", "venta"];

let fallos = 0;
const cubiertas = new Set();
const out = (o) => console.log("  " + Object.entries(o).map(([k, v]) => `${k}=${v}`).join("  "));
const fallo = (cat, msg) => { fallos++; console.log(`FALLO ${cat}: ${msg}`); };

/** HEAD con count=exact. Devuelve { ok, status, n } — n es null si hubo error. */
async function contar(sb, filtro) {
  let q = sb.from("crm_contactos").select("id", { count: "exact", head: true });
  if (filtro) q = filtro(q);
  const { count, error, status } = await q;
  if (error || typeof count !== "number") return { ok: false, status, n: null };
  return { ok: true, status, n: count };
}

function categoriaReal(perfil) {
  if (!perfil?.activo) return "inactivo";
  if (EXTERNOS.includes(perfil.rol)) return "b2b";
  if (perfil.rol === "gerencia" || perfil.rol === "superadmin") return perfil.rol;
  if (INTERNOS_AGENCIA.includes(perfil.rol)) return `interno_${perfil.tenant}`;
  return `otro:${perfil.rol}`;
}

async function sondear(cat, sb, perfil) {
  const total = await contar(sb);
  if (FASE === "pre") {
    if (!total.ok) return fallo(cat, `SELECT falló (HTTP ${total.status}); no se pudo medir`);
    out({ categoria: cat, rol: perfil.rol, agencia: perfil.tenant, http: total.status, visibles: total.n });
    if ((cat === "anon" || cat === "b2b") && total.n > 0) {
      console.log(`EVIDENCIA ${cat}: ve ${total.n} contactos con la policy actual (fuga que cierra el hotfix)`);
    } else {
      console.log(`OK    ${cat} (medido)`);
    }
    return;
  }

  // ── post ──
  if (cat === "anon") {
    out({ categoria: cat, http: total.status, visibles: total.ok ? total.n : "-" });
    if (!total.ok && (total.status === 401 || total.status === 403)) return console.log("OK    anon negado por privilegio");
    if (total.ok) return fallo(cat, `respondió HTTP ${total.status} con ${total.n} visibles; el GRANT de anon no se revocó`);
    return fallo(cat, `error inesperado HTTP ${total.status}`);
  }
  if (!total.ok) return fallo(cat, `SELECT falló (HTTP ${total.status})`);

  const otra = perfil.tenant === "mayorista" ? "minorista" : "mayorista";
  const propia = await contar(sb, (q) => q.eq("tenant", perfil.tenant));
  const ajena = await contar(sb, (q) => q.eq("tenant", otra));
  const sinAtr = await contar(sb, (q) => q.is("tenant", null));
  for (const [nombre, r] of [["propia", propia], ["otra agencia", ajena], ["sin atribuir", sinAtr]]) {
    if (!r.ok) return fallo(cat, `conteo "${nombre}" falló (HTTP ${r.status}); ¿columna tenant ausente o esquema sin recargar?`);
  }
  out({ categoria: cat, rol: perfil.rol, agencia: perfil.tenant, http: total.status,
        visibles: total.n, propia: propia.n, otra_agencia: ajena.n, sin_atribuir: sinAtr.n });

  const problemas = [];
  if (propia.n + ajena.n + sinAtr.n !== total.n) problemas.push("los conteos parciales no suman el total");
  // Lo que la regla autoriza a ver, grupo por grupo, según los totales.
  let esperado;
  if (cat === "b2b") esperado = { propia: 0, otra: 0, sin: 0 };
  else if (cat.startsWith("interno_")) esperado = { propia: TOTALES[perfil.tenant], otra: 0, sin: 0 };
  else esperado = { propia: TOTALES[perfil.tenant], otra: TOTALES[otra], sin: TOTALES.null };   // gerencia/superadmin
  for (const [nombre, visto, esp] of [["propia", propia.n, esperado.propia], ["otra agencia", ajena.n, esperado.otra],
                                      ["sin atribuir", sinAtr.n, esperado.sin]]) {
    if (visto > esp) problemas.push(`FUGA: ve ${visto} ${nombre}, autorizado ${esp}`);
    if (visto < esp) problemas.push(`PÉRDIDA de acceso legítimo: ve ${visto} ${nombre}, autorizado ${esp}`);
  }
  if (problemas.length) return fallo(cat, problemas.join("; "));
  console.log(`OK    ${cat}`);
}

if (OMITE_MINORISTA && cuentas.some((c) => c.categoria === "interno_minorista")) {
  console.error("--sin-interno-minorista junto a una cuenta interno_minorista en el JSON: elegir una sola. No se prueba nada.");
  process.exit(2);
}

console.log(`== Sonda crm_contactos · fase ${FASE} · solo HEAD/conteo`);

// 1) anon (sin sesión).
{
  const sb = createClient(URL_SB, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  await sondear("anon", sb, { rol: "anon", tenant: "-" });
}

// 2) Cuentas de prueba.
for (const c of cuentas) {
  const cat = c.categoria;
  if (!CATEGORIAS.includes(cat)) { fallo(String(cat), "categoría desconocida en el JSON"); continue; }
  const sb = createClient(URL_SB, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: c.email, password: c.password });
  if (error || !data?.user) { fallo(cat, `no inició sesión (HTTP ${error?.status ?? "?"})`); continue; }
  try {
    const { data: perfil, error: ep } = await sb.from("usuarios").select("rol, tenant, activo").eq("id", data.user.id).maybeSingle();
    if (ep || !perfil) { fallo(cat, "no se pudo leer el perfil propio"); continue; }
    const real = categoriaReal(perfil);
    if (real !== cat) { fallo(cat, `la cuenta es "${real}", no "${cat}"`); continue; }
    await sondear(cat, sb, perfil);
    cubiertas.add(cat);
  } finally {
    await sb.auth.signOut({ scope: "local" });
  }
}

if (OMITE_MINORISTA) {
  console.log("NO PROBADO interno_minorista: el preflight cuenta 0 usuarios internos de minorista, no hay sesión real que probar. NO es una prueba superada; el aislamiento de esta categoría solo está probado en la suite local.");
}
const faltan = CATEGORIAS.filter((k) => !cubiertas.has(k) && !(OMITE_MINORISTA && k === "interno_minorista"));
if (faltan.length) console.log(`INCOMPLETA: faltan sesiones de ${faltan.join(", ")}`);
const nota = OMITE_MINORISTA ? " (con omisión explícita: interno_minorista NO PROBADO)" : "";
console.log(fallos || faltan.length ? `\n== ${fallos} FALLO(S)${faltan.length ? ", INCOMPLETA" : ""}` : `\n== TODO OK${nota}`);
process.exit(fallos || faltan.length ? 1 : 0);
