import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  MODALIDADES_EMISION,
  MODALIDAD_LABEL,
  MODALIDAD_CONTROL_LABEL,
  esModalidadEmision,
  labelModalidad,
  labelModalidadControl,
  tonoModalidad,
  tonoModalidadControl,
} from "../lib/vuelos/control.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

// ───────────────────────────────────────────────────────────────────────────
// PR A — modalidad serie/grupo/sistema + inventario de Empaquetados
// (migraciones 155/156). Estas pruebas cubren lo que las de
// pruebas/vuelosControl.test.ts (migración 152) no cubrían: el rename en sí,
// el pseudo-valor "sistema" SOLO para la vista fusionada de Control Vuelos,
// y el wiring de la tabla/acciones nuevas.
// ───────────────────────────────────────────────────────────────────────────

test("MODALIDADES_EMISION es exactamente [serie, grupo] — 'sistema' nunca es un valor real de la columna", () => {
  assert.deepEqual(MODALIDADES_EMISION, ["serie", "grupo"]);
  assert.deepEqual(Object.keys(MODALIDAD_LABEL).sort(), ["grupo", "serie"]);
});

test("labelModalidadControl/tonoModalidadControl: 'sistema' es un pseudo-valor SOLO de la vista fusionada", () => {
  assert.equal(labelModalidadControl("sistema"), "Sistema");
  assert.equal(MODALIDAD_CONTROL_LABEL.sistema, "Sistema");
  assert.equal(tonoModalidadControl("sistema"), "info");
  // Para serie/grupo/null, labelModalidadControl debe coincidir exactamente
  // con labelModalidad/tonoModalidad (mismo criterio, sin duplicar reglas).
  assert.equal(labelModalidadControl("serie"), labelModalidad("serie"));
  assert.equal(labelModalidadControl("grupo"), labelModalidad("grupo"));
  assert.equal(labelModalidadControl(null), labelModalidad(null));
  assert.equal(tonoModalidadControl("grupo"), tonoModalidad("grupo"));
  assert.equal(tonoModalidadControl(null), tonoModalidad(null));
});

test("esModalidadEmision sigue sin aceptar 'sistema' — esa columna (bloqueos_vuelo) nunca es Sistema por definición", () => {
  assert.equal(esModalidadEmision("sistema"), false);
});

// ───────────────────────────────────────────────────────────────────────────
// Migración 155 (rename individual → serie)
// ───────────────────────────────────────────────────────────────────────────
const mig155 = leer("supabase/migrations/20260601000155_modalidad_emision_serie.sql");

test("migración 155: corre en una transacción explícita y renombra SOLO 'individual', nunca null/'grupo'", () => {
  assert.match(mig155, /^begin;/m, "no empieza con begin; explícito");
  assert.match(mig155, /^commit;/m, "no termina con commit; explícito");
  assert.match(
    mig155,
    /update public\.bloqueos_vuelo\s*\n\s*set modalidad_emision = 'serie'\s*\n\s*where modalidad_emision = 'individual';/,
    "el UPDATE de rename no tiene exactamente esta forma (solo 'individual' → 'serie')"
  );
  assert.match(mig155, /check \(modalidad_emision in \('serie', 'grupo'\)\)/, "el CHECK nuevo no es exactamente serie/grupo");
});

test("migración 155: reemplaza el RPC actualizar_control_bloqueo con el dominio serie/grupo (si no, guardar 'serie' desde el formulario fallaría)", () => {
  const inicio = mig155.indexOf("create or replace function public.actualizar_control_bloqueo");
  assert.notEqual(inicio, -1, "la 155 no reemplaza el RPC — guardar 'serie' desde Control seguiría rechazado por el dominio viejo");
  const fin = mig155.indexOf("comment on function public.actualizar_control_bloqueo", inicio);
  const fn = mig155.slice(inicio, fin > inicio ? fin : undefined);
  assert.match(fn, /p_modalidad_emision not in \('serie', 'grupo'\)/, "el RPC sigue validando contra individual/grupo");
  assert.doesNotMatch(fn, /'individual'/, "el RPC todavía menciona 'individual' en algún lado (validación o etiqueta del historial)");
});

