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
 *   · Un asesor (`venta`) puede listar, subir, leer, reemplazar y eliminar
 *     archivos de SU contrato.
 *   · NO puede hacer ninguna de las cinco en el contrato de un colega, y el
 *     archivo ajeno sigue intacto después de intentarlo.
 *   · Un usuario con rol ADMINISTRATIVO REAL sí puede en ambos.
 *   · CRUCE ENTRE AGENCIAS: un interno (`operaciones` y `administracion`) de
 *     UNA agencia no debe alcanzar los archivos de un contrato de la OTRA.
 *     Y un `superadmin` sí, porque su alcance es global por diseño.
 *
 * ⚠️ EL BLOQUE DE CRUCE ENTRE AGENCIAS EXIGE LA MIGRACIÓN 150.
 *   Contra un proyecto que todavía no la tenga, ese bloque FALLA — y el fallo
 *   es correcto: mide el agujero que la 150 cierra. Las policies anteriores
 *   (migración 148) decían:
 *
 *     bucket_id = 'contratos'
 *     and mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
 *     and (mi_rol() <> 'venta' or soy_asesor_del_contrato(split_part(name,'/',1)))
 *
 *   Con `operaciones` o `administracion`, `mi_rol() <> 'venta'` ya es TRUE, así
 *   que la disyunción se resolvía sin llegar a `soy_asesor_del_contrato`; y
 *   ninguna de las cuatro comparaba el tenant. Cualquier interno de una agencia
 *   alcanzaba todos los archivos de la otra.
 *
 *   Con la 150 aplicada debe pasar entero. Correrlo ANTES y DESPUÉS es lo que
 *   demuestra que la migración hizo algo.
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

const cOtraAgencia = `${MARCA}X-${sello}`;

