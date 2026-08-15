import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  labelModalidad,
  labelEstadoEmision,
  labelEstadoPago,
  esModalidadEmision,
  esEstadoEmision,
  esEstadoPago,
  SIN_DEFINIR,
  POR_CONFIRMAR,
} from "../lib/vuelos/control.ts";

// ───────────────────────────────────────────────────────────────────────────
// Control general por record (migración 151): modalidad de emisión, estado
// de emisión y estado de pago al proveedor/aerolínea.
//
// `null` NO es "pendiente" — un registro de antes de esta migración no tiene
// forma de saber si ya se emitió o se pagó, así que se muestra "Sin definir"/
// "Por confirmar", nunca un estado que afirme algo que no se sabe.
// ───────────────────────────────────────────────────────────────────────────

test("labelModalidad: null/valor desconocido cae en 'Sin definir', nunca inventa un estado", () => {
  assert.equal(labelModalidad(null), SIN_DEFINIR);
  assert.equal(labelModalidad(""), SIN_DEFINIR);
  assert.equal(labelModalidad("lo-que-sea"), SIN_DEFINIR);
  assert.equal(labelModalidad("individual"), "Individual");
  assert.equal(labelModalidad("grupo"), "Grupo");
});

test("labelEstadoEmision/labelEstadoPago: null cae en 'Por confirmar', no en 'Pendiente'", () => {
  // Este es el bug que la migración 151 evita explícitamente: un registro
  // legacy (null) no debe leerse igual que uno que YA se sabe que está
  // pendiente.
  assert.equal(labelEstadoEmision(null), POR_CONFIRMAR);
  assert.notEqual(labelEstadoEmision(null), "Pendiente");
  assert.equal(labelEstadoPago(null), POR_CONFIRMAR);
  assert.notEqual(labelEstadoPago(null), "Pendiente");

  assert.equal(labelEstadoEmision("pendiente"), "Pendiente");
  assert.equal(labelEstadoEmision("emitido"), "Emitido");
  assert.equal(labelEstadoPago("pendiente"), "Pendiente");
  assert.equal(labelEstadoPago("pagado"), "Pagado");
});

test("los type guards solo aceptan los valores exactos del enum", () => {
  assert.equal(esModalidadEmision("individual"), true);
  assert.equal(esModalidadEmision("grupo"), true);
  assert.equal(esModalidadEmision("Individual"), false); // sensible a mayúsculas: la normalización va antes
  assert.equal(esModalidadEmision(null), false);
  assert.equal(esModalidadEmision(undefined), false);

  assert.equal(esEstadoEmision("pendiente"), true);
  assert.equal(esEstadoEmision("emitido"), true);
  assert.equal(esEstadoEmision("pagado"), false); // valor de OTRO enum, no debe colarse

  assert.equal(esEstadoPago("pendiente"), true);
  assert.equal(esEstadoPago("pagado"), true);
  assert.equal(esEstadoPago("emitido"), false); // idem, cruzado
});

// ───────────────────────────────────────────────────────────────────────────
// GUARDA DE WIRING — el resto de la lógica vive en Server Actions
// ("use server") que necesitan una sesión/BD real para probarse de punta a
// punta; estas comprobaciones miran el CÓDIGO FUENTE para blindar las
// decisiones de diseño que motivaron la migración 151 y que un cambio futuro
// podría deshacer sin darse cuenta.
// ───────────────────────────────────────────────────────────────────────────
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const actionsSrc = leer("app/(dashboard)/dashboard/vuelos/actions.ts");

test("crearBloqueo exige modalidad de emisión y arranca los dos estados en 'pendiente'", () => {
  const fn = actionsSrc.slice(
    actionsSrc.indexOf("export async function crearBloqueo"),
    actionsSrc.indexOf("export type BloqueoEditInput")
  );
  assert.match(fn, /esModalidadEmision\(input\.modalidadEmision\)/, "no valida la modalidad al crear");
  assert.match(fn, /modalidad_emision:\s*input\.modalidadEmision/, "no guarda la modalidad elegida");
  assert.match(fn, /estado_emision:\s*"pendiente"/, "el bloqueo nuevo no arranca 'pendiente' en emisión");
  assert.match(fn, /estado_pago:\s*"pendiente"/, "el bloqueo nuevo no arranca 'pendiente' en pago");
});

test("BloqueoEditInput (editar bloqueo general) NO incluye modalidad: ese campo solo se toca desde Control", () => {
  assert.match(
    actionsSrc,
    /export type BloqueoEditInput = Omit<BloqueoInput, "cuposTotal" \| "modalidadEmision">;/,
    "el formulario general de editar bloqueo volvió a incluir modalidadEmision — debe editarse solo por actualizarControlBloqueo, con su propio log en bloqueo_cambios"
  );
});