test("migración 155: verifica al final que no quede ninguna fila en 'individual' ni fuera de serie/grupo/null — aborta si no cuadra", () => {
  assert.match(mig155, /raise exception '155 FALLÓ/);
  assert.match(mig155, /modalidad_emision = 'individual'/);
});

const rollback155 = leer("supabase/scripts/rollback_155_modalidad_emision_serie.sql");
test("rollback 155: transaccional, revierte serie→individual Y restaura el RPC viejo", () => {
  assert.match(rollback155, /^begin;/m);
  assert.match(rollback155, /^commit;/m);
  assert.match(rollback155, /set modalidad_emision = 'individual'\s*\n\s*where modalidad_emision = 'serie';/);
  assert.match(rollback155, /p_modalidad_emision not in \('individual', 'grupo'\)/, "el rollback no restaura el dominio viejo del RPC");
});

// ───────────────────────────────────────────────────────────────────────────
// Migración 156 (tabla empaquetados + armado_empaquetados)
// ───────────────────────────────────────────────────────────────────────────
const mig156 = leer("supabase/migrations/20260601000156_empaquetados.sql");

test("migración 156: 'empaquetados' NO tiene paquete_id propio — puede existir antes de vincularse a un paquete", () => {
  const inicio = mig156.indexOf("create table if not exists public.empaquetados");
  const fin = mig156.indexOf("create table if not exists public.armado_empaquetados");
  const bloque = mig156.slice(inicio, fin);
  assert.doesNotMatch(bloque, /paquete_id/, "empaquetados no debe tener columna paquete_id — el vínculo vive en armado_empaquetados");
  assert.match(bloque, /record\s+text,/, "record debe ser nullable (sin 'not null')");
  assert.match(bloque, /fecha_ida\s+date not null/, "fecha_ida sí debe ser obligatoria");
});

test("migración 156: armado_empaquetados es una tabla de enlace N:M con PK compuesta, igual patrón que armado_vuelos", () => {
  const inicio = mig156.indexOf("create table if not exists public.armado_empaquetados");
  const fin = mig156.indexOf("create index", inicio);
  const bloque = mig156.slice(inicio, fin);
  assert.match(bloque, /paquete_id\s+bigint not null references public\.armado_paquetes\(id\) on delete cascade/);
  assert.match(bloque, /empaquetado_id\s+bigint not null references public\.empaquetados\(id\) on delete cascade/);
  assert.match(bloque, /primary key \(paquete_id, empaquetado_id\)/);
});

test("migración 156: estado_emision/estado_pago sin default (null = 'Por confirmar', mismo criterio que la 152)", () => {
  assert.doesNotMatch(mig156, /estado_emision\s+text\s+default/i);
  assert.doesNotMatch(mig156, /estado_pago\s+text\s+default/i);
  assert.match(mig156, /check \(estado_emision in \('pendiente', 'emitido'\)\)/);
  assert.match(mig156, /check \(estado_pago in \('pendiente', 'pagado'\)\)/);
});

test("migración 156: RLS habilitado en ambas tablas, lectura de empaquetados incluye 'venta' (igual que bloqueos_vuelo)", () => {
  assert.match(mig156, /alter table public\.empaquetados\s+enable row level security;/);
  assert.match(mig156, /alter table public\.armado_empaquetados\s+enable row level security;/);
  const lectura = mig156.slice(mig156.indexOf('"empaquetados: lectura operativa"\n  on public.empaquetados for select'));
  assert.match(lectura.slice(0, 300), /'superadmin','gerencia','administracion','operaciones','venta','control_vuelo'/);
});

test("migración 156 y su rollback corren en transacción explícita", () => {
  assert.match(mig156, /^begin;/m);
  assert.match(mig156, /^commit;/m);
  const rollback156 = leer("supabase/scripts/rollback_156_empaquetados.sql");
  assert.match(rollback156, /^begin;/m);
  assert.match(rollback156, /^commit;/m);
  assert.match(rollback156, /drop table if exists public\.armado_empaquetados;/);
  assert.match(rollback156, /drop table if exists public\.empaquetados;/);
});

// ───────────────────────────────────────────────────────────────────────────
// Código de aplicación — empaquetados-actions.ts
// ───────────────────────────────────────────────────────────────────────────
const empActionsSrc = leer("app/(dashboard)/dashboard/vuelos/empaquetados-actions.ts");

test("crearEmpaquetado exige fecha_ida pero NO exige record (el PNR se agrega después)", () => {
  const fn = empActionsSrc.slice(
    empActionsSrc.indexOf("export async function crearEmpaquetado"),
    empActionsSrc.indexOf("export async function actualizarEmpaquetado")
  );
  assert.match(fn, /if \(!input\.fechaIda\)/, "no exige fecha_ida");
  assert.doesNotMatch(fn, /if \(!input\.record/, "no debe exigir record — es opcional a propósito");
});

test("empaquetados-actions.ts nunca toca la tabla sillas — un empaquetado no representa cupo negociado", () => {
  assert.doesNotMatch(empActionsSrc, /\.from\(\s*"sillas"\s*\)/, "empaquetados-actions.ts no debe crear/tocar sillas en ningún punto");
});

test("eliminarEmpaquetado borra la fila (ON DELETE CASCADE de armado_empaquetados limpia los vínculos solo)", () => {
  const fn = empActionsSrc.slice(empActionsSrc.indexOf("export async function eliminarEmpaquetado"));
  assert.match(fn, /\.from\(\s*"empaquetados"\s*\)\.delete\(\)/);
});

test("setEmpaquetado/setTodosEmpaquetados escriben en armado_empaquetados con upsert por PK compuesta (nunca duplican la fila de empaquetados)", () => {
  assert.match(empActionsSrc, /export async function setEmpaquetado/);
  assert.match(empActionsSrc, /export async function setTodosEmpaquetados/);
  const bloque = empActionsSrc.slice(empActionsSrc.indexOf("export async function setEmpaquetado"));
  assert.match(bloque, /onConflict:\s*"paquete_id,empaquetado_id"/);
});

// ───────────────────────────────────────────────────────────────────────────
// Vista fusionada de Control Vuelos — clave discriminada
// ───────────────────────────────────────────────────────────────────────────
const controlTablaSrc = leer("app/(dashboard)/dashboard/vuelos/ControlVuelosTabla.tsx");
const vuelosPageSrc = leer("app/(dashboard)/dashboard/vuelos/page.tsx");
const historicoPageSrc = leer("app/(dashboard)/dashboard/vuelos/historico/page.tsx");

test("ControlVuelosTabla usa una clave discriminada (bloqueo:id / sistema:id), nunca un id numérico crudo compartido", () => {
  assert.match(controlTablaSrc, /id:\s*string;/, "ControlFila.id debe ser string (clave discriminada), no number");
  assert.match(controlTablaSrc, /origen:\s*ControlOrigen;/);
  assert.match(controlTablaSrc, /numericId:\s*number;/);
  assert.match(controlTablaSrc, /hrefDetalle/, "no hay una función que decida el link según el origen de la fila");
});

for (const [nombre, src] of [["page.tsx", vuelosPageSrc], ["historico/page.tsx", historicoPageSrc]] as const) {
  test(`${nombre}: las filas de Control Vuelos se arman con clave discriminada bloqueo:/sistema:, nunca mezclando ids crudos`, () => {
    assert.match(src, /id:\s*`bloqueo:\$\{b\.id\}`/, `${nombre} no arma la clave discriminada para bloqueos`);
    assert.match(src, /id:\s*`sistema:\$\{e\.id\}`/, `${nombre} no arma la clave discriminada para empaquetados`);
    assert.match(src, /modalidad:\s*"sistema" as ModalidadControl/, `${nombre} no fija la modalidad "sistema" para las filas de empaquetados`);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// VistaTabs — tercera pestaña EMPAQUETADOS
// ───────────────────────────────────────────────────────────────────────────
const vistaTabsSrc = leer("app/(dashboard)/dashboard/vuelos/VistaTabs.tsx");

test("VistaTabs: Inventario | EMPAQUETADOS | CONTROL VUELOS en ese orden, con fallback determinista", () => {
  const idxInv = vistaTabsSrc.indexOf(">Inventario<");
  const idxEmp = vistaTabsSrc.indexOf(">EMPAQUETADOS<");
  const idxCtl = vistaTabsSrc.indexOf(">CONTROL VUELOS<");
  assert.ok(idxInv !== -1 && idxEmp !== -1 && idxCtl !== -1, "faltan una o más pestañas");
  assert.ok(idxInv < idxEmp && idxEmp < idxCtl, "el orden de las pestañas no es Inventario | EMPAQUETADOS | CONTROL VUELOS");
  assert.match(vistaTabsSrc, /vistaDeParam[\s\S]*"empaquetados"/, "vistaDeParam no reconoce 'empaquetados'");
});

// ───────────────────────────────────────────────────────────────────────────
// Armado de paquetes — sección de vuelos por Sistema
// ───────────────────────────────────────────────────────────────────────────
const armadoClientSrc = leer("app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx");

test("ArmadoClient: la sección de Empaquetados usa setEmpaquetado/armado_empaquetados, nunca comparte estado con setVuelo/armado_vuelos", () => {
  assert.match(armadoClientSrc, /import \{ setEmpaquetado, setTodosEmpaquetados \} from "\.\.\/\.\.\/vuelos\/empaquetados-actions";/);
  assert.match(armadoClientSrc, /empaquetadosDisp:\s*Empaquetado\[\];/);
  assert.match(armadoClientSrc, /selEmpaquetados:\s*SelEmpaquetado\[\];/);
  assert.match(armadoClientSrc, /function EmpaquetadoRow/);
});