// `tenant` se resuelve más abajo (la agencia que tenga contratos); estos tres
// usuarios se quedan en ella y el contrato `cOtraAgencia` va en la contraria.
const usuarios = {
  asesor: { correo: `test-asesor-${sello}@ejemplo.invalid`, nombre: `${MARCA} Asesor ${sello}`, rol: "venta", id: null },
  colega: { correo: `test-colega-${sello}@ejemplo.invalid`, nombre: `${MARCA} Colega ${sello}`, rol: "venta", id: null },
  admin: { correo: `test-admin-${sello}@ejemplo.invalid`, nombre: `${MARCA} Admin ${sello}`, rol: "administracion", id: null },
  opera: { correo: `test-opera-${sello}@ejemplo.invalid`, nombre: `${MARCA} Operaciones ${sello}`, rol: "operaciones", id: null },
  // ⚠️ superadmin temporal: es el rol más potente del sistema. Existe solo
  // para comprobar que el candado del cruce no se cierra a costa de dejar sin
  // acceso a quien debe tenerlo. Se borra en la limpieza, que además VERIFICA
  // que se fue. Si la limpieza falla, este usuario es lo primero que hay que
  // borrar a mano.
  jefe: { correo: `test-super-${sello}@ejemplo.invalid`, nombre: `${MARCA} Superadmin ${sello}`, rol: "superadmin", id: null },
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

  for (const c of [cPropio, cAjeno, cOtraAgencia]) {
    const { data, error } = await admin.storage.from(BUCKET).list(c);
    if (error) { linea(false, `Listar archivos de ${c}`, error.message); continue; }
    if (data?.length) {
      const paths = data.map((o) => `${c}/${o.name}`);
      const { error: eRm } = await admin.storage.from(BUCKET).remove(paths);
      linea(!eRm, `Eliminar ${paths.length} archivo(s) de ${c}`, eRm?.message);
    }
  }

  for (const c of [cPropio, cAjeno, cOtraAgencia]) {
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

  for (const c of [cPropio, cAjeno, cOtraAgencia]) {
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

  // Se comprueban EXACTAMENTE los tres ids creados, uno por uno.
  //
  // Antes esto era `listUsers({ perPage: 200 })` y filtraba por correo: si el
  // proyecto tiene más usuarios que esa página, los temporales podían quedar
  // fuera del listado y la comprobación pasaba en verde con los usuarios
  // todavía en la base. Preguntar por id no depende de cuántos usuarios haya.
  for (const [ref, u] of Object.entries(usuarios)) {
    if (!u.id) { linea(false, `No se llegó a crear el usuario ${ref} (nada que verificar)`, "revisa los errores de arriba"); continue; }
    const { data, error } = await admin.auth.admin.getUserById(u.id);
    // Cuando el usuario ya no existe la API responde con error (404) o sin
    // usuario. Las dos formas significan lo mismo: se fue.
    const sigue = !error && !!data?.user?.id;
    linea(!sigue, `El usuario ${ref} ya no existe en Auth`,
      sigue ? `sigue ahí: ${data.user.email} (${u.id})` : null);
  }
}

try {
  // ── Fixtures (service-role) ───────────────────────────────────────────────
  console.log("== Fixtures temporales");

  // Tenant con contratos, para que `puede_ver_tenant` no deje la prueba vacía.
  const { data: unaVenta } = await admin.from("ventas").select("tenant").limit(1).maybeSingle();
  const tenant = unaVenta?.tenant ?? "mayorista";
  // La OTRA agencia. Solo hay dos, así que es la contraria de la elegida.
  const otroTenant = tenant === "mayorista" ? "minorista" : "mayorista";

  for (const [ref, u] of Object.entries(usuarios)) {
    const { data, error } = await admin.auth.admin.createUser({ email: u.correo, password: clave, email_confirm: true });
    if (error) throw new Error(`No se pudo crear el usuario ${ref}: ${error.message}`);
    u.id = data.user.id;
    const { error: e2 } = await admin.from("usuarios").update({ nombre: u.nombre, rol: u.rol, activo: true, tenant }).eq("id", u.id);
    if (e2) throw new Error(`No se pudo configurar el perfil de ${ref}: ${e2.message}`);
  }
  console.log(`   asesor/colega ('venta'), admin ('administracion'), opera ('operaciones') y jefe ('superadmin') en el tenant '${tenant}'`);

  const { error: eV } = await admin.from("ventas").insert([
    { numero_contrato: cPropio, cliente: "CLIENTE PRUEBA", tenant, asesor: usuarios.asesor.nombre, precio_venta: 1000 },
    { numero_contrato: cAjeno, cliente: "CLIENTE PRUEBA", tenant, asesor: usuarios.colega.nombre, precio_venta: 2000 },
    // Contrato de la OTRA agencia. El asesor es un nombre que NO coincide con
    // ningún usuario de la prueba: así el rechazo no puede deberse a una
    // coincidencia de nombre, solo a la separación por agencia.
    { numero_contrato: cOtraAgencia, cliente: "CLIENTE PRUEBA", tenant: otroTenant, asesor: `${MARCA} Nadie ${sello}`, precio_venta: 3000 },
  ]);
  if (eV) throw new Error(`No se pudieron crear los contratos: ${eV.message}`);
  console.log(`   contrato propio ${cPropio}, ajeno ${cAjeno} y de la otra agencia ${cOtraAgencia} (tenant '${otroTenant}')`);

  const rutaAjena = `${cAjeno}/cedula-ajena.txt`;
  const { error: eSub } = await admin.storage.from(BUCKET).upload(rutaAjena, archivo, { upsert: true });
  if (eSub) throw new Error(`No se pudo sembrar el archivo ajeno: ${eSub.message}`);
  console.log(`   archivo ajeno sembrado en ${rutaAjena}`);

  const rutaOtraAgencia = `${cOtraAgencia}/cedula-otra-agencia.txt`;
  const TEXTO_OTRA = `contenido original de la otra agencia ${sello}`;
  const { error: eSub2 } = await admin.storage.from(BUCKET)
    .upload(rutaOtraAgencia, new Blob([TEXTO_OTRA], { type: "text/plain" }), { upsert: true });
  if (eSub2) throw new Error(`No se pudo sembrar el archivo de la otra agencia: ${eSub2.message}`);
  console.log(`   archivo de la otra agencia sembrado en ${rutaOtraAgencia}`);

  // ── Asesor: sesión real con la clave anon ─────────────────────────────────
  const asesor = await sesion(usuarios.asesor);
  const st = asesor.storage.from(BUCKET);
  const rutaPropia = `${cPropio}/cedula-propia.txt`;

  console.log("\n== Contrato PROPIO — el asesor debe poder con las cinco");

  let r = await intentar(() => st.upload(rutaPropia, archivo, { upsert: false }));
  linea(r.ok, "SUBIR su propio adjunto", r.detalle);

  r = await intentar(() => st.list(cPropio));
  linea(r.ok && listaIncluye(r.data, rutaPropia), "LISTAR su propia carpeta",
    r.detalle ?? (r.ok ? "respondió sin error pero no listó el archivo" : null));

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

  console.log("\n== Contrato AJENO — las cinco deben ser RECHAZADAS");

  // `list()` no da error cuando la RLS filtra: devuelve una lista vacía. Igual
  // que `remove()`, hay que mirar el CONTENIDO, no solo `error`.
  r = await intentar(() => st.list(cAjeno));
  const vioAjena = r.ok && listaIncluye(r.data, rutaAjena);
  linea(!vioAjena, "LISTAR la carpeta de un contrato ajeno debe fallar o venir vacía",
    r.detalle ?? (vioAjena ? "no falló: listó el archivo ajeno" : null));

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

  // ── CRUCE ENTRE AGENCIAS ─────────────────────────────────────────────────
  // Requiere la migración 150. Sin ella estas comprobaciones fallan, y ese
  // fallo es la medida del agujero (ver la cabecera del archivo).
  console.log("\n== CRUCE ENTRE AGENCIAS — un interno de una agencia NO debe alcanzar la otra");
  console.log(`   usuarios en '${tenant}' contra el contrato ${cOtraAgencia} de '${otroTenant}'`);

  for (const ref of ["opera", "admin"]) {
    const u = usuarios[ref];
    const cli = await sesion(u);
    const stX = cli.storage.from(BUCKET);
    const etiqueta = `${u.rol} de '${tenant}'`;
    const rutaIntrusa = `${cOtraAgencia}/intruso-${ref}.txt`;

    let x = await intentar(() => stX.list(cOtraAgencia));
    const vio = x.ok && listaIncluye(x.data, rutaOtraAgencia);
    linea(!vio, `${etiqueta}: LISTAR la carpeta de la otra agencia debe fallar o venir vacía`,
      x.detalle ?? (vio ? "no falló: listó el archivo de la otra agencia" : null));

    x = await intentar(() => stX.createSignedUrl(rutaOtraAgencia, 60));
    linea(!x.ok, `${etiqueta}: FIRMAR URL de un adjunto de la otra agencia debe fallar`,
      x.detalle ?? "no falló: entregó una URL firmada");

    x = await intentar(() => stX.upload(rutaIntrusa, archivo, { upsert: false }));
    linea(!x.ok, `${etiqueta}: SUBIR a un contrato de la otra agencia debe fallar`,
      x.detalle ?? "no falló: la subida fue aceptada");

    x = await intentar(() => stX.upload(rutaOtraAgencia, new Blob(["pisado por otra agencia"]), { upsert: true }));
    linea(!x.ok, `${etiqueta}: REEMPLAZAR un adjunto de la otra agencia debe fallar`,
      x.detalle ?? "no falló: lo sobrescribió");

    x = await intentar(() => stX.remove([rutaOtraAgencia]));
    const borro = x.ok && listaIncluye(x.data, rutaOtraAgencia);
    linea(!borro, `${etiqueta}: ELIMINAR un adjunto de la otra agencia debe fallar`,
      x.detalle ?? (borro ? "no falló: lo eliminó" : "la API respondió sin error pero no eliminó nada"));

    await cli.auth.signOut();
  }

  // Verificación independiente con service-role: no basta con que el archivo
  // SIGA ahí — hay que comprobar que su CONTENIDO no cambió, porque un
  // reemplazo con upsert deja el mismo nombre con otros bytes dentro.
  {
    const { data: lista } = await admin.storage.from(BUCKET).list(cOtraAgencia);
    const nombres = (lista ?? []).map((o) => o.name);

    linea(nombres.includes("cedula-otra-agencia.txt"),
      "El adjunto de la otra agencia sigue existiendo",
      nombres.includes("cedula-otra-agencia.txt") ? null : "DESAPARECIÓ: el borrado cruzado surtió efecto");

    const colados = nombres.filter((n) => n.startsWith("intruso-"));
    linea(colados.length === 0, "No quedó ningún archivo colado en el contrato de la otra agencia",
      colados.length ? `quedaron: ${colados.join(", ")}` : null);

    const { data: blob, error: eDl } = await admin.storage.from(BUCKET).download(rutaOtraAgencia);
    if (eDl) {
      linea(false, "El CONTENIDO del adjunto de la otra agencia no cambió", `no se pudo descargar: ${eDl.message}`);
    } else {
      const texto = await blob.text();
      linea(texto === TEXTO_OTRA, "El CONTENIDO del adjunto de la otra agencia no cambió",
        texto === TEXTO_OTRA ? null : `fue sobrescrito: "${texto.slice(0, 60)}"`);
    }
  }

  // ── superadmin: el alcance global SÍ debe seguir funcionando ──────────────
  // Sin esto, el candado del cruce se podría "aprobar" cerrándole el paso a
  // todo el mundo, que es la misma trampa que ya cubre el bloque administrativo.
  console.log("\n== superadmin — su alcance es global por diseño y debe seguir funcionando");
  const jefe = await sesion(usuarios.jefe);
  const stJefe = jefe.storage.from(BUCKET);

  r = await intentar(() => stJefe.list(cOtraAgencia));
  linea(r.ok && listaIncluye(r.data, rutaOtraAgencia), "superadmin LISTA la carpeta de la otra agencia",
    r.detalle ?? (r.ok ? "respondió sin error pero no listó el archivo" : null));

  r = await intentar(() => stJefe.createSignedUrl(rutaOtraAgencia, 60));
  linea(r.ok, "superadmin FIRMA URL de un adjunto de la otra agencia", r.detalle);

  const rutaJefe = `${cOtraAgencia}/subido-por-superadmin.txt`;
  r = await intentar(() => stJefe.upload(rutaJefe, archivo, { upsert: false }));
  linea(r.ok, "superadmin SUBE a un contrato de la otra agencia", r.detalle);

  r = await intentar(() => stJefe.remove([rutaJefe]));
  const borroJefe = r.ok && listaIncluye(r.data, rutaJefe);
  linea(borroJefe, "superadmin ELIMINA lo que subió",
    r.detalle ?? (r.ok ? "la API no lo listó como eliminado" : null));

  await jefe.auth.signOut();
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
