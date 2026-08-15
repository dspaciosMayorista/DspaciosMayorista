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
 *   · CARPETA `pe-empleados/` (contratos laborales de nómina, migración 150):
 *     mismo criterio que la RLS de `pe_empleados` — `gerencia`/`administracion`
 *     de la agencia del empleado sí; de la OTRA agencia no; `operaciones` y
 *     `venta` no, aunque sí puedan tocar el bucket `contratos` para adjuntos de
 *     contrato (son carpetas del mismo bucket con reglas distintas); y
 *     `superadmin` sí, siempre.
 *
 * ⚠️ EL BLOQUE DE CRUCE ENTRE AGENCIAS Y EL DE NÓMINA EXIGEN LA MIGRACIÓN 150.
 *   Contra un proyecto que todavía no la tenga, esos bloques FALLAN — y el
 *   fallo es correcto: miden el agujero que la 150 cierra (Storage no tenía
 *   ningún candado propio de nómina antes de la 150; el aislamiento de
 *   `pe-empleados/` nace CON esa migración, no lo tenía la 148). Las policies
 *   anteriores (migración 148) decían:
 *
 *     bucket_id = 'contratos'
 *     and mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
 *     and (mi_rol() <> 'venta' or soy_asesor_del_contrato(split_part(name,'/',1)))
 *
 *   Con `operaciones` o `administracion`, `mi_rol() <> 'venta'` ya es TRUE, así
 *   que la disyunción se resolvía sin llegar a `soy_asesor_del_contrato`; y
 *   ninguna de las cuatro comparaba el tenant NI distinguía la carpeta
 *   `pe-empleados/` de un adjunto de contrato — `operaciones` y `venta` podían
 *   abrir el contrato laboral (con el salario) de cualquier empleado.
 *
 *   Con la 150 aplicada, los dos bloques deben pasar enteros. Correrlos ANTES
 *   y DESPUÉS es lo que demuestra que la migración hizo algo.
 *
 * ⚠️ SERVICE-ROLE SOLO PARA FIXTURES, VERIFICACIÓN Y LIMPIEZA.
 *   Las comprobaciones de permisos se hacen SIEMPRE con la clave anon y una
 *   sesión iniciada, que es como entra la aplicación. Una comprobación hecha
 *   con service-role no prueba nada de RLS: esa clave se la salta por
 *   definición. La versión anterior de este archivo usaba service-role para el
 *   caso «rol administrativo» y por eso ese caso no probaba nada.
 *
 * ⚠️ ESCRIBE EN LA BASE REAL. Crea siete usuarios (venta ×2, administracion ×2
 *   —uno de cada agencia—, operaciones, gerencia y superadmin), tres contratos
 *   (uno de cada agencia) y dos empleados de nómina (uno de cada agencia),
 *   todos con la marca `__TEST_STORAGE__` (los empleados de nómina se marcan
 *   por su ID, ver la limpieza), y los borra al terminar — también si algo
 *   falla a mitad. Si la limpieza falla, la prueba TERMINA EN ERROR: dejar
 *   usuarios, contratos y empleados de prueba en producción no es un detalle
 *   menor.
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

// Declaradas en el ámbito del módulo (no dentro del `try`) A PROPÓSITO:
// `limpiar()` está definida ANTES del `try` y necesita verlas. Si quedaran
// como `const` dentro del `try`, `limpiar()` no las vería —no por hoisting,
// sino porque el `try {}` es un bloque léxico aparte— y la limpieza de nómina
// no se ejecutaría nunca, en silencio (peor: `typeof` sobre un identificador
// así de inalcanzable no lanza, así que el fallo no habría dado ni un error).
let idsEmpleados = [];
let rutaContratoPropio = null;
let TEXTO_CONTRATO = null;

