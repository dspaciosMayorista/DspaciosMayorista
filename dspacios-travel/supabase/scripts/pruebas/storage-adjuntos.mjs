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
 *   aquí, contra el Storage real y con un usuario real.
 *
 * QUÉ COMPRUEBA
 *   · Un asesor (`venta`) puede subir, leer, reemplazar y eliminar archivos de
 *     SU contrato.
 *   · NO puede hacer ninguna de las cuatro en el contrato de un colega, y el
 *     archivo ajeno sigue intacto después de intentarlo.
 *   · Un rol administrativo sí puede en ambos.
 *
 * ⚠️ ESCRIBE EN LA BASE REAL. Crea dos usuarios y dos contratos temporales,
 *   todos con el prefijo `__TEST_STORAGE__`, y los borra al terminar — también
 *   si algo falla a mitad. Por eso exige `--confirmar`.
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
const correoAsesor = `test-asesor-${sello}@ejemplo.invalid`;
const correoColega = `test-colega-${sello}@ejemplo.invalid`;
const clave = `Pr#${sello}-x9`;
const nombreAsesor = `${MARCA} Asesor ${sello}`;
const nombreColega = `${MARCA} Colega ${sello}`;
const archivo = new Blob(["contenido de prueba, sin datos personales"], { type: "text/plain" });

let idAsesor = null, idColega = null;

async function limpiar() {
  console.log("\n== Limpieza");
  for (const c of [cPropio, cAjeno]) {
    const { data } = await admin.storage.from(BUCKET).list(c);
    if (data?.length) {
      const paths = data.map((o) => `${c}/${o.name}`);
      const { error } = await admin.storage.from(BUCKET).remove(paths);
      console.log(`   archivos de ${c}: ${error ? `ERROR ${error.message}` : `${paths.length} eliminados`}`);
    }
    const { error } = await admin.from("ventas").delete().eq("numero_contrato", c);
    if (error) console.log(`   contrato ${c}: ERROR ${error.message}`);
  }
  for (const id of [idAsesor, idColega]) {
    if (!id) continue;
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log(`   usuario ${id}: ERROR ${error.message}`);
  }
  console.log("   listo");
}

try {
  // ── Fixtures ──────────────────────────────────────────────────────────────
  console.log("== Fixtures temporales");

  // Tenant con contratos, para que `puede_ver_tenant` no deje la prueba vacía.
  const { data: unaVenta } = await admin.from("ventas").select("tenant").limit(1).maybeSingle();
  const tenant = unaVenta?.tenant ?? "mayorista";

  for (const [correo, nombre, ref] of [[correoAsesor, nombreAsesor, "asesor"], [correoColega, nombreColega, "colega"]]) {
    const { data, error } = await admin.auth.admin.createUser({ email: correo, password: clave, email_confirm: true });
    if (error) throw new Error(`No se pudo crear el usuario ${ref}: ${error.message}`);
    const id = data.user.id;
    if (ref === "asesor") idAsesor = id; else idColega = id;
    const { error: e2 } = await admin.from("usuarios").update({ nombre, rol: "venta", activo: true, tenant }).eq("id", id);
    if (e2) throw new Error(`No se pudo configurar el perfil de ${ref}: ${e2.message}`);
  }
  console.log(`   dos usuarios 'venta' en el tenant '${tenant}'`);

  const { error: eV } = await admin.from("ventas").insert([
    { numero_contrato: cPropio, cliente: "CLIENTE PRUEBA", tenant, asesor: nombreAsesor, precio_venta: 1000 },
    { numero_contrato: cAjeno, cliente: "CLIENTE PRUEBA", tenant, asesor: nombreColega, precio_venta: 2000 },
  ]);
  if (eV) throw new Error(`No se pudieron crear los contratos: ${eV.message}`);
  console.log(`   contrato propio ${cPropio} y ajeno ${cAjeno}`);

  const rutaAjena = `${cAjeno}/cedula-ajena.txt`;
  const { error: eSub } = await admin.storage.from(BUCKET).upload(rutaAjena, archivo, { upsert: true });
  if (eSub) throw new Error(`No se pudo sembrar el archivo ajeno: ${eSub.message}`);
  console.log(`   archivo ajeno sembrado en ${rutaAjena}`);

  // ── Sesión del asesor ─────────────────────────────────────────────────────
  const asesor = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: eLogin } = await asesor.auth.signInWithPassword({ email: correoAsesor, password: clave });
  if (eLogin) throw new Error(`No se pudo iniciar sesión como el asesor: ${eLogin.message}`);

  const st = asesor.storage.from(BUCKET);
  const rutaPropia = `${cPropio}/cedula-propia.txt`;

  // ── Contrato PROPIO: las cuatro deben funcionar ───────────────────────────
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

  const { data: quedaPropio } = await admin.storage.from(BUCKET).list(cPropio);
  linea((quedaPropio ?? []).length === 0, "…y el archivo propio ya no está en el bucket",
    (quedaPropio ?? []).length ? `siguen: ${(quedaPropio ?? []).map((o) => o.name).join(", ")}` : null);

  // ── Contrato AJENO: las cuatro deben ser rechazadas ───────────────────────
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

  // La comprobación que de verdad importa: con service-role, ¿sigue el archivo?
  const { data: listaAjena } = await admin.storage.from(BUCKET).list(cAjeno);
  const sigueAjeno = (listaAjena ?? []).some((o) => o.name === "cedula-ajena.txt");
  linea(sigueAjeno, "El archivo ajeno sigue intacto tras los cuatro intentos",
    sigueAjeno ? null : "DESAPARECIÓ: alguna de las operaciones sí surtió efecto");

  const intruso = (listaAjena ?? []).some((o) => o.name === "intruso.txt");
  linea(!intruso, "No quedó ningún archivo colado en el contrato ajeno",
    intruso ? "quedó 'intruso.txt': la subida ajena sí pasó" : null);

  // ── Rol administrativo ────────────────────────────────────────────────────
  console.log("\n== Rol administrativo — debe poder en ambos (si no, la prueba pasaría cerrándolo todo)");
  r = await intentar(() => admin.storage.from(BUCKET).createSignedUrl(rutaAjena, 60));
  linea(r.ok, "Un cliente con service-role lee el adjunto ajeno", r.detalle);

  await asesor.auth.signOut();
} catch (e) {
  console.error(`\n[ERROR] ${e instanceof Error ? e.message : String(e)}`);
  mal++;
} finally {
  await limpiar();
}

console.log(`\nRESULTADO: ${ok} correctas, ${mal} incorrectas`);
process.exit(mal === 0 ? 0 : 1);
