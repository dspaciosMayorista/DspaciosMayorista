/**
 * Prueba de integración de los ADJUNTOS del contrato, por la API de Storage.
 *
 *   node supabase/scripts/pruebas/storage-adjuntos.mjs --confirmar
 *
 * POR QUÉ EXISTE
 *   La prueba SQL no puede comprobar esto. Supabase trata `storage.objects`
 *   como solo lectura desde SQL: los archivos se suben y se borran por la API,
 *   que mueve el objeto físico y después su fila. Un `delete from
 *   storage.objects` es inválido en Supabase alojado aunque funcione en un
 *   PostgreSQL local — y eso fue justo lo que hizo fallar la comprobación
 *   «STORAGE DELETE (propio)» en producción, sin que hubiera nada roto.
 *
 *   Así que lo que la aplicación hace de verdad —subir, leer, reemplazar y
 *   eliminar con `.upload()`, `.createSignedUrl()` y `.remove()`— se prueba
 *   aquí, contra el Storage real y con usuarios reales.
 *
 * QUÉ COMPRUEBA
 *   · Un asesor (`venta`) puede subir, leer, reemplazar y eliminar archivos de
 *     SU contrato.
 *   · NO puede hacer ninguna de las cuatro en el contrato de un colega, y el
 *     archivo ajeno sigue intacto después de intentarlo.
 *   · Un usuario con rol ADMINISTRATIVO REAL sí puede en ambos.
 *
 * ⚠️ SERVICE-ROLE SOLO PARA FIXTURES, VERIFICACIÓN Y LIMPIEZA.
 *   Las comprobaciones de permisos se hacen SIEMPRE con la clave anon y una
 *   sesión iniciada, que es como entra la aplicación. Una comprobación hecha
 *   con service-role no prueba nada de RLS: esa clave se la salta por
 *   definición. La versión anterior de este archivo usaba service-role para el
 *   caso «rol administrativo» y por eso ese caso no probaba nada.
 *
 * ⚠️ ESCRIBE EN LA BASE REAL. Crea tres usuarios y dos contratos temporales,
 *   todos con la marca `__TEST_STORAGE__`, y los borra al terminar — también si
 *   algo falla a mitad. Si la limpieza falla, la prueba TERMINA EN ERROR: dejar
 *   usuarios y contratos de prueba en producción no es un detalle menor.
 *
 * VARIABLES DE ENTORNO (las mismas del proyecto):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Cada operación informa su ERROR EXACTO. Un «denegado» sin el motivo no
 * distingue entre una policy que funciona y una llamada mal hecha.
 */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "contratos";
const MARCA = "__TEST_STORAGE__";

if (!process.argv.includes("--confirmar")) {
  console.error("Esta prueba escribe en la base REAL (usuarios y contratos temporales, que después borra).");
  console.error("Si estás seguro:  node supabase/scripts/pruebas/storage-adjuntos.mjs --confirmar");
  process.exit(2);
}
for (const [k, v] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE })) {
  if (!v) { console.error(`Falta la variable de entorno ${k}.`); process.exit(2); }
}

// Service-role: SOLO fixtures, verificación independiente y limpieza.
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

let ok = 0, mal = 0;
const linea = (estado, texto, detalle) => {
  const marca = estado ? "[OK]   " : "[FALLA]";
  console.log(`  ${marca} ${texto}${detalle ? `\n            → ${detalle}` : ""}`);
  if (estado) { ok++; } else { mal++; }
};

/** Igual que `listaIncluye` de lib/adjuntos/operaciones.ts: acepta ruta o nombre. */
const listaIncluye = (data, path) => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return (data ?? []).some((o) => o.name === path || o.name === base || path.endsWith(`/${o.name}`));
};