// `tenant` se resuelve más abajo (la agencia que tenga contratos); estos tres
// usuarios se quedan en ella y el contrato `cOtraAgencia` va en la contraria.
const usuarios = {
  asesor: { correo: `test-asesor-${sello}@ejemplo.invalid`, nombre: `${MARCA} Asesor ${sello}`, rol: "venta", id: null },
  colega: { correo: `test-colega-${sello}@ejemplo.invalid`, nombre: `${MARCA} Colega ${sello}`, rol: "venta", id: null },
  admin: { correo: `test-admin-${sello}@ejemplo.invalid`, nombre: `${MARCA} Admin ${sello}`, rol: "administracion", id: null },
  opera: { correo: `test-opera-${sello}@ejemplo.invalid`, nombre: `${MARCA} Operaciones ${sello}`, rol: "operaciones", id: null },
  gerente: { correo: `test-gerencia-${sello}@ejemplo.invalid`, nombre: `${MARCA} Gerencia ${sello}`, rol: "gerencia", id: null },
  // Mismo rol que `admin`, pero en la OTRA agencia — para el caso "administracion
  // de otro tenant: rechazado" de la carpeta de nómina, sin confundirlo con
  // "operaciones/venta rechazados" que ya cubre el bloque de cruce de arriba.
  adminOtro: { correo: `test-admin-otro-${sello}@ejemplo.invalid`, nombre: `${MARCA} Admin Otro ${sello}`, rol: "administracion", id: null },
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

  // Carpeta de nómina: solo los objetos de ESTA corrida (por el id de los
  // empleados de prueba, que están fuera de la marca de texto).
  if (idsEmpleados.length) {
    const { data, error } = await admin.storage.from(BUCKET).list("pe-empleados");
    if (error) {
      linea(false, "Listar archivos de pe-empleados/", error.message);
    } else {
      const propios = (data ?? [])
        .filter((o) => idsEmpleados.some((id) => o.name.startsWith(`${id}-`)))
        .map((o) => `pe-empleados/${o.name}`);
      if (propios.length) {
        const { error: eRm } = await admin.storage.from(BUCKET).remove(propios);
        linea(!eRm, `Eliminar ${propios.length} archivo(s) de pe-empleados/`, eRm?.message);
      }
    }
    const { error: eEmp } = await admin.from("pe_empleados").delete().in("id", idsEmpleados);
    linea(!eEmp, "Eliminar los empleados de prueba", eEmp?.message);
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

  if (idsEmpleados.length) {
    const { data, error } = await admin.storage.from(BUCKET).list("pe-empleados");
    const quedan = (data ?? [])
      .filter((o) => idsEmpleados.some((id) => o.name.startsWith(`${id}-`)))
      .map((o) => o.name);
    linea(!error && quedan.length === 0, "Sin objetos propios en pe-empleados/",
      error?.message ?? (quedan.length ? `quedan: ${quedan.join(", ")}` : null));

    const { data: emp, error: eEmp } = await admin.from("pe_empleados").select("id").in("id", idsEmpleados);
    linea(!eEmp && (emp ?? []).length === 0, "Sin filas de pe_empleados de prueba",
      eEmp?.message ?? ((emp ?? []).length ? `quedan: ${(emp ?? []).map((e) => e.id).join(", ")}` : null));
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
    // `adminOtro` es administracion de la OTRA agencia; el resto va en `tenant`.
    const tenantDelUsuario = ref === "adminOtro" ? otroTenant : tenant;
    const { error: e2 } = await admin.from("usuarios")
      .update({ nombre: u.nombre, rol: u.rol, activo: true, tenant: tenantDelUsuario })
      .eq("id", u.id);
    if (e2) throw new Error(`No se pudo configurar el perfil de ${ref}: ${e2.message}`);
  }
  console.log(`   asesor/colega/gerente/admin/opera/jefe en '${tenant}', adminOtro en '${otroTenant}'`);

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

  // ── Empleados de nómina (carpeta `pe-empleados/`), uno por agencia ────────
  // `pe_empleados` no tiene el candado de "prueba" por nombre en storage —el
  // aislamiento sale del `id` del empleado, no de la marca— así que se anotan
  // los dos ids para poder limpiarlos explícitamente.
  const nombreEmpleadoPropio = `${MARCA} Empleado ${sello}`;
  const nombreEmpleadoOtro = `${MARCA} Empleado Otro ${sello}`;
  const { data: empPropio, error: eEmp1 } = await admin
    .from("pe_empleados")
    .insert({ nombre: nombreEmpleadoPropio, tenant, salario: 1 })
    .select("id")
    .single();
  if (eEmp1) throw new Error(`No se pudo crear el empleado propio: ${eEmp1.message}`);
  const { data: empOtro, error: eEmp2 } = await admin
    .from("pe_empleados")
    .insert({ nombre: nombreEmpleadoOtro, tenant: otroTenant, salario: 1 })
    .select("id")
    .single();
  if (eEmp2) throw new Error(`No se pudo crear el empleado de la otra agencia: ${eEmp2.message}`);
  idsEmpleados = [empPropio.id, empOtro.id];
  console.log(`   empleado propio #${empPropio.id} (${tenant}) y de la otra agencia #${empOtro.id} (${otroTenant})`);

  rutaContratoPropio = `pe-empleados/${empPropio.id}-contrato.txt`;
  TEXTO_CONTRATO = `contrato laboral original, empleado ${empPropio.id}, ${sello}`;
  const { error: eSubEmp } = await admin.storage.from(BUCKET)
    .upload(rutaContratoPropio, new Blob([TEXTO_CONTRATO], { type: "text/plain" }), { upsert: true });
  if (eSubEmp) throw new Error(`No se pudo sembrar el contrato laboral: ${eSubEmp.message}`);
  await admin.from("pe_empleados").update({ contrato_path: rutaContratoPropio }).eq("id", empPropio.id);
  console.log(`   contrato laboral sembrado en ${rutaContratoPropio}`);

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

  // ── CARPETA DE NÓMINA (`pe-empleados/`) ───────────────────────────────────
  // Mismo criterio que la RLS de `pe_empleados`: solo `gerencia`/`administracion`
  // DE LA AGENCIA DEL EMPLEADO, y `superadmin` siempre. `operaciones` y `venta`
  // pueden tocar adjuntos de CONTRATO en este mismo bucket (comprobado arriba)
  // pero NO nómina — son carpetas distintas con reglas distintas, y por eso se
  // prueban aparte en vez de asumir que "ya se probó el bucket".
  console.log("\n== NÓMINA — pe-empleados/ del empleado propio (tenant '" + tenant + "')");

  const permitidosNomina = [
    ["gerente", "gerencia (misma agencia)"],
    ["admin", "administracion (misma agencia)"],
  ];
  const rechazadosNomina = [
    ["adminOtro", "administracion (OTRA agencia)"],
    ["opera", "operaciones (misma agencia)"],
    ["asesor", "venta (misma agencia)"],
  ];

  for (const [ref, etiqueta] of permitidosNomina) {
    const cli = await sesion(usuarios[ref]);
    const stN = cli.storage.from(BUCKET);
    const rutaPropiaDelRol = `pe-empleados/${empPropio.id}-por-${ref}.txt`;

    let x = await intentar(() => stN.list("pe-empleados"));
    linea(x.ok && listaIncluye(x.data, rutaContratoPropio), `${etiqueta}: LISTA la carpeta pe-empleados/`,
      x.detalle ?? (x.ok ? "respondió sin error pero no listó el contrato" : null));

    x = await intentar(() => stN.createSignedUrl(rutaContratoPropio, 60));
    linea(x.ok, `${etiqueta}: FIRMA URL del contrato laboral`, x.detalle);

    x = await intentar(() => stN.upload(rutaPropiaDelRol, archivo, { upsert: false }));
    linea(x.ok, `${etiqueta}: SUBE un contrato laboral`, x.detalle);

    x = await intentar(() => stN.upload(rutaPropiaDelRol, new Blob(["reemplazado"]), { upsert: true }));
    linea(x.ok, `${etiqueta}: REEMPLAZA lo que subió`, x.detalle);

    x = await intentar(() => stN.remove([rutaPropiaDelRol]));
    const borro = x.ok && listaIncluye(x.data, rutaPropiaDelRol);
    linea(borro, `${etiqueta}: ELIMINA lo que subió`, x.detalle ?? (x.ok ? "la API no lo listó como eliminado" : null));

    await cli.auth.signOut();
  }

  console.log("\n== NÓMINA — las mismas cinco deben ser RECHAZADAS para estos roles");

  for (const [ref, etiqueta] of rechazadosNomina) {
    const cli = await sesion(usuarios[ref]);
    const stN = cli.storage.from(BUCKET);
    const rutaIntrusaNomina = `pe-empleados/${empPropio.id}-intruso-${ref}.txt`;

    let x = await intentar(() => stN.list("pe-empleados"));
    const vio = x.ok && listaIncluye(x.data, rutaContratoPropio);
    linea(!vio, `${etiqueta}: LISTAR pe-empleados/ debe fallar o venir vacía`,
      x.detalle ?? (vio ? "no falló: listó el contrato laboral" : null));

    x = await intentar(() => stN.createSignedUrl(rutaContratoPropio, 60));
    linea(!x.ok, `${etiqueta}: FIRMAR URL del contrato laboral debe fallar`,
      x.detalle ?? "no falló: entregó una URL firmada");

    x = await intentar(() => stN.upload(rutaIntrusaNomina, archivo, { upsert: false }));
    linea(!x.ok, `${etiqueta}: SUBIR un contrato laboral debe fallar`,
      x.detalle ?? "no falló: la subida fue aceptada");

    x = await intentar(() => stN.upload(rutaContratoPropio, new Blob(["pisado"]), { upsert: true }));
    linea(!x.ok, `${etiqueta}: REEMPLAZAR el contrato laboral debe fallar`,
      x.detalle ?? "no falló: lo sobrescribió");

    x = await intentar(() => stN.remove([rutaContratoPropio]));
    const borro = x.ok && listaIncluye(x.data, rutaContratoPropio);
    linea(!borro, `${etiqueta}: ELIMINAR el contrato laboral debe fallar`,
      x.detalle ?? (borro ? "no falló: lo eliminó" : "la API respondió sin error pero no eliminó nada"));

    await cli.auth.signOut();
  }

  // Verificación independiente con service-role: el archivo sigue existiendo
  // Y su CONTENIDO no cambió (un reemplazo con upsert no deja error visible).
  {
    const { data: lista } = await admin.storage.from(BUCKET).list("pe-empleados");
    const nombres = (lista ?? []).map((o) => o.name);
    const nombreEsperado = rutaContratoPropio.split("/")[1];

    linea(nombres.includes(nombreEsperado), "El contrato laboral sigue existiendo",
      nombres.includes(nombreEsperado) ? null : "DESAPARECIÓ: algún intento de borrado cruzado surtió efecto");

    const colados = nombres.filter((n) => n.includes("intruso"));
    linea(colados.length === 0, "No quedó ningún archivo colado en pe-empleados/",
      colados.length ? `quedaron: ${colados.join(", ")}` : null);

    const { data: blob, error: eDl } = await admin.storage.from(BUCKET).download(rutaContratoPropio);
    if (eDl) {
      linea(false, "El CONTENIDO del contrato laboral no cambió", `no se pudo descargar: ${eDl.message}`);
    } else {
      const texto = await blob.text();
      linea(texto === TEXTO_CONTRATO, "El CONTENIDO del contrato laboral no cambió",
        texto === TEXTO_CONTRATO ? null : `fue sobrescrito: "${texto.slice(0, 60)}"`);
    }
  }

  // ── superadmin también en nómina ──────────────────────────────────────────
  console.log("\n== NÓMINA — superadmin sí puede, siempre");
  const jefeNomina = await sesion(usuarios.jefe);
  const stJefeNomina = jefeNomina.storage.from(BUCKET);
  const rutaJefeNomina = `pe-empleados/${empOtro.id}-por-jefe.txt`;

  r = await intentar(() => stJefeNomina.createSignedUrl(rutaContratoPropio, 60));
  linea(r.ok, "superadmin FIRMA URL de un contrato laboral", r.detalle);

  r = await intentar(() => stJefeNomina.upload(rutaJefeNomina, archivo, { upsert: false }));
  linea(r.ok, "superadmin SUBE un contrato laboral (en la carpeta del empleado de la otra agencia)", r.detalle);

  r = await intentar(() => stJefeNomina.remove([rutaJefeNomina]));
  const borroJefeNomina = r.ok && listaIncluye(r.data, rutaJefeNomina);
  linea(borroJefeNomina, "superadmin ELIMINA lo que subió", r.detalle ?? (r.ok ? "la API no lo listó como eliminado" : null));

  await jefeNomina.auth.signOut();
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
