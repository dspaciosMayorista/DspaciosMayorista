// Fases C y E (migraciones de número provisional, fuera del PR de código), diseño
// docs/futuro/traslado-cupos-y-mover-pasajero.md §6.5 y §6.8. La base
// rechaza a la sesión (rol `authenticated`) cualquier INSERT/DELETE de
// sillas o records, cambiar cupos_total, y cualquier columna de sillas que no
// sea dato del pasajero en una silla SIN contrato; y a todos, la edición o
// borrado del historial. Esta guarda de cableado fija que el código ya no
// depende de nada de eso, para que activar C y E no rompa un escritor
// legítimo. (El comportamiento de la base lo prueban las baterías SQL de
// las fases C y E, que se entregan junto con sus migraciones.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");
function fuentes(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(join(raiz, dir))) {
    const rel = join(dir, nombre);
    if (statSync(join(raiz, rel)).isDirectory()) salida.push(...fuentes(rel));
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(rel.replaceAll("\\", "/"));
  }
  return salida;
}
const ARCHIVOS = ["app", "components", "lib"].flatMap(fuentes);
const VUELOS = "app/(dashboard)/dashboard/vuelos/actions.ts";
const vuelos = leer(VUELOS);
function cuerpo(src: string, firma: string): string {
  const i = src.indexOf(firma);
  assert.ok(i >= 0, firma);
  const j = src.indexOf("\nexport ", i + firma.length);
  return src.slice(i, j < 0 ? undefined : j);
}
// Objeto literal que sigue a `.update(` (hasta la llave que lo cierra).
function objetosUpdate(src: string, tabla: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`from\\("${tabla}"\\)\\s*\\.update\\(\\{`, "g");
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let i = m.index + m[0].length, nivel = 1;
    const ini = i;
    while (i < src.length && nivel > 0) { if (src[i] === "{") nivel++; else if (src[i] === "}") nivel--; i++; }
    out.push(src.slice(ini, i - 1));
  }
  return out;
}
const claves = (obj: string) => [...obj.matchAll(/^\s*([a-z_]+)\s*:/gm)].map((m) => m[1]);

const DATOS_SILLA = new Set([
  "pasajero_nombres", "pasajero_apellidos", "tipo_doc", "numero_doc", "nacimiento", "asesor", "agencia", "hotel",
  "acomodacion", "plazo", "inf_nombres", "inf_apellidos", "inf_tipo_doc", "inf_numero", "inf_nacimiento",
  "responsable_menor", "updated_at"]);