/** Ejecuta una operación de Storage y devuelve {ok, detalle} con el error EXACTO. */
async function intentar(fn) {
  try {
    const r = await fn();
    if (r?.error) return { ok: false, detalle: `${r.error.name ?? "error"}: ${r.error.message}` };
    return { ok: true, detalle: null, data: r?.data };
  } catch (e) {
    return { ok: false, detalle: `excepción: ${e instanceof Error ? e.message : String(e)}` };
  }
}

const sello = Date.now();
const cPropio = `${MARCA}P-${sello}`;
const cAjeno = `${MARCA}A-${sello}`;
const clave = `Pr#${sello}-x9`;
const archivo = new Blob(["contenido de prueba, sin datos personales"], { type: "text/plain" });

const usuarios = {
  asesor: { correo: `test-asesor-${sello}@ejemplo.invalid`, nombre: `${MARCA} Asesor ${sello}`, rol: "venta", id: null },
  colega: { correo: `test-colega-${sello}@ejemplo.invalid`, nombre: `${MARCA} Colega ${sello}`, rol: "venta", id: null },
  admin: { correo: `test-admin-${sello}@ejemplo.invalid`, nombre: `${MARCA} Admin ${sello}`, rol: "administracion", id: null },
};

/** Inicia sesión con la clave ANON, como entra la aplicación. */
async function sesion(u) {
  const cli = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await cli.auth.signInWithPassword({ email: u.correo, password: clave });
  if (error) throw new Error(`No se pudo iniciar sesión como ${u.correo}: ${error.message}`);
  return cli;
}

/**
 * Limpieza. Cada fallo cuenta como comprobación fallida: si esto no funciona,
 * quedan usuarios y contratos de prueba en la base de producción, y eso no
 * puede terminar en verde.
 */
async function limpiar() {
  console.log("\n== Limpieza");

  for (const c of [cPropio, cAjeno]) {
    const { data, error } = await admin.storage.from(BUCKET).list(c);
    if (error) { linea(false, `Listar archivos de ${c}`, error.message); continue; }
    if (data?.length) {
      const paths = data.map((o) => `${c}/${o.name}`);
      const { error: eRm } = await admin.storage.from(BUCKET).remove(paths);
      linea(!eRm, `Eliminar ${paths.length} archivo(s) de ${c}`, eRm?.message);
    }
  }

  for (const c of [cPropio, cAjeno]) {
    const { error } = await admin.from("ventas").delete().eq("numero_contrato", c);
    linea(!error, `Eliminar el contrato ${c}`, error?.message);
  }

  for (const [ref, u] of Object.entries(usuarios)) {
    if (!u.id) continue;
    const { error } = await admin.auth.admin.deleteUser(u.id);
    linea(!error, `Eliminar el usuario ${ref}`, error?.message);
  }

  // ── Y ahora se COMPRUEBA que de verdad no quedó nada ────────────────────
  // Que las órdenes de borrado no devuelvan error no significa que hayan
  // borrado: es el mismo patrón que este trabajo persigue en toda la sesión.
  console.log("\n== Verificación de que no quedó rastro");

  for (const c of [cPropio, cAjeno]) {
    const { data, error } = await admin.storage.from(BUCKET).list(c);
    const quedan = (data ?? []).map((o) => o.name);
    linea(!error && quedan.length === 0, `Sin objetos en ${c}`,
      error?.message ?? (quedan.length ? `quedan: ${quedan.join(", ")}` : null));
  }

  const { data: ventas, error: eV } = await admin.from("ventas").select("numero_contrato").like("numero_contrato", `${MARCA}%`);
  linea(!eV && (ventas ?? []).length === 0, "Sin contratos con la marca de prueba",
    eV?.message ?? ((ventas ?? []).length ? (ventas ?? []).map((v) => v.numero_contrato).join(", ") : null));

  const { data: perfiles, error: eP } = await admin.from("usuarios").select("id, nombre").like("nombre", `${MARCA}%`);
  linea(!eP && (perfiles ?? []).length === 0, "Sin perfiles con la marca de prueba",
    eP?.message ?? ((perfiles ?? []).length ? (perfiles ?? []).map((p) => p.nombre).join(", ") : null));

  const { data: lista, error: eU } = await admin.auth.admin.listUsers({ perPage: 200 });
  const sobran = (lista?.users ?? []).filter((u) => (u.email ?? "").includes("@ejemplo.invalid"));
  linea(!eU && sobran.length === 0, "Sin usuarios de Auth con correo @ejemplo.invalid",
    eU?.message ?? (sobran.length ? sobran.map((u) => u.email).join(", ") : null));
}