test("actualizarControlBloqueo valida los tres campos, registra el cambio y NO recalcula tarifarios", () => {
  const inicio = actionsSrc.indexOf("export async function actualizarControlBloqueo");
  assert.notEqual(inicio, -1, "actualizarControlBloqueo ya no existe");
  const fin = actionsSrc.indexOf("\n// ── Carga masiva de bloqueos");
  const fn = actionsSrc.slice(inicio, fin > inicio ? fin : undefined);

  assert.match(fn, /esModalidadEmision\(input\.modalidadEmision\)/, "no valida modalidad");
  assert.match(fn, /esEstadoEmision\(input\.estadoEmision\)/, "no valida estado de emisión");
  assert.match(fn, /esEstadoPago\(input\.estadoPago\)/, "no valida estado de pago");
  assert.match(fn, /\.from\("bloqueo_cambios"\)\.insert\(/, "no registra el cambio en bloqueo_cambios");
  assert.doesNotMatch(
    fn,
    /regenerarTarifariosDeBloqueo/,
    "modalidad/emisión/pago no deben disparar un recálculo de tarifarios — son control operativo, no tarifa ni fechas"
  );
});

test("cargarBloqueosMasivo exige modalidad_emision por fila y valida estado_emision/estado_pago", () => {
  const fn = actionsSrc.slice(actionsSrc.indexOf("export async function cargarBloqueosMasivo"));
  assert.match(fn, /parseModalidadCSV\(r\.modalidad_emision\)/, "no exige modalidad_emision en la fila CSV");
  assert.match(fn, /if \(!modalidad\)/, "una fila sin modalidad_emision válida debería rechazarse, no colarse");
  assert.match(fn, /parseEstadoEmisionCSV\(r\.estado_emision\)/);
  assert.match(fn, /parseEstadoPagoCSV\(r\.estado_pago\)/);
});

test("los parsers CSV de estado_emision/estado_pago solo defaultean a 'pendiente' cuando la celda viene VACÍA", () => {
  const bloque = actionsSrc.slice(
    actionsSrc.indexOf("function parseEstadoEmisionCSV"),
    actionsSrc.indexOf("export async function cargarBloqueosMasivo")
  );
  // El default vive DETRÁS del chequeo de vacío — si el orden se invirtiera,
  // un valor inválido (typo) se colaría silenciosamente como 'pendiente' en
  // vez de rechazar la fila.
  const idxVacio = bloque.indexOf('if (t === "") return "pendiente";');
  const idxValidacion = bloque.indexOf("esEstadoEmision(t) ? t : null");
  assert.notEqual(idxVacio, -1, "no hay default explícito para celda vacía");
  assert.ok(idxVacio < idxValidacion, "el default de vacío debe ir antes de la validación estricta, no reemplazarla");
});

const notifSrc = leer("lib/notificaciones.ts");

test("la alerta de fecha límite de emisión se apaga si el record ya quedó 'emitido', pero la de devolución no", () => {
  const bloque = notifSrc.slice(notifSrc.indexOf("if (flags.bloqueos)"), notifSrc.indexOf("return secciones;"));
  assert.match(bloque, /estado_emision/, "la consulta ya no trae estado_emision — no puede filtrar por él");
  assert.match(
    bloque,
    /!emitido\s*&&\s*b\.fecha_emision/,
    "la condición de la alerta de emisión debe excluir explícitamente los records marcados 'emitido'"
  );
  // La línea que CALCULA alertaDevolucion (no comentarios ni otras líneas
  // alrededor) no debe mencionar "emitido": esa alerta tiene que seguir
  // dependiendo solo de la fecha, igual que antes de esta migración.
  const lineaDevolucion = bloque.split("\n").find((l) => l.includes("alertaDevolucion ="));
  assert.ok(lineaDevolucion, "no se encontró la línea que calcula alertaDevolucion");
  assert.doesNotMatch(
    lineaDevolucion!,
    /emitido/,
    "estado_emision se coló en la condición de devolución: esa alerta debe conservarse tal cual estaba"
  );
});

const migracionSrc = leer("supabase/migrations/20260601000151_bloqueo_control_emision.sql");

test("migración 151: las columnas nuevas no nacen con default — un registro viejo no puede quedar falsamente 'pendiente'", () => {
  const bloque = migracionSrc.slice(
    migracionSrc.indexOf("alter table public.bloqueos_vuelo\n  add column"),
    migracionSrc.indexOf("do $$")
  );
  assert.doesNotMatch(
    bloque,
    /default\s+'pendiente'/i,
    "un DEFAULT 'pendiente' en la columna aplicaría también a las filas existentes (ADD COLUMN ... DEFAULT no es solo para inserts nuevos)"
  );
  assert.doesNotMatch(bloque, /default\s+'individual'|default\s+'grupo'/i, "modalidad_emision no debe tener default");
});