test("nadie en la app escribe movimientos_silla ni operaciones_vuelo (fase E)", () => {
  const hallazgos = ARCHIVOS.filter((rel) =>
    /from\("(movimientos_silla|operaciones_vuelo)"\)\s*\.(insert|update|upsert|delete)\(/.test(leer(rel)));
  assert.deepEqual(hallazgos, []);
});

test("nadie en la app inserta ni borra sillas o records directamente (fase C)", () => {
  const hallazgos = ARCHIVOS.filter((rel) =>
    /from\("(sillas|bloqueos_vuelo)"\)\s*\.(insert|upsert|delete)\(/.test(leer(rel)));
  assert.deepEqual(hallazgos, []);
});

test("con sesión, sillas solo se actualiza en la carga masiva: datos del pasajero en sillas sin contrato", () => {
  const conSesion = ARCHIVOS.filter((rel) => /\bsb\.from\("sillas"\)\s*\.update\(/.test(leer(rel)));
  assert.deepEqual(conSesion, [VUELOS], "el único UPDATE de sillas con la sesión es el de la carga masiva");
  const c = cuerpo(vuelos, "export async function cargarPasajerosMasivo(");
  const objs = objetosUpdate(c, "sillas");
  assert.equal(objs.length, 1);
  const fuera = claves(objs[0]).filter((k) => !DATOS_SILLA.has(k));
  assert.deepEqual(fuera, [], "solo columnas del grupo D");
  for (const filtro of ['.is("numero_contrato", null)', '.is("contrato_manual", null)', '.is("pasajero_nombres", null)'])
    assert.ok(c.includes(filtro), `elige sillas con ${filtro}`);
});

test("los UPDATE de bloqueos_vuelo con sesión nunca tocan cupos_total ni id", () => {
  const objs = objetosUpdate(vuelos, "bloqueos_vuelo");
  assert.ok(objs.length >= 2, "actualizarBloqueo y registrarCambioOperacional");
  for (const o of objs) {
    const k = claves(o);
    assert.ok(!k.includes("cupos_total") && !k.includes("id"), `update de bloqueos_vuelo sin cupos_total/id: ${k.join(", ")}`);
  }
});

test("las demás escrituras de sillas (copia de datos al reservar, W8) usan el cliente admin, exento hasta la fase D", () => {
  for (const rel of ["app/(dashboard)/dashboard/reservar/actions.ts", "app/(dashboard)/dashboard/contratos/actions.ts"]) {
    const src = leer(rel);
    assert.doesNotMatch(src, /\bsb\.from\("sillas"\)\s*\.update\(/, `${rel}: sin UPDATE de sillas con la sesión`);
    // Migración 201: la copia va DENTRO de la transacción que reserva las
    // sillas (crear_pasajeros_contrato_con_sillas), con admin; nunca un UPDATE
    // suelto ni una copia aparte que deje la silla del contrato vacía entre
    // dos llamadas. Un fallo es el de pasajeros: corta y revierte el contrato.
    assert.doesNotMatch(src, /\.from\("sillas"\)\.update\(/, `${rel}: sin UPDATE suelto de sillas (best-effort)`);
    assert.doesNotMatch(src, /copiar_datos_sillas_contrato/, `${rel}: sin copia aparte de la reserva`);
    assert.match(src, /const \{ data: pasajerosCreados, error: pasajerosErr \} = await admin\.rpc\("crear_pasajeros_contrato_con_sillas"/,
      `${rel}: la reserva y la copia van en la misma RPC transaccional`);
    assert.match(src, /p_datos_pasajeros:/, `${rel}: manda los datos de pasajero para las sillas`);
  }
  // El carrito (varios records) usa la envoltura multi, con una copia por record.
  assert.match(leer("app/(dashboard)/dashboard/reservar/actions.ts"), /admin\.rpc\("crear_pasajeros_contrato_multi_con_sillas"/);
});

test("la edición manual del pasajero manda el contrato que la pantalla mostraba (migración 201)", () => {
  const c = cuerpo(vuelos, "export async function editarPasajeroSilla(");
  assert.match(c, /esperado:\s*\{\s*numero_contrato:\s*visto\.numero_contrato/, "manda el estado esperado a la base");
  assert.match(c, /if \(!visto\) return \{ ok: false/, "sin estado esperado no edita a ciegas");
  assert.match(c, /updated_at: visto\.updated_at/, "y la versión de la silla que mostró la pantalla");
  const pagina = leer("app/(dashboard)/dashboard/vuelos/[id]/page.tsx");
  assert.match(pagina, /contratoVisto=\{\{ numero_contrato: s\.numero_contrato, contrato_manual: contratoManualPorSilla\.get\(s\.id\) \?\? null, updated_at: s\.updated_at \}\}/,
    "la página pasa el contrato orgánico, el manual y la versión que está mostrando");
});

test("Borrar y asignar contrato manual usan SOLO las firmas con versión (las viejas quedan para compatibilidad de despliegue)", () => {
  const borrar = cuerpo(vuelos, "export async function borrarPasajeroSilla(");
  assert.match(borrar, /rpc\("liberar_silla", \{ p_silla_id: sillaId, p_esperado: \{ updated_at: version \} \}\)/);
  const asignar = cuerpo(vuelos, "export async function asignarContratoManual(");
  assert.match(asignar, /rpc\("asignar_contrato_manual", \{ p_silla_id: sillaId, p_referencia: contratoManual, p_esperado: \{ updated_at: version \} \}\)/);
  assert.doesNotMatch(vuelos, /rpc\("liberar_silla", \{ p_silla_id: sillaId \}\)/, "ninguna llamada a la firma vieja sin versión");
  const pagina = leer("app/(dashboard)/dashboard/vuelos/[id]/page.tsx");
  assert.match(pagina, /<SillaContrato [^>]*version=\{s\.updated_at\}[^>]*\/>/, "la celda de contrato recibe la versión de la silla");
  assert.match(leer("app/(dashboard)/dashboard/vuelos/[id]/PasajeroAcciones.tsx"),
    /borrarPasajeroSilla\(sillaId, bloqueoId, contratoVisto\.updated_at\)/, "Borrar manda la versión vista");
});