try {
  // ── Fixtures (service-role) ───────────────────────────────────────────────
  console.log("== Fixtures temporales");

  // Tenant con contratos, para que `puede_ver_tenant` no deje la prueba vacía.
  const { data: unaVenta } = await admin.from("ventas").select("tenant").limit(1).maybeSingle();
  const tenant = unaVenta?.tenant ?? "mayorista";

  for (const [ref, u] of Object.entries(usuarios)) {
    const { data, error } = await admin.auth.admin.createUser({ email: u.correo, password: clave, email_confirm: true });
    if (error) throw new Error(`No se pudo crear el usuario ${ref}: ${error.message}`);
    u.id = data.user.id;
    const { error: e2 } = await admin.from("usuarios").update({ nombre: u.nombre, rol: u.rol, activo: true, tenant }).eq("id", u.id);
    if (e2) throw new Error(`No se pudo configurar el perfil de ${ref}: ${e2.message}`);
  }
  console.log(`   asesor y colega ('venta') y admin ('administracion') en el tenant '${tenant}'`);

  const { error: eV } = await admin.from("ventas").insert([
    { numero_contrato: cPropio, cliente: "CLIENTE PRUEBA", tenant, asesor: usuarios.asesor.nombre, precio_venta: 1000 },
    { numero_contrato: cAjeno, cliente: "CLIENTE PRUEBA", tenant, asesor: usuarios.colega.nombre, precio_venta: 2000 },
  ]);
  if (eV) throw new Error(`No se pudieron crear los contratos: ${eV.message}`);
  console.log(`   contrato propio ${cPropio} y ajeno ${cAjeno}`);

  const rutaAjena = `${cAjeno}/cedula-ajena.txt`;
  const { error: eSub } = await admin.storage.from(BUCKET).upload(rutaAjena, archivo, { upsert: true });
  if (eSub) throw new Error(`No se pudo sembrar el archivo ajeno: ${eSub.message}`);
  console.log(`   archivo ajeno sembrado en ${rutaAjena}`);

  // ── Asesor: sesión real con la clave anon ─────────────────────────────────
  const asesor = await sesion(usuarios.asesor);
  const st = asesor.storage.from(BUCKET);
  const rutaPropia = `${cPropio}/cedula-propia.txt`;

  console.log("\n== Contrato PROPIO — el asesor debe poder con las cuatro");

  let r = await intentar(() => st.upload(rutaPropia, archivo, { upsert: false }));
  linea(r.ok, "SUBIR su propio adjunto", r.detalle);

  r = await intentar(() => st.createSignedUrl(rutaPropia, 60));
  linea(r.ok, "LEER (URL firmada) su propio adjunto", r.detalle);

  r = await intentar(() => st.upload(rutaPropia, new Blob(["reemplazado"]), { upsert: true }));
  linea(r.ok, "REEMPLAZAR su propio adjunto", r.detalle);

  r = await intentar(() => st.remove([rutaPropia]));
  const borroPropio = r.ok && listaIncluye(r.data, rutaPropia);
  linea(borroPropio, "ELIMINAR su propio adjunto", r.detalle ?? (r.ok ? "la API no lo listó como eliminado" : null));

  // Verificación independiente, con service-role: la única forma de saber si el
  // archivo está o no, sin depender de lo que reporte la API al usuario.
  const { data: quedaPropio } = await admin.storage.from(BUCKET).list(cPropio);
  linea((quedaPropio ?? []).length === 0, "…y el archivo propio ya no está en el bucket",
    (quedaPropio ?? []).length ? `siguen: ${(quedaPropio ?? []).map((o) => o.name).join(", ")}` : null);

  console.log("\n== Contrato AJENO — las cuatro deben ser RECHAZADAS");

  r = await intentar(() => st.upload(`${cAjeno}/intruso.txt`, archivo, { upsert: false }));
  linea(!r.ok, "SUBIR a un contrato ajeno debe fallar", r.detalle ?? "no falló: la subida fue aceptada");

  r = await intentar(() => st.createSignedUrl(rutaAjena, 60));
  linea(!r.ok, "LEER (URL firmada) un adjunto ajeno debe fallar", r.detalle ?? "no falló: entregó una URL firmada");

  r = await intentar(() => st.upload(rutaAjena, new Blob(["pisado"]), { upsert: true }));
  linea(!r.ok, "REEMPLAZAR un adjunto ajeno debe fallar", r.detalle ?? "no falló: lo sobrescribió");

  r = await intentar(() => st.remove([rutaAjena]));
  const borroAjeno = r.ok && listaIncluye(r.data, rutaAjena);
  linea(!borroAjeno, "ELIMINAR un adjunto ajeno debe fallar",
    r.detalle ?? (borroAjeno ? "no falló: lo eliminó" : "la API respondió sin error pero no eliminó nada (RLS filtró el objeto)"));

  const { data: listaAjena } = await admin.storage.from(BUCKET).list(cAjeno);
  const sigueAjeno = (listaAjena ?? []).some((o) => o.name === "cedula-ajena.txt");
  linea(sigueAjeno, "El archivo ajeno sigue intacto tras los cuatro intentos",
    sigueAjeno ? null : "DESAPARECIÓ: alguna de las operaciones sí surtió efecto");

  const intruso = (listaAjena ?? []).some((o) => o.name === "intruso.txt");
  linea(!intruso, "No quedó ningún archivo colado en el contrato ajeno",
    intruso ? "quedó 'intruso.txt': la subida ajena sí pasó" : null);

  await asesor.auth.signOut();

  // ── Rol administrativo: usuario REAL, sesión anon ─────────────────────────
  // Esta parte no es decorativa: sin ella la prueba pasaría igual si las
  // policies le cerraran el paso a todo el mundo.
  console.log("\n== Rol administrativo REAL (sesión anon, no service-role)");
  const gestor = await sesion(usuarios.admin);
  const stAdmin = gestor.storage.from(BUCKET);

  r = await intentar(() => stAdmin.createSignedUrl(rutaAjena, 60));
  linea(r.ok, "Un rol administrativo LEE el adjunto de cualquier contrato", r.detalle);

  const rutaAdmin = `${cAjeno}/subido-por-admin.txt`;
  r = await intentar(() => stAdmin.upload(rutaAdmin, archivo, { upsert: false }));
  linea(r.ok, "Un rol administrativo SUBE a un contrato que no gestiona", r.detalle);

  r = await intentar(() => stAdmin.remove([rutaAdmin]));
  const borroAdmin = r.ok && listaIncluye(r.data, rutaAdmin);
  linea(borroAdmin, "Un rol administrativo ELIMINA lo que subió",
    r.detalle ?? (r.ok ? "la API no lo listó como eliminado" : null));

  await gestor.auth.signOut();
} catch (e) {
  console.error(`\n[ERROR] ${e instanceof Error ? e.message : String(e)}`);
  mal++;
} finally {
  try {
    await limpiar();
  } catch (e) {
    linea(false, "La limpieza falló por completo", e instanceof Error ? e.message : String(e));
  }
}

console.log(`\nRESULTADO: ${ok} correctas, ${mal} incorrectas`);
if (mal > 0) console.log("Si hay fallos en la limpieza, revisa a mano lo que lleve la marca " + MARCA);
process.exit(mal === 0 ? 0 : 1);
