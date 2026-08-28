import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  MODALIDADES_EMISION,
  MODALIDAD_LABEL,
  MODALIDAD_CONTROL_LABEL,
  esModalidadEmision,
  normalizarModalidadLegible,
  labelModalidad,
  labelModalidadControl,
  tonoModalidad,
  tonoModalidadControl,
} from "../lib/vuelos/control.ts";
import { aporteVuelo } from "../lib/calc/paquetes.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

// ───────────────────────────────────────────────────────────────────────────
// PR A (+ revisión de PR #268) — modalidad serie/grupo/sistema + inventario
// de Empaquetados (migraciones 155/156/158 — el cierre se renumeró de 157 a
// 158 en la rama `vuelos-empaquetados-editor-contrato`, ver más abajo).
// Estas pruebas cubren lo que
// pruebas/vuelosControl.test.ts (migración 152) no cubría: el rename en sí
// (ahora en dos fases, transitoria + cierre — ver más abajo), el pseudo-valor
// "sistema" SOLO para la vista fusionada de Control Vuelos, y el wiring de
// la tabla/acciones nuevas.
//
// ⚠️ Las pruebas de string/wiring de este archivo (regex contra el código
// fuente) NO son prueba suficiente por sí solas — la revisión de PR #268
// (defecto 9) las señaló explícitamente como insuficientes. Se complementan
// con `supabase/scripts/test_empaquetados.sql` (SQL real: constraints, RLS,
// RPC, atomicidad, falso éxito, borrado vinculado, inactivo futuro — corrido
// contra Postgres de verdad, no inspección de texto) y con las pruebas de
// matemática pura más abajo (aporteVuelo — no doble margen).
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

// ── Ventana de transición 155→158 (defecto 1, revisión de PR #268; cierre renumerado de 157 a 158) ─────────
test("normalizarModalidadLegible: LEE 'individual' como sinónimo de 'serie' (ventana de transición), pero esModalidadEmision (guardián de ESCRITURA) sigue sin aceptarlo", () => {
  assert.equal(normalizarModalidadLegible("individual"), "serie");
  assert.equal(normalizarModalidadLegible("serie"), "serie");
  assert.equal(normalizarModalidadLegible("grupo"), "grupo");
  assert.equal(normalizarModalidadLegible(null), null);
  assert.equal(normalizarModalidadLegible("cualquier-cosa"), null);
  assert.equal(esModalidadEmision("individual"), false, "escribir 'individual' nunca debe ser válido, ni durante la transición");
});

test("labelModalidad/tonoModalidad leen 'individual' exactamente igual que 'serie' (defecto 1: el código nuevo debe leer ambos como Serie)", () => {
  assert.equal(labelModalidad("individual"), labelModalidad("serie"));
  assert.equal(labelModalidad("individual"), "Serie");
  assert.equal(tonoModalidad("individual"), tonoModalidad("serie"));
});

// ───────────────────────────────────────────────────────────────────────────
// Migración 155 — FASE TRANSITORIA (aditiva, revisión de PR #268 defecto 1)
// ───────────────────────────────────────────────────────────────────────────
const mig155 = leer("supabase/migrations/20260601000155_modalidad_emision_serie.sql");

test("migración 155 (transitoria): corre en una transacción explícita, AMPLÍA el CHECK a individual+serie+grupo, y NO TOCA NINGÚN DATO", () => {
  assert.match(mig155, /^begin;/m, "no empieza con begin; explícito");
  assert.match(mig155, /^commit;/m, "no termina con commit; explícito");
  assert.match(
    mig155,
    /check \(modalidad_emision in \('individual', 'serie', 'grupo'\)\)/,
    "el CHECK transitorio debe aceptar los TRES valores — si solo acepta serie/grupo, el código viejo (que aún escribe 'individual') rompe apenas se corre esta migración antes del despliegue"
  );
  assert.doesNotMatch(
    mig155,
    /set modalidad_emision = 'serie'\s*\n\s*where modalidad_emision = 'individual';/,
    "la 155 transitoria NO debe convertir el dato 'individual'→'serie' — eso es responsabilidad exclusiva de la 158 (cierre, renombrada de 157), después del despliegue (el RPC sí contiene un UPDATE, pero es su comportamiento normal en tiempo de ejecución, no una conversión de datos históricos)"
  );
});

test("migración 155 (transitoria): el RPC actualizar_control_bloqueo acepta individual/serie/grupo — el código nuevo (que solo ESCRIBE serie) sigue pudiendo guardar, y el código viejo (que solo conoce individual) también", () => {
  const inicio = mig155.indexOf("create or replace function public.actualizar_control_bloqueo");
  assert.notEqual(inicio, -1, "la 155 no reemplaza el RPC");
  const fin = mig155.indexOf("comment on function public.actualizar_control_bloqueo", inicio);
  const fn = mig155.slice(inicio, fin > inicio ? fin : undefined);
  assert.match(fn, /p_modalidad_emision not in \('individual', 'serie', 'grupo'\)/, "el RPC transitorio debe validar contra los TRES valores");
});

test("migración 155 (transitoria): NO tiene ningún bloque de verificación 'FALLÓ' — no hay nada que verificar en una migración puramente aditiva que no toca datos", () => {
  assert.doesNotMatch(mig155, /raise exception '155 FALLÓ/, "la 155 ya no es la migración que cierra el dominio — ese bloque vive en la 158 (renombrada de 157, ver más abajo)");
});

const rollback155 = leer("supabase/scripts/rollback_155_modalidad_emision_serie.sql");
test("rollback 155 (transitoria): transaccional, CIERRA de vuelta a individual/grupo (deshace la ampliación) — no convierte datos porque la 155 tampoco los tocó", () => {
  assert.match(rollback155, /^begin;/m);
  assert.match(rollback155, /^commit;/m);
  assert.match(rollback155, /check \(modalidad_emision in \('individual', 'grupo'\)\)/, "el rollback debe cerrar el CHECK de vuelta a individual/grupo");
  assert.match(rollback155, /p_modalidad_emision not in \('individual', 'grupo'\)/, "el rollback debe restaurar el dominio viejo del RPC");
});

// ───────────────────────────────────────────────────────────────────────────
// Migración 158 — CIERRE (posterior al despliegue, revisión de PR #268 defecto 1)
// ⚠️ Renumerada de 157 a 158 en la rama `vuelos-empaquetados-editor-contrato`:
// en producción ya corrieron 155/156, así que se le pudo cambiar el número a
// esta (que seguía sin ejecutarse) sin ningún riesgo — el 157 quedó libre
// para una migración nueva y distinta (editor operativo de vuelos del
// contrato, ver el describe "editor operativo de vuelos del contrato" más
// abajo). El contenido de esta migración no cambió, solo el número.
// ───────────────────────────────────────────────────────────────────────────
const mig158 = leer("supabase/migrations/20260601000158_modalidad_emision_serie_cierre.sql");

test("migración 158 (cierre, antes 157): corre en transacción explícita, renombra el 'individual' remanente a 'serie', y CIERRA el CHECK a solo serie/grupo", () => {
  assert.match(mig158, /^begin;/m);
  assert.match(mig158, /^commit;/m);
  assert.match(
    mig158,
    /update public\.bloqueos_vuelo\s*\n\s*set modalidad_emision = 'serie'\s*\n\s*where modalidad_emision = 'individual';/,
    "el UPDATE de cierre no tiene exactamente esta forma (solo 'individual' → 'serie')"
  );
  assert.match(mig158, /check \(modalidad_emision in \('serie', 'grupo'\)\)/, "el CHECK de cierre no es exactamente serie/grupo");
});

test("migración 158 (cierre, antes 157): reemplaza el RPC a solo serie/grupo (cierra el dominio también ahí, no solo en la tabla)", () => {
  const inicio = mig158.indexOf("create or replace function public.actualizar_control_bloqueo");
  assert.notEqual(inicio, -1, "la 158 no reemplaza el RPC");
  const fin = mig158.indexOf("comment on function public.actualizar_control_bloqueo", inicio);
  const fn = mig158.slice(inicio, fin > inicio ? fin : undefined);
  assert.match(fn, /p_modalidad_emision not in \('serie', 'grupo'\)/, "el RPC de cierre sigue validando contra individual/grupo");
  assert.doesNotMatch(fn, /'individual'/, "el RPC de cierre todavía menciona 'individual' en algún lado (validación o etiqueta del historial)");
});

test("migración 158 (cierre, antes 157): verifica al final que no quede ninguna fila en 'individual' ni fuera de serie/grupo/null — aborta si no cuadra", () => {
  assert.match(mig158, /raise exception '158 FALLÓ/);
  assert.match(mig158, /modalidad_emision = 'individual'/);
});

test("migración 158 (cierre, antes 157): el comentario de despliegue advierte NO correrla en el mismo despliegue que la 155/156", () => {
  assert.match(mig158, /NO CORRER en el mismo despliegue/i);
});

const rollback158 = leer("supabase/scripts/rollback_158_modalidad_emision_serie_cierre.sql");
test("rollback 158 (cierre, antes 157): transaccional, REABRE el CHECK/RPC a individual/serie/grupo (misma fase transitoria de la 155)", () => {
  assert.match(rollback158, /^begin;/m);
  assert.match(rollback158, /^commit;/m);
  assert.match(rollback158, /check \(modalidad_emision in \('individual', 'serie', 'grupo'\)\)/);
  assert.match(rollback158, /p_modalidad_emision not in \('individual', 'serie', 'grupo'\)/);
});

// ───────────────────────────────────────────────────────────────────────────
// Migración 156 (tabla empaquetados + armado_empaquetados + CHECKs +
// borrado seguro + historial — revisión de PR #268 defectos 4/6/8)
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

test("migración 156 (defecto 6): CHECK de tarifas/fechas — tarifas>=0, fecha_regreso>=fecha_ida, compra_fin>=compra_inicio", () => {
  assert.match(mig156, /check \(tarifa_proveedor >= 0 and tarifa_para_empaquetar >= 0 and fee_infante >= 0\)/);
  assert.match(mig156, /check \(fecha_regreso is null or fecha_regreso >= fecha_ida\)/);
  assert.match(mig156, /check \(compra_inicio is null or compra_fin is null or compra_fin >= compra_inicio\)/);
});

test("migración 156 (defecto 4): armado_empaquetados.empaquetado_id es ON DELETE RESTRICT (NO cascade) — un empaquetado vinculado no se puede borrar en silencio", () => {
  const inicio = mig156.indexOf("create table if not exists public.armado_empaquetados");
  const fin = mig156.indexOf("create index", inicio);
  const bloque = mig156.slice(inicio, fin);
  assert.match(bloque, /paquete_id\s+bigint not null references public\.armado_paquetes\(id\) on delete cascade/, "paquete_id sí debe seguir en cascade (el paquete es dueño del enlace)");
  assert.match(bloque, /empaquetado_id\s+bigint not null references public\.empaquetados\(id\) on delete restrict/, "empaquetado_id debe ser RESTRICT, no cascade");
  assert.doesNotMatch(bloque, /empaquetado_id\s+bigint not null references public\.empaquetados\(id\) on delete cascade/, "empaquetado_id NO debe ser cascade");
});

test("migración 156 (defecto 8): tabla empaquetado_cambios + RPC actualizar_control_empaquetado, mismo patrón que bloqueo_cambios/actualizar_control_bloqueo (152) — SIN security definer, actor por auth.uid(), UPDATE+INSERT atómico", () => {
  assert.match(mig156, /create table if not exists public\.empaquetado_cambios/);
  const inicio = mig156.indexOf("create or replace function public.actualizar_control_empaquetado");
  assert.notEqual(inicio, -1, "falta el RPC actualizar_control_empaquetado");
  const fin = mig156.indexOf("comment on function public.actualizar_control_empaquetado", inicio);
  const fn = mig156.slice(inicio, fin > inicio ? fin : undefined);
  assert.doesNotMatch(fn, /security definer/i, "el RPC NO debe ser security definer — debe correr con el rol del que llama, sujeto a RLS real");
  assert.match(fn, /for update/i, "falta el SELECT ... FOR UPDATE (bloqueo de fila dentro de la transacción)");
  assert.match(fn, /auth\.uid\(\)/, "el actor debe resolverse con auth.uid(), nunca recibirse como parámetro");
  assert.match(fn, /insert into public\.empaquetado_cambios/, "falta el INSERT del historial dentro de la misma función");
});

test("migración 156 (defecto 7): actualizar_control_empaquetado PRESERVA null en estado_emision/estado_pago — nunca fuerza 'pendiente' cuando el caller no cambia esos campos", () => {
  const inicio = mig156.indexOf("create or replace function public.actualizar_control_empaquetado");
  const fin = mig156.indexOf("comment on function public.actualizar_control_empaquetado", inicio);
  const fn = mig156.slice(inicio, fin > inicio ? fin : undefined);
  // Los parámetros son nullable (a diferencia de actualizar_control_bloqueo,
  // que exige 'pendiente'/'emitido' — aquí NULL es un valor legítimo).
  assert.match(fn, /p_estado_emision is not null and p_estado_emision not in \('pendiente', 'emitido'\)/, "debe permitir p_estado_emision NULL sin rechazarlo");
  assert.match(fn, /p_estado_pago is not null and p_estado_pago not in \('pendiente', 'pagado'\)/, "debe permitir p_estado_pago NULL sin rechazarlo");
  assert.doesNotMatch(fn, /coalesce\(p_estado_emision,\s*'pendiente'\)/, "NUNCA debe coalescer estado_emision a 'pendiente'");
  assert.doesNotMatch(fn, /coalesce\(p_estado_pago,\s*'pendiente'\)/, "NUNCA debe coalescer estado_pago a 'pendiente'");
});

test("migración 156 (defecto 2): tarifario_resultado gana la columna empaquetado_id — provenance del origen 'Sistema', mutuamente excluyente con bloqueo_id", () => {
  assert.match(mig156, /alter table public\.tarifario_resultado\s*\n\s*add column if not exists empaquetado_id bigint references public\.empaquetados\(id\);/);
});

test("migración 156: estado_emision/estado_pago sin default (null = 'Por confirmar', mismo criterio que la 152)", () => {
  assert.doesNotMatch(mig156, /estado_emision\s+text\s+default/i);
  assert.doesNotMatch(mig156, /estado_pago\s+text\s+default/i);
  assert.match(mig156, /check \(estado_emision in \('pendiente', 'emitido'\)\)/);
  assert.match(mig156, /check \(estado_pago in \('pendiente', 'pagado'\)\)/);
});

test("migración 156: RLS habilitado en las tres tablas, lectura de empaquetados incluye 'venta' (igual que bloqueos_vuelo)", () => {
  assert.match(mig156, /alter table public\.empaquetados\s+enable row level security;/);
  assert.match(mig156, /alter table public\.armado_empaquetados\s+enable row level security;/);
  assert.match(mig156, /alter table public\.empaquetado_cambios\s+enable row level security;/);
  const lectura = mig156.slice(mig156.indexOf('"empaquetados: lectura operativa"\n  on public.empaquetados for select'));
  assert.match(lectura.slice(0, 300), /'superadmin','gerencia','administracion','operaciones','venta','control_vuelo'/);
});

test("migración 156 y su rollback corren en transacción explícita, y el rollback también deshace lo agregado en esta revisión (CHECKs/RESTRICT/empaquetado_cambios/RPC/columna)", () => {
  assert.match(mig156, /^begin;/m);
  assert.match(mig156, /^commit;/m);
  const rollback156 = leer("supabase/scripts/rollback_156_empaquetados.sql");
  assert.match(rollback156, /^begin;/m);
  assert.match(rollback156, /^commit;/m);
  assert.match(rollback156, /alter table public\.tarifario_resultado drop column if exists empaquetado_id;/);
  assert.match(rollback156, /drop function if exists public\.actualizar_control_empaquetado/);
  assert.match(rollback156, /drop table if exists public\.empaquetado_cambios;/);
  assert.match(rollback156, /drop table if exists public\.armado_empaquetados;/);
  assert.match(rollback156, /drop table if exists public\.empaquetados;/);
});

// ───────────────────────────────────────────────────────────────────────────
// Motor de cálculo — NO doble margen (defecto 2, revisión de PR #268)
// aporteVuelo es la ÚNICA función que aplica el margen del vuelo (bloqueo o
// empaquetado, misma función, mismo contrato): costo/(1-mk) si aplica_mk,
// si no costo+ta. Se prueba con matemática real, no inspección de texto.
// ───────────────────────────────────────────────────────────────────────────
test("aporteVuelo: aplica el margen EXACTAMENTE una vez — mismo resultado para un bloqueo negociado y un empaquetado con el mismo costoTiquete/aplica_mk/pctMk/ta", () => {
  // Simula bloqueos_vuelo.tarifa_para_empaquetar y empaquetados.tarifa_para_empaquetar
  // con el MISMO valor — ambos deben producir el MISMO aporte al PVP, porque
  // generarTarifario() usa la misma función con el mismo único costo de entrada.
  const costoTiquete = 200_000;
  const pctMk = 0.20;
  const conMargen = aporteVuelo(costoTiquete, true, pctMk, 0);
  assert.equal(conMargen, 250_000, "costo/(1-mk) = 200000/0.8 = 250000");
  // Probar que NO es doble margen: costo/(1-mk)/(1-mk) daría 312500, distinto.
  assert.notEqual(conMargen, costoTiquete / (1 - pctMk) / (1 - pctMk));

  const conTA = aporteVuelo(costoTiquete, false, pctMk, 15_000);
  assert.equal(conTA, 215_000, "costo + TA cuando NO aplica margen");

  // La tarifa_proveedor (neto informativo) NUNCA debe alterar este cálculo —
  // aporteVuelo ni siquiera la recibe como parámetro, así que estructuralmente
  // no puede colarse dos veces al PVP.
  assert.equal(aporteVuelo.length, 4, "aporteVuelo solo recibe 4 parámetros (costoTiquete, aplicaMk, pctMk, ta) — nunca una segunda tarifa");
});

// ───────────────────────────────────────────────────────────────────────────
// generarTarifario() — integración real con Empaquetados (defecto 2)
// ───────────────────────────────────────────────────────────────────────────
const paquetesActionsSrc = leer("app/(dashboard)/dashboard/paquetes/actions.ts");

test("generarTarifario lee armado_empaquetados (join con empaquetados) — antes NO lo consultaba en absoluto", () => {
  assert.match(paquetesActionsSrc, /\.from\("armado_empaquetados"\)/, "generarTarifario debe consultar armado_empaquetados");
  assert.match(paquetesActionsSrc, /empaquetados\(id, record, ruta, fecha_ida, fecha_regreso, tarifa_para_empaquetar, activo, compra_inicio, compra_fin\)/);
});

test("generarTarifario: la rama 'bloqueo' liquida empaquetados con la MISMA función aporteVuelo/filasHoteles que un bloqueo negociado, usando tarifa_para_empaquetar (nunca tarifa_proveedor) como costoTiquete", () => {
  const inicio = paquetesActionsSrc.indexOf("// MÓDULO BLOQUEOS (Sistema): una liquidación por empaquetado");
  assert.notEqual(inicio, -1, "falta el bloque de generación para empaquetados dentro de tipo==='bloqueo'");
  const fin = paquetesActionsSrc.indexOf("} else if (tipo === \"porcion_terrestre\"", inicio);
  const bloque = paquetesActionsSrc.slice(inicio, fin);
  assert.match(bloque, /const costoTiquete = Number\(e\.tarifa_para_empaquetar\) \|\| 0;/, "debe usar tarifa_para_empaquetar como base");
  assert.doesNotMatch(bloque, /e\.tarifa_proveedor/, "tarifa_proveedor (neto informativo) NUNCA debe entrar al cálculo del PVP — evita doble margen/inconsistencia");
  assert.match(bloque, /aporteVuelo\(costoTiquete, aplica_mk, pctMk, ta\)/, "debe usar la MISMA función aporteVuelo que un bloqueo negociado");
  assert.match(bloque, /filasHoteles\(e\.fecha_ida!, numNoches, aporteVueloVal, impuesto, "bloqueo", null, label, e\.fecha_regreso, false, null, e\.id\)/, "debe pasar bloqueoId=null y empaquetadoId=e.id — provenance inequívoca");
});

test("generarTarifario: filasHoteles guarda empaquetado_id en cada fila insertada de tarifario_resultado", () => {
  const inicio = paquetesActionsSrc.indexOf("function filasHoteles(");
  const finFirma = paquetesActionsSrc.indexOf(") {", inicio);
  const firma = paquetesActionsSrc.slice(inicio, finFirma);
  assert.match(firma, /empaquetadoId: number \| null = null/, "filasHoteles debe recibir empaquetadoId como parámetro");
  const push = paquetesActionsSrc.indexOf("filas.push({", inicio);
  const finPush = paquetesActionsSrc.indexOf("});", push);
  const bloquePush = paquetesActionsSrc.slice(push, finPush);
  assert.match(bloquePush, /empaquetado_id:\s*empaquetadoId,/, "el insert de tarifario_resultado debe llevar empaquetado_id");
});

test("generarTarifario: la validación de tipo='bloqueo' acepta vuelos O empaquetados — no se limita en silencio a solo bloqueos negociados", () => {
  assert.match(
    paquetesActionsSrc,
    /if \(tipo === "bloqueo" && !vuelos\.length && !empaquetadosVuelos\.length\)/,
    "la validación debe exigir vuelos.length===0 Y empaquetadosVuelos.length===0 para rechazar — cualquiera de los dos basta"
  );
});

test("generarTarifario: empaquetados inactivos (activo=false) se excluyen de la generación — no se liquida con una fuente apagada", () => {
  const inicio = paquetesActionsSrc.indexOf("const empaquetadosVuelos = (empaquetadosSel ?? [])");
  const fin = paquetesActionsSrc.indexOf("const tipo = (pq.tipo", inicio);
  const bloque = paquetesActionsSrc.slice(inicio, fin);
  assert.match(bloque, /v\.e\.activo/, "el filtro debe excluir empaquetados con activo=false");
});

// ── computo.ts + reservar/actions.ts — provenance hasta Booking/contrato ───
const computoSrc = leer("lib/reservar/computo.ts");
const reservarActionsSrc = leer("app/(dashboard)/dashboard/reservar/actions.ts");
const empaquetadoOrigenSrc = leer("lib/reservar/empaquetadoOrigen.ts");

// Revisión de PR #268 (defecto 1, "ORIGEN DOBLE"): `computo.ts` ya no
// prioriza silenciosamente empaquetadoId sobre bloqueoId con un else-if
// sobre campos crudos — ahora el origen se resuelve UNA vez, discriminado y
// validado (`resolverOrigenVuelo`), y todo lo demás (query de tarifario,
// contrato_vuelos, sillas, CxP) lee de ese único resultado. Ver
// `lib/reservar/origen.ts` y las pruebas de `origen.test.ts`.
test("computo.ts: el origen se resuelve con resolverOrigenVuelo (discriminado) y la query de tarifario_resultado se filtra por origen.tipo, nunca por campos crudos", () => {
  assert.match(computoSrc, /import \{ resolverOrigenVuelo, empaquetadoVigente, hoyBogota/, "computarReserva debe importar el discriminante");
  assert.match(computoSrc, /const resOrigen = resolverOrigenVuelo\(input\);/, "el origen debe resolverse como primer paso");
  assert.match(computoSrc, /if \(!resOrigen\.ok\) return \{ ok: false, error: resOrigen\.error \};/, "un origen inválido debe abortar antes de cualquier consulta");
  assert.match(computoSrc, /if \(origen\.tipo === "salida"\) q = q\.eq\("salida_id", origen\.id\);/);
  assert.match(computoSrc, /else if \(origen\.tipo === "empaquetado"\) q = q\.eq\("empaquetado_id", origen\.id\);/);
  assert.match(computoSrc, /else if \(origen\.tipo === "bloqueo"\) q = q\.eq\("bloqueo_id", origen\.id\);/);
  assert.doesNotMatch(computoSrc, /q\.eq\("empaquetado_id", input\.empaquetadoId\)/, "la query ya no debe leer input.empaquetadoId directo");
  assert.doesNotMatch(computoSrc, /q\.eq\("bloqueo_id", input\.bloqueoId\)/, "la query ya no debe leer input.bloqueoId directo");
});

test("computo.ts: revalida activo/vigencia del empaquetado en el momento de resolver la reserva (no solo al generar el tarifario)", () => {
  const bloque = computoSrc.slice(computoSrc.indexOf('if (origen.tipo === "empaquetado") {'), computoSrc.indexOf("const esServicios"));
  assert.match(bloque, /\.select\("activo, compra_inicio, compra_fin"\)/);
  assert.match(bloque, /if \(!eq\.activo\) return \{ ok: false,/);
  assert.match(bloque, /empaquetadoVigente\(eq\.compra_inicio, eq\.compra_fin, hoyBogota\(new Date\(\)\)\)/);
});

test("reservar/actions.ts: resuelve y valida el origen COMPLETO (paso 2c) antes del número de contrato y del insert de ventas — no crea nada si falla", () => {
  assert.match(reservarActionsSrc, /import \{ resolverDatosVuelo, type DatosVueloOrigen \} from "@\/lib\/reservar\/empaquetadoOrigen";/);
  const paso2c = reservarActionsSrc.indexOf("// 2c) Resolver y VALIDAR el origen completo");
  const paso3 = reservarActionsSrc.indexOf("// 3) Número de contrato");
  const pasoVenta = reservarActionsSrc.indexOf('// 4) Venta (cabecera) — nace PENDIENTE');
  assert.ok(paso2c > 0 && paso2c < paso3 && paso3 < pasoVenta, "la resolución del origen debe ocurrir ANTES del número de contrato y del insert de ventas");
  const bloque2c = reservarActionsSrc.slice(paso2c, paso3);
  assert.match(bloque2c, /const rv = await resolverDatosVuelo\(admin, origen\);/);
  assert.match(bloque2c, /if \(!rv\.ok\) return \{ ok: false, error: rv\.error \};/, "un origen que no se pueda leer debe abortar ANTES de insertar la venta");
});

test("reservar/actions.ts: el tramo del contrato (paso 7) y la CxP aérea (paso 9) usan EXCLUSIVAMENTE datosVuelo — nunca vuelven a leer input.bloqueoId/empaquetadoId", () => {
  const paso7 = reservarActionsSrc.slice(reservarActionsSrc.indexOf("// 7) Vuelo del contrato"), reservarActionsSrc.indexOf("// 8) Ítems de valores"));
  // Ronda siguiente, hallazgo 5 "ALCANCE FUNCIONAL": el paso 7 ahora también
  // arma el tramo para origen.tipo === "salida" (contratos dinámicos
  // futuros) — antes solo bloqueo/empaquetado.
  assert.match(paso7, /if \(\(origen\.tipo === "bloqueo" \|\| origen\.tipo === "empaquetado" \|\| origen\.tipo === "salida"\) && datosVuelo\) \{/);
  // El código EJECUTABLE (fuera de comentarios) ya no debe volver a leer los
  // campos crudos — se compara línea por línea, no con un doesNotMatch sobre
  // todo el bloque, porque el propio comentario explicativo los menciona.
  const codigoSinComentarios = paso7.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(codigoSinComentarios, /input\.bloqueoId|input\.empaquetadoId/, "el tramo del contrato ya no debe leer los campos crudos");

  const paso9 = reservarActionsSrc.slice(reservarActionsSrc.indexOf("// 9) CxP aérea"), reservarActionsSrc.indexOf("// 10) Costo neto del HOTEL"));
  assert.match(paso9, /if \(datosVuelo\) \{/);
  assert.match(paso9, /if \(origen\.tipo === "bloqueo" && process\.env\.SUPABASE_SERVICE_ROLE_KEY\) \{/, "sillas SOLO para origen.tipo==='bloqueo'");
  assert.doesNotMatch(paso9, /input\.bloqueoId|input\.empaquetadoId|input\.salidaId/, "el paso de sillas/CxP ya no debe leer los campos crudos");
});

test("reservar/actions.ts: empaquetado_ref_id se estampa desde `origen` (nunca desde input.empaquetadoId), excluyente con bloqueo_ref_id", () => {
  assert.match(reservarActionsSrc, /bloqueo_ref_id: origen\.tipo === "bloqueo" \? origen\.id : null,/);
  assert.match(reservarActionsSrc, /empaquetado_ref_id: origen\.tipo === "empaquetado" \? origen\.id : null,/);
});

test("lib/reservar/empaquetadoOrigen.ts: helper compartido, un solo SELECT normalizado — evita repetir el mismo shape en 3 call sites distintos", () => {
  assert.match(empaquetadoOrigenSrc, /export async function datosVueloEmpaquetado/);
  assert.match(empaquetadoOrigenSrc, /tarifa_para_empaquetar,\s*fee_infante,/, "debe traer tarifa_para_empaquetar y fee_infante (para costo aéreo + fee de infante, igual que salidas_dinamicas)");
});

test("TarifarioPublic.tsx: FilaTarifario/Pivotada/reservarHref propagan empaquetado_id igual que bloqueo_id/salida_id", () => {
  const tarifarioPublicSrc = leer("app/tarifario/TarifarioPublic.tsx");
  assert.match(tarifarioPublicSrc, /empaquetado_id\?:\s*number \| null;/);
  assert.match(tarifarioPublicSrc, /if \(r\.empaquetado_id != null\) p\.set\("empaquetado", String\(r\.empaquetado_id\)\);/);
});

test("reservar/nuevo/page.tsx + ReservaForm.tsx: leen/propagan ?empaquetado= igual que ?bloqueo=/?salida=", () => {
  const nuevoPageSrc = leer("app/(dashboard)/dashboard/reservar/nuevo/page.tsx");
  const reservaFormSrc = leer("app/(dashboard)/dashboard/reservar/nuevo/ReservaForm.tsx");
  assert.match(nuevoPageSrc, /empaquetado\?:\s*string/, "searchParams debe aceptar ?empaquetado=");
  assert.match(nuevoPageSrc, /empaquetadoId\s*\?\s*q\.eq\("empaquetado_id", empaquetadoId\)/);
  assert.match(reservaFormSrc, /empaquetadoId:\s*meta\.empaquetadoId \?\? null/);
});

// ───────────────────────────────────────────────────────────────────────────
// Código de aplicación — empaquetados-actions.ts (defectos 4/5/6/7/8)
// ───────────────────────────────────────────────────────────────────────────
const empActionsSrc = leer("app/(dashboard)/dashboard/vuelos/empaquetados-actions.ts");

test("crearEmpaquetado exige fecha_ida pero NO exige record (el PNR se agrega después)", () => {
  const fn = empActionsSrc.slice(
    empActionsSrc.indexOf("export async function crearEmpaquetado"),
    empActionsSrc.indexOf("// GENERALES:")
  );
  assert.match(fn, /validarEmpaquetado\(input\)/, "crearEmpaquetado debe pasar por la validación compartida");
  assert.doesNotMatch(fn, /if \(!input\.record/, "no debe exigir record — es opcional a propósito");
});

test("defecto 6: validarEmpaquetado rechaza tarifas negativas y fechas invertidas — no confía solo en min=0 del formulario", () => {
  const fn = empActionsSrc.slice(empActionsSrc.indexOf("function validarEmpaquetado("), empActionsSrc.indexOf("export async function crearEmpaquetado"));
  assert.match(fn, /tarifaProveedor < 0/);
  assert.match(fn, /tarifaEmpaquetar < 0/);
  assert.match(fn, /feeInfante < 0/);
  assert.match(fn, /input\.fechaRegreso && input\.fechaRegreso < input\.fechaIda/);
  assert.match(fn, /input\.compraInicio && input\.compraFin && input\.compraFin < input\.compraInicio/);
});

test("defecto 7: actualizarEmpaquetado (edición GENERAL) ya NO toca record/estado_emision/estado_pago — esos son operativos y van por actualizarControlEmpaquetado", () => {
  const fn = empActionsSrc.slice(
    empActionsSrc.indexOf("export async function actualizarEmpaquetado"),
    empActionsSrc.indexOf("export async function actualizarControlEmpaquetado")
  );
  assert.doesNotMatch(fn, /record:/, "actualizarEmpaquetado no debe escribir record");
  assert.doesNotMatch(fn, /estado_emision:/, "actualizarEmpaquetado no debe escribir estado_emision");
  assert.doesNotMatch(fn, /estado_pago:/, "actualizarEmpaquetado no debe escribir estado_pago");
});

test("defecto 5: actualizarEmpaquetado comprueba fila afectada (.select + .maybeSingle) — RLS filtrando a 0 filas o un id inexistente NUNCA debe reportarse como éxito", () => {
  const fn = empActionsSrc.slice(
    empActionsSrc.indexOf("export async function actualizarEmpaquetado"),
    empActionsSrc.indexOf("export async function actualizarControlEmpaquetado")
  );
  assert.match(fn, /\.select\("id"\)\s*\n\s*\.maybeSingle\(\);/);
  assert.match(fn, /if \(!data\) return \{ ok: false, error:/, "debe devolver error si no vino fila (falso éxito)");
});

test("defecto 8: actualizarControlEmpaquetado llama al RPC actualizar_control_empaquetado (atómico + historial), nunca un UPDATE plano", () => {
  const fn = empActionsSrc.slice(
    empActionsSrc.indexOf("export async function actualizarControlEmpaquetado"),
    empActionsSrc.indexOf("export async function eliminarEmpaquetado")
  );
  assert.match(fn, /sb\.rpc\("actualizar_control_empaquetado"/);
  assert.doesNotMatch(fn, /\.from\("empaquetados"\)\.update\(/, "no debe hacer un UPDATE plano — eso perdería atomicidad+historial");
});

test("defecto 4: eliminarEmpaquetado revisa armado_empaquetados ANTES de borrar y devuelve un mensaje útil (paquetes que lo usan) en vez del error crudo de Postgres", () => {
  const fn = empActionsSrc.slice(empActionsSrc.indexOf("export async function eliminarEmpaquetado"));
  assert.match(fn, /\.from\("armado_empaquetados"\)/, "debe consultar armado_empaquetados antes del DELETE");
  assert.match(fn, /if \(enUso && enUso\.length\)/, "debe bloquear el borrado si hay vínculos");
  assert.match(fn, /Desvincúlalo de esos paquetes o desactívalo/, "debe recomendar desactivar en vez de borrar");
});

test("defecto 5: eliminarEmpaquetado también comprueba fila afectada del DELETE — mismo criterio de falso éxito que actualizarEmpaquetado", () => {
  const fn = empActionsSrc.slice(empActionsSrc.indexOf("export async function eliminarEmpaquetado"));
  assert.match(fn, /\.delete\(\)\.eq\("id", id\)\.select\("id"\)\.maybeSingle\(\);/);
  assert.match(fn, /if \(!data\) return \{ ok: false, error:/);
});

test("empaquetados-actions.ts nunca toca la tabla sillas — un empaquetado no representa cupo negociado", () => {
  assert.doesNotMatch(empActionsSrc, /\.from\(\s*"sillas"\s*\)/, "empaquetados-actions.ts no debe crear/tocar sillas en ningún punto");
});

test("defecto 5: setEmpaquetado/setTodosEmpaquetados revisan el error del DELETE de desvincular (antes se ignoraba por completo)", () => {
  const setEmp = empActionsSrc.slice(empActionsSrc.indexOf("export async function setEmpaquetado"), empActionsSrc.indexOf("export async function setTodosEmpaquetados"));
  assert.match(setEmp, /if \(!checked\) \{\s*\n\s*const \{ error \} = await sb\.from\("armado_empaquetados"\)\.delete\(\)/, "el DELETE de desvincular debe capturar `error`");
  assert.match(setEmp, /if \(error\) return \{ ok: false, error: error\.message \};[\s\S]*?\} else \{/, "debe comprobar el error antes de continuar");
  const setTodos = empActionsSrc.slice(empActionsSrc.indexOf("export async function setTodosEmpaquetados"));
  assert.match(setTodos, /if \(!checked\) \{\s*\n\s*const \{ error \} = await sb\.from\("armado_empaquetados"\)\.delete\(\)\.eq\("paquete_id", paqueteId\);\s*\n\s*if \(error\) return \{ ok: false, error: error\.message \};/);
});

test("setEmpaquetado/setTodosEmpaquetados escriben en armado_empaquetados con upsert por PK compuesta (nunca duplican la fila de empaquetados)", () => {
  assert.match(empActionsSrc, /export async function setEmpaquetado/);
  assert.match(empActionsSrc, /export async function setTodosEmpaquetados/);
  const bloque = empActionsSrc.slice(empActionsSrc.indexOf("export async function setEmpaquetado"));
  assert.match(bloque, /onConflict:\s*"paquete_id,empaquetado_id"/);
});

// ───────────────────────────────────────────────────────────────────────────
// UI — Control operativo separado del formulario general (defectos 7/8)
// ───────────────────────────────────────────────────────────────────────────
const controlEmpFormSrc = leer("app/(dashboard)/dashboard/vuelos/empaquetados/[id]/ControlEmpaquetadoForm.tsx");
const editarEmpFormSrc = leer("app/(dashboard)/dashboard/vuelos/empaquetados/[id]/EditarEmpaquetadoForm.tsx");

test("defecto 7: ControlEmpaquetadoForm arranca estadoEmision/estadoPago en '' (Por confirmar) cuando inicial es null — NUNCA los coacciona a 'pendiente'", () => {
  assert.match(controlEmpFormSrc, /useState<EstadoEmision \| "">\(\(inicial\.estadoEmision as EstadoEmision \| null\) \?\? ""\)/);
  assert.match(controlEmpFormSrc, /useState<EstadoPago \| "">\(\(inicial\.estadoPago as EstadoPago \| null\) \?\? ""\)/);
  assert.doesNotMatch(controlEmpFormSrc, /\?\? "pendiente"/, "no debe haber ningún default a 'pendiente' en este formulario");
});

test("defecto 7: los selects de ControlEmpaquetadoForm tienen una opción real 'Por confirmar' (value=\"\") que se guarda como NULL", () => {
  assert.match(controlEmpFormSrc, /<option value="">\{POR_CONFIRMAR\}<\/option>/);
});

test("defecto 8: ControlEmpaquetadoForm llama actualizarControlEmpaquetado (RPC), EditarEmpaquetadoForm (general) ya no maneja record/estados", () => {
  assert.match(controlEmpFormSrc, /actualizarControlEmpaquetado\(empaquetadoId,/);
  // Se revisa el USO real (useState/setState/objeto de campos), no la mera
  // mención de la palabra — el propio archivo documenta en un comentario que
  // "record/estadoEmision/estadoPago NO viven aquí", lo cual contendría la
  // palabra sin ser el bug que esta prueba busca.
  assert.doesNotMatch(editarEmpFormSrc, /useState<EstadoEmision/, "el formulario general no debe seguir con estado de React para estadoEmision");
  assert.doesNotMatch(editarEmpFormSrc, /estadoEmision,\s*estadoPago,/, "el formulario general no debe seguir enviando estadoEmision/estadoPago en el payload");
  assert.doesNotMatch(editarEmpFormSrc, /f\.record/, "el formulario general no debe seguir manejando record");
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

// ── Defecto 3: filtrado por activo (Empaquetados/Control Vuelos) ──────────
test("defecto 3: page.tsx filtra empActivos por activo=true Y no-pasado — un empaquetado desactivado con fecha futura NO debe aparecer como activo", () => {
  assert.match(vuelosPageSrc, /const empActivos = todosEmp\.filter\(\(e\) => e\.activo && !esPasado\(e\.fecha_ida, hoy\)\);/);
});

test("defecto 3: historico/page.tsx agrupa pasados O inactivos — un desactivado-futuro sí debe aparecer en el histórico, en vez de desaparecer de ambas vistas", () => {
  assert.match(historicoPageSrc, /const empPasados = todosEmp\.filter\(\(e\) => !e\.activo \|\| esPasado\(e\.fecha_ida, hoy\)\);/);
});

test("defecto 3: lib/tarifario/datos.ts (público) también oculta filas de un empaquetado desactivado después de generar el tarifario, no solo al regenerar", () => {
  const datosSrc = leer("lib/tarifario/datos.ts");
  assert.match(datosSrc, /empaquetado_id, salida_id/, "el select debe traer empaquetado_id");
  assert.match(datosSrc, /\.select\("id, activo, compra_inicio, compra_fin"\)/);
});

// ───────────────────────────────────────────────────────────────────────────
// Revisión posterior al PR #268 — hallazgo 4 "VIGENCIA EN LA VITRINA"
// ───────────────────────────────────────────────────────────────────────────
describe("lib/tarifario/datos.ts — vigencia de empaquetados en LECTURA del tarifario público (hallazgo 4)", () => {
  const datosSrc = leer("lib/tarifario/datos.ts");
  const bloque = datosSrc.slice(datosSrc.indexOf("const empaquetadoIds ="), datosSrc.indexOf("// En la vitrina"));

  test("vigente: filtra por activo Y empaquetadoVigente juntos, no solo activo", () => {
    assert.match(bloque, /\.filter\(\(e\) => e\.activo && empaquetadoVigente\(e\.compra_inicio, e\.compra_fin, hoyEmp\)\)/);
  });

  test("aún no inicia / vencido: ambos casos quedan cubiertos por la misma llamada a empaquetadoVigente (fechas inclusivas, America/Bogota — ver reservarOrigen.test.ts)", () => {
    assert.match(bloque, /empaquetadoVigente/);
    // Revisión posterior (diagnóstico de carga del tarifario, defecto
    // "EQUIVALENCIA FUNCIONAL"): el import de valor pasó de `@/lib/reservar/
    // origen` a un RELATIVO `../reservar/origen.ts` — necesario para poder
    // ejecutar este archivo directo bajo `node --test` (el alias `@/` solo
    // resuelve en build de Next.js/TypeScript, no bajo node plano) — mismo
    // módulo, mismo comportamiento, solo la forma del specifier cambia.
    assert.match(datosSrc, /import \{ empaquetadoVigente, hoyBogota \} from "\.\.\/reservar\/origen\.ts";/);
  });

  test("desactivado DESPUÉS de generar: el filtro corre en LECTURA (esta función), no solo al regenerar — mismo mecanismo que activo", () => {
    assert.match(bloque, /e\.activo && empaquetadoVigente/);
  });

  test("FALLA CERRADA: si la consulta de vigencia devuelve error, TODAS las filas de empaquetado se ocultan (nunca se publica una tarifa sin verificar)", () => {
    assert.match(bloque, /const vigentes = empsError\s*\n\s*\? new Set<number>\(\)/);
  });

  test("FALLA CERRADA: sin SUPABASE_SERVICE_ROLE_KEY, las filas de empaquetado también se ocultan (antes se mostraban sin chequeo)", () => {
    // Revisión posterior (diagnóstico de carga del tarifario, defecto
    // "OPTIMIZACIÓN INTERNA INCOMPLETA"): el chequeo directo de
    // `process.env.SUPABASE_SERVICE_ROLE_KEY` se reemplazó por `!admin`
    // (un solo admin client, calculado UNA vez a partir de esa MISMA
    // variable de entorno). Revisión posterior #2 (defecto "EQUIVALENCIA
    // FUNCIONAL"): ese cálculo se movió al valor por DEFECTO del 4º
    // parámetro de la función (`admin: SupabaseClient<Database> | null =
    // process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null`)
    // — mismo comportamiento exacto para las 3 páginas reales (nunca pasan
    // ese argumento), pero permite inyectar un admin FALSO en pruebas
    // (pruebas/tarifarioDatos.test.ts) sin tocar el entorno.
    assert.match(datosSrc, /admin: SupabaseClient<Database> \| null = process\.env\.SUPABASE_SERVICE_ROLE_KEY \? createAdminClient\(\) : null/, "admin debe derivarse de SUPABASE_SERVICE_ROLE_KEY una sola vez, ahora como valor por defecto del parámetro");
    assert.match(bloque, /if \(!admin\) \{\s*\n\s*filas = filas\.filter\(\(f\) => f\.empaquetado_id == null\);/);
  });
});

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

// ───────────────────────────────────────────────────────────────────────────
// Revisión posterior al PR #268 — hallazgo 5 "COTIZACIÓN debe fallar cerrada"
// ───────────────────────────────────────────────────────────────────────────
describe("crearCotizacion — falla cerrada si el origen del vuelo no se puede resolver (hallazgo 5)", () => {
  test("ya NO existe el patrón silencioso 'if (rv.ok) datosVueloSnap = rv.data' sin rama de error", () => {
    assert.doesNotMatch(reservarActionsSrc, /if \(rv\.ok\) datosVueloSnap = rv\.data;/, "el patrón viejo (silencioso) no debe seguir en el archivo");
  });

  test("un fallo de resolverDatosVuelo hace return ANTES de construir el snapshot — cero cotización creada", () => {
    const inicio = reservarActionsSrc.indexOf("let datosVueloSnap: DatosVueloOrigen | null = null;");
    const finCotizacionInsert = reservarActionsSrc.indexOf('.from("cotizaciones").insert(');
    const bloque = reservarActionsSrc.slice(inicio, finCotizacionInsert);
    assert.match(bloque, /const rv = await resolverDatosVuelo\(createAdminClient\(\), origen\);/);
    assert.match(bloque, /if \(!rv\.ok\) return \{ ok: false, error: rv\.error \};/, "debe retornar el error de rv sin insertar nada");
    // El insert de cotizaciones debe estar DESPUÉS de este bloque, nunca antes.
    assert.ok(inicio < finCotizacionInsert, "la resolución del vuelo debe ocurrir antes del insert de cotizaciones");
  });

  test("sin SUPABASE_SERVICE_ROLE_KEY, también falla cerrado en vez de omitir el vuelo en silencio", () => {
    const inicio = reservarActionsSrc.indexOf("let datosVueloSnap: DatosVueloOrigen | null = null;");
    const bloque = reservarActionsSrc.slice(inicio, inicio + 400);
    assert.match(bloque, /if \(!process\.env\.SUPABASE_SERVICE_ROLE_KEY\)\s*\n\s*return \{ ok: false, error: "No se pudo resolver el origen del vuelo/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Revisión posterior al PR #268 — hallazgo 6 "BORRADO" (ventas.empaquetado_ref_id)
// ───────────────────────────────────────────────────────────────────────────
describe("eliminarEmpaquetado — también revisa ventas.empaquetado_ref_id antes del DELETE (hallazgo 6)", () => {
  test("consulta ventas por empaquetado_ref_id con service-role (control_vuelo no tiene SELECT sobre ventas)", () => {
    const fn = empActionsSrc.slice(empActionsSrc.indexOf("export async function eliminarEmpaquetado"), empActionsSrc.indexOf("// ── Vincular/desvincular"));
    assert.match(fn, /const admin = createAdminClient\(\);/);
    assert.match(fn, /\.from\("ventas"\)\s*\n\s*\.select\("numero_contrato"\)\s*\n\s*\.eq\("empaquetado_ref_id", id\)/);
  });

  test("mensaje útil: lista los números de contrato vinculados, no un genérico", () => {
    const fn = empActionsSrc.slice(empActionsSrc.indexOf("export async function eliminarEmpaquetado"), empActionsSrc.indexOf("// ── Vincular/desvincular"));
    assert.match(fn, /No se puede eliminar: este empaquetado tiene \$\{enContratos\.length\} contrato\(s\) vinculado\(s\) \(\$\{lista\}\)/);
  });

  test("el chequeo de ventas ocurre ANTES del DELETE — nunca se borra primero y se avisa después", () => {
    const fn = empActionsSrc.slice(empActionsSrc.indexOf("export async function eliminarEmpaquetado"), empActionsSrc.indexOf("// ── Vincular/desvincular"));
    const idxCheck = fn.indexOf('.from("ventas")');
    const idxDelete = fn.indexOf('.from("empaquetados").delete()');
    assert.ok(idxCheck > 0 && idxDelete > 0 && idxCheck < idxDelete, "el chequeo de ventas debe ocurrir antes del DELETE");
  });

  test("el FK ventas.empaquetado_ref_id sigue como defensa final (sin ON DELETE CASCADE)", () => {
    const mig156 = leer("supabase/migrations/20260601000156_empaquetados.sql");
    assert.match(mig156, /add column if not exists empaquetado_ref_id bigint references public\.empaquetados\(id\);/, "sin ON DELETE CASCADE — el default es RESTRICT/NO ACTION");
    assert.doesNotMatch(mig156, /empaquetado_ref_id bigint references public\.empaquetados\(id\) on delete cascade/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Revisión posterior al PR #268 — hallazgo 2 "LISTA UNIFICADA Y RLS"
// ───────────────────────────────────────────────────────────────────────────
describe("ventas_vuelo_sistema — vista mínima para el inventario aéreo por sistema (hallazgo 2)", () => {
  const mig156 = leer("supabase/migrations/20260601000156_empaquetados.sql");

  test("incluye control_vuelo en el set de roles con acceso (el gap original reportado)", () => {
    const fn = mig156.slice(mig156.indexOf("create or replace function public.acceso_ventas_vuelo_sistema"), mig156.indexOf("create or replace view public.ventas_vuelo_sistema"));
    assert.match(fn, /'gerencia','administracion','operaciones','control_vuelo'/);
  });

  test("la vista llama acceso_ventas_vuelo_sistema(v.tenant) en su where — el filtro vive en la función, no inline", () => {
    const vista = mig156.slice(mig156.indexOf("create or replace view public.ventas_vuelo_sistema"), mig156.indexOf("grant select on public.ventas_vuelo_sistema"));
    assert.match(vista, /and public\.acceso_ventas_vuelo_sistema\(v\.tenant\);/);
    assert.doesNotMatch(vista, /puede_ver_tenant/, "la vista NO debe llamar puede_ver_tenant() directo — ese alcance es global para gerencia, este puntual no debe serlo");
  });

  test("nunca expone columnas financieras/PII de ventas (cliente, precio_venta, costo_*, comisión)", () => {
    const vista = mig156.slice(
      mig156.indexOf("create or replace view public.ventas_vuelo_sistema"),
      mig156.indexOf("grant select on public.ventas_vuelo_sistema")
    );
    for (const col of ["cliente", "precio_venta", "costo_hotel", "costo_aereo", "comision_b2b", "cliente_documento", "cliente_telefono"]) {
      assert.doesNotMatch(vista, new RegExp(`v\\.${col}\\b`), `la vista no debe exponer ${col}`);
    }
  });

  test("incluye AMBOS orígenes: tipo_paquete='dinamico' O empaquetado_ref_id no nulo (no solo dinámico)", () => {
    assert.match(mig156, /where \(v\.tipo_paquete = 'dinamico' or v\.empaquetado_ref_id is not null\)/);
  });

  test("vuelos/page.tsx consulta la vista, nunca public.ventas directo", () => {
    assert.match(vuelosPageSrc, /sb\.from\("ventas_vuelo_sistema"\)\.select\("\*"\)/);
    assert.doesNotMatch(vuelosPageSrc, /sb\.from\("ventas"\)/, "no debe quedar ninguna consulta directa a ventas en esta página");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ronda siguiente a la revisión de PR #268 — hallazgo 1 "AISLAMIENTO DE
// GERENCIA": la primera versión de `ventas_vuelo_sistema` usaba
// `puede_ver_tenant()`, que le da a `gerencia` alcance GLOBAL (correcto para
// el resto del sistema, migración 107, pero NO para esta vista puntual). La
// prueba SQL real (`test_empaquetados.sql`, sección I) ya cubre el
// comportamiento observable por rol/tenant; estas pruebas de patrón
// verifican que la función NUEVA existe con la forma correcta y que
// `puede_ver_tenant()` NUNCA se tocó (sigue siendo global para gerencia en
// TODO el resto del sistema, sin cambios de esta ronda).
// ───────────────────────────────────────────────────────────────────────────
describe("acceso_ventas_vuelo_sistema() — aislamiento ESTRICTO por tenant, solo superadmin es global (hallazgo 1)", () => {
  const mig156 = leer("supabase/migrations/20260601000156_empaquetados.sql");
  const fn = mig156.slice(
    mig156.indexOf("create or replace function public.acceso_ventas_vuelo_sistema"),
    mig156.indexOf("create or replace view public.ventas_vuelo_sistema")
  );

  test("superadmin: alcance global — comparación directa con '=', SIN comparar tenant", () => {
    assert.match(fn, /public\.mi_rol\(\) = 'superadmin'/);
  });

  test("gerencia/administracion/operaciones/control_vuelo: exige mi_tenant() = t (nunca puede_ver_tenant)", () => {
    assert.match(fn, /public\.mi_rol\(\) in \('gerencia','administracion','operaciones','control_vuelo'\)\s*\n\s*and public\.mi_tenant\(\) = t/);
  });

  test("venta NO aparece en ninguna rama de la función (excluido a propósito, igual que antes)", () => {
    assert.doesNotMatch(fn, /'venta'/);
  });

  test("puede_ver_tenant() en sí NUNCA se modificó — sigue dando alcance global a gerencia en todo el resto del sistema", () => {
    const mig107 = leer("supabase/migrations/20260601000107_multitenant.sql");
    assert.match(
      mig107,
      /select public\.mi_rol\(\) in \('superadmin','gerencia'\) or public\.mi_tenant\(\) = t;/,
      "esta ronda no debía tocar puede_ver_tenant() — la función dedicada nueva es la única que cambia de comportamiento"
    );
  });

  test("el rollback de la 156 también suelta acceso_ventas_vuelo_sistema() (después de la vista, antes que nada más dependa)", () => {
    const rollback156 = leer("supabase/scripts/rollback_156_empaquetados.sql");
    const idxDropVista = rollback156.indexOf("drop view if exists public.ventas_vuelo_sistema;");
    const idxDropFn = rollback156.indexOf("drop function if exists public.acceso_ventas_vuelo_sistema(text);");
    assert.ok(idxDropVista > 0 && idxDropFn > 0 && idxDropVista < idxDropFn, "la vista debe soltarse ANTES que la función de la que depende");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ronda siguiente — hallazgo 2 "ENLACE DE CONTRATO": un origen "contrato" en
// EmpaquetadosTabla enlazaba SIEMPRE a /dashboard/contratos/[numero], sin
// importar si el rol que mira la tabla tiene o no SELECT sobre `ventas` —
// `control_vuelo` sí entra al módulo Vuelos pero NO tiene esa policy
// (confirmado en la propia migración 116), así que el link cargaba una
// ficha vacía por RLS sin ningún aviso.
// ───────────────────────────────────────────────────────────────────────────
describe("EmpaquetadosTabla / vuelos-page — el link a /dashboard/contratos se oculta cuando el rol no tiene acceso real (hallazgo 2)", () => {
  const tablaSrc = leer("app/(dashboard)/dashboard/vuelos/EmpaquetadosTabla.tsx");
  const rolesSrc = leer("lib/roles.ts");

  test("ROLES_CONTRATO_COMPLETO existe y coincide EXACTAMENTE con la policy RLS real de SELECT sobre ventas (migración 116)", () => {
    assert.match(rolesSrc, /export const ROLES_CONTRATO_COMPLETO: readonly Rol\[\] = \["superadmin", "gerencia", "administracion", "operaciones"\];/);
    const mig116 = leer("supabase/migrations/20260601000116_rls_tenant_isolation.sql");
    assert.match(mig116, /public\.mi_rol\(\) in \('superadmin','gerencia','administracion','operaciones'\)\s*\n\s*and public\.puede_ver_tenant\(tenant\)/, "ROLES_CONTRATO_COMPLETO debe reflejar exactamente esta policy — control_vuelo/venta NO están aquí");
  });

  test("EmpaquetadosTabla recibe puedeVerContrato y NO renderiza <Link> en la columna Contrato cuando es false (migración 157: Record y Contrato ya son columnas separadas)", () => {
    assert.match(tablaSrc, /puedeVerContrato: boolean;/);
    const colContrato = tablaSrc.slice(tablaSrc.indexOf('{f.origen !== "contrato" ? ('), tablaSrc.indexOf("{f.aerolinea ?? "));
    assert.match(colContrato, /!puedeVerContrato/, "la columna Contrato debe seguir gateando por puedeVerContrato");
    assert.match(colContrato, /<span className="font-mono text-sm font-semibold text-gray-500"/, "sin acceso: texto plano, nunca un <Link>");
    assert.match(colContrato, /<Link href=\{`\/dashboard\/contratos\/\$\{f\.numeroContrato\}`\}/, "con acceso: sigue existiendo el <Link> normal al contrato");
  });

  test("vuelos/page.tsx calcula puedeVerContrato con miRol()/ROLES_CONTRATO_COMPLETO y lo pasa a EmpaquetadosTabla — nunca fijo en true", () => {
    assert.match(vuelosPageSrc, /import \{ miRol, ROLES_CONTRATO_COMPLETO, ROLES_EDITOR_VUELOS_CONTRATO \} from "@\/lib\/roles";/);
    assert.match(vuelosPageSrc, /const puedeVerContrato = !!rol && ROLES_CONTRATO_COMPLETO\.includes\(rol\);/);
    assert.match(vuelosPageSrc, /<EmpaquetadosTabla\s*\n\s*puedeVerContrato=\{puedeVerContrato\}/);
  });

  test("historico/page.tsx también calcula y propaga puedeVerContrato (mismo criterio que la vista activa)", () => {
    assert.match(historicoPageSrc, /import \{ miRol, ROLES_CONTRATO_COMPLETO, ROLES_EDITOR_VUELOS_CONTRATO \} from "@\/lib\/roles";/);
    assert.match(historicoPageSrc, /const puedeVerContrato = !!rol && ROLES_CONTRATO_COMPLETO\.includes\(rol\);/);
    assert.match(historicoPageSrc, /<EmpaquetadosTabla\s*\n\s*puedeVerContrato=\{puedeVerContrato\}/);
  });

  test("Record y Contrato son columnas SEPARADAS (migración 157) — origen 'contrato' nunca cae al número de contrato en la celda Record, origen 'promocion' no tiene columna Contrato", () => {
    // Antes (dos rondas atrás): una sola columna combinada
    // `f.origen === "contrato" ? (f.record ?? f.numeroContrato) : (f.record ?? "Sin record")`.
    // Ahora: Record siempre es el PNR real o "Sin PNR"/"Sin record"; el
    // número de contrato vive en su PROPIA columna, nunca como fallback de Record.
    assert.doesNotMatch(tablaSrc, /f\.record \?\? f\.numeroContrato/, "Record ya no debe caer al número de contrato");
    assert.match(tablaSrc, /f\.record \?\? "Sin PNR"/);
    assert.match(tablaSrc, /f\.record \?\? "Sin record"/);
    assert.match(tablaSrc, /f\.origen !== "contrato" \? \(\s*<span className="text-gray-300">—<\/span>/, "origen 'promocion' muestra un guion en la columna Contrato (no aplica)");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ronda siguiente — hallazgo 3 "ERRORES DE CONSULTA": un fallo real de la
// consulta a `ventas_vuelo_sistema` (RLS, red, timeout) se interpretaba
// exactamente igual que "no hay empaquetados/contratos" — la pantalla
// afirmaba algo falso ("No hay empaquetados activos") en vez de avisar que
// la consulta falló.
// ───────────────────────────────────────────────────────────────────────────
describe("vuelos/page.tsx y historico/page.tsx — el error de ventas_vuelo_sistema se muestra, nunca se confunde con 'vacío' (hallazgo 3)", () => {
  test("vuelos/page.tsx captura el error (no solo `data`) de la consulta a ventas_vuelo_sistema", () => {
    assert.match(vuelosPageSrc, /data: dinamicosData, error: dinamicosError \}, rol\]/);
  });

  test("vuelos/page.tsx muestra un banner de error visible cuando dinamicosError existe", () => {
    assert.match(vuelosPageSrc, /\{dinamicosError && \(/);
    assert.match(vuelosPageSrc, /No se pudieron cargar los vuelos por contrato/);
  });

  test("vuelos/page.tsx NO muestra 'No hay empaquetados activos' cuando la consulta falló (solo cuando de verdad no hay datos)", () => {
    // Búsqueda directa del ternario en sí (no por proximidad de texto): el
    // estado "vacío" exige explícitamente `!dinamicosError` como TERCERA
    // condición — sin ella, un error de la consulta caería en la misma
    // rama que "de verdad no hay nada".
    assert.match(vuelosPageSrc, /!empActivos\.length && !dinamicosActivos\.length && !dinamicosError \? \(/);
  });

  test("historico/page.tsx tiene el mismo tratamiento de error (captura + banner + no confundir con vacío)", () => {
    assert.match(historicoPageSrc, /data: dinamicosData, error: dinamicosError \}, rol\]/);
    assert.match(historicoPageSrc, /\{dinamicosError && \(/);
    assert.match(historicoPageSrc, /!empPasados\.length && !dinamicosPasados\.length && !dinamicosError \? \(/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ronda siguiente — hallazgo 4 "BORRADO": sin SUPABASE_SERVICE_ROLE_KEY
// configurada, `eliminarEmpaquetado` saltaba el chequeo de contratos
// vinculados EN SILENCIO y caía directo al DELETE (con el FK como única
// defensa, sin el mensaje útil). Ahora debe fallar cerrado.
// ───────────────────────────────────────────────────────────────────────────
describe("eliminarEmpaquetado — falla cerrado si falta SUPABASE_SERVICE_ROLE_KEY, nunca llega al DELETE (hallazgo 4)", () => {
  const fn = empActionsSrc.slice(empActionsSrc.indexOf("export async function eliminarEmpaquetado"), empActionsSrc.indexOf("// ── Vincular/desvincular"));

  test("ya NO existe el patrón viejo 'if (process.env.SUPABASE_SERVICE_ROLE_KEY) { ... }' que saltaba el chequeo en silencio", () => {
    assert.doesNotMatch(fn, /if \(process\.env\.SUPABASE_SERVICE_ROLE_KEY\) \{/, "el chequeo ya no debe ser condicional-silencioso");
  });

  test("sin la clave, retorna error de configuración ANTES de crear el cliente admin o tocar ventas/empaquetados", () => {
    assert.match(fn, /if \(!process\.env\.SUPABASE_SERVICE_ROLE_KEY\) \{\s*\n\s*return \{\s*\n\s*ok: false,\s*\n\s*error: "No se pudo verificar si este empaquetado tiene contratos vinculados/);
  });

  test("el return de fallo cerrado ocurre ANTES de createAdminClient() y del DELETE — nunca después", () => {
    const idxFalloCerrado = fn.indexOf('if (!process.env.SUPABASE_SERVICE_ROLE_KEY)');
    const idxAdmin = fn.indexOf('const admin = createAdminClient();');
    const idxDelete = fn.indexOf('.from("empaquetados").delete()');
    assert.ok(idxFalloCerrado > 0 && idxAdmin > 0 && idxDelete > 0, "los tres puntos deben existir");
    assert.ok(idxFalloCerrado < idxAdmin && idxAdmin < idxDelete, "orden: fallo cerrado → cliente admin → DELETE, nunca al revés");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ronda siguiente — hallazgo 5 "ALCANCE FUNCIONAL": para contratos dinámicos
// FUTUROS, se implementa el guardado de contrato_vuelos desde la salida
// dinámica (origen.tipo === "salida") — el histórico sigue sin backfill de
// lo ya existente. El histórico de Empaquetados también pasa a incluir el
// origen "Contrato" ya pasado (antes solo mostraba promociones).
// ───────────────────────────────────────────────────────────────────────────
describe("reservar/actions.ts — contrato_vuelos se guarda también para origen 'salida' (contratos dinámicos futuros) (hallazgo 5)", () => {
  test("el paso 7 incluye origen.tipo === \"salida\" junto a bloqueo/empaquetado (antes solo esos dos)", () => {
    assert.match(
      reservarActionsSrc,
      /if \(\(origen\.tipo === "bloqueo" \|\| origen\.tipo === "empaquetado" \|\| origen\.tipo === "salida"\) && datosVuelo\) \{/
    );
  });

  test("record/numero_vuelo quedan NULL para el tramo de una salida dinámica — nunca se inventa un valor que la fuente no tiene", () => {
    // `datosVueloSalida` (lib/reservar/empaquetadoOrigen.ts) ya construye
    // `record: null, vuelo_ida: null, vuelo_regreso: null` — el paso 7 arma
    // el tramo a partir de esos mismos campos de `datosVuelo`, así que no
    // hace falta un `if` especial: el shape genérico ya produce NULL para
    // salida sin ningún caso aparte que pudiera inventar un valor.
    const datosVueloSalidaSrc = leer("lib/reservar/empaquetadoOrigen.ts");
    const fn = datosVueloSalidaSrc.slice(datosVueloSalidaSrc.indexOf("export async function datosVueloSalida"), datosVueloSalidaSrc.indexOf("/**\n * Resuelve"));
    assert.match(fn, /aerolinea: s\.aerolinea, record: null, ruta: s\.ruta,/);
    assert.match(fn, /vuelo_ida: null, vuelo_regreso: null,/);
  });

  test("ningún backfill de contratos dinámicos históricos — el comentario documenta explícitamente que es solo hacia adelante", () => {
    assert.match(reservarActionsSrc, /NINGÚN backfill automático — solo contratos NUEVOS desde este cambio en/);
  });
});

describe("historico/page.tsx — incluye el origen 'Contrato' ya pasado, mismo criterio que ../page.tsx (hallazgo 5)", () => {
  test("consulta ventas_vuelo_sistema (nunca public.ventas directo), igual que la pantalla activa", () => {
    assert.match(historicoPageSrc, /sb\.from\("ventas_vuelo_sistema"\)\.select\("\*"\)/);
    assert.doesNotMatch(historicoPageSrc, /sb\.from\("ventas"\)/, "no debe quedar ninguna consulta directa a ventas en esta página");
  });

  test("filtra por esPasado(fecha_salida) — mismo criterio que dinamicosActivos en la pantalla activa", () => {
    assert.match(historicoPageSrc, /const dinamicosPasados = todosDinamicos\.filter\(\(d\) => esPasado\(d\.fecha_salida, hoy\)\);/);
  });

  test("el viejo comentario 'NO se listan aquí todavía' ya no existe — el alcance se implementó", () => {
    assert.doesNotMatch(historicoPageSrc, /NO\s*\n\s*se listan aquí todavía/);
  });

  test("EmpaquetadosTabla en el histórico recibe también las filas de origen 'contrato'", () => {
    const bloque = historicoPageSrc.slice(historicoPageSrc.indexOf("vistaEmpaquetados ? ("), historicoPageSrc.indexOf("vistaControl ? ("));
    assert.match(bloque, /\.\.\.dinamicosPasados\.map\(\(d\) => \(\{/);
    assert.match(bloque, /id: `contrato:\$\{d\.numero_contrato\}`, origen: "contrato" as const/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ronda siguiente (2ª) — hallazgo 1 "CONECTAR CONTRATO_VUELOS CON LA LISTA":
// ventas_vuelo_sistema solo traía columnas planas de `ventas` — un contrato
// dinámico NUEVO que sí inserta `contrato_vuelos` (implementado en la ronda
// anterior) seguía mostrando ruta/vuelo_ida/vuelo_regreso/horarios en NULL en
// la tabla, aunque el dato ya existiera. Ahora la vista trae ese detalle vía
// LEFT JOIN LATERAL — ver `supabase/scripts/test_empaquetados.sql` sección J
// para las pruebas reales (una sola fila por contrato, sin mezclar
// contratos, histórico sin tramos en NULL).
// ───────────────────────────────────────────────────────────────────────────
describe("ventas_vuelo_sistema — detalle aéreo desde contrato_vuelos, una fila por contrato (hallazgo 1, 2ª ronda siguiente)", () => {
  const mig156 = leer("supabase/migrations/20260601000156_empaquetados.sql");
  const vista = mig156.slice(mig156.indexOf("create or replace view public.ventas_vuelo_sistema"), mig156.indexOf("grant select on public.ventas_vuelo_sistema"));

  test("usa LEFT JOIN LATERAL, uno para direccion='ida' y otro para direccion='regreso', cada uno con order by + limit 1 (determinismo, nunca duplica filas)", () => {
    assert.match(vista, /left join lateral \(/g);
    const matches = vista.match(/left join lateral \(/g) ?? [];
    assert.equal(matches.length, 2, "debe haber EXACTAMENTE 2 LEFT JOIN LATERAL — uno por dirección, nunca más");
    assert.match(vista, /cv\.direccion = 'ida'/);
    assert.match(vista, /cv\.direccion = 'regreso'/);
    assert.match(vista, /order by cv\.orden asc, cv\.id asc\s*\n\s*limit 1/g);
  });

  test("cada lateral filtra por cv.numero_contrato = v.numero_contrato — nunca puede mezclar tramos de dos contratos distintos", () => {
    const matches = vista.match(/cv\.numero_contrato = v\.numero_contrato/g) ?? [];
    assert.equal(matches.length, 2, "los DOS laterales (ida y regreso) deben filtrar por el numero_contrato del contrato actual");
  });

  test("ruta se construye DETERMINÍSTICAMENTE desde los códigos IATA del propio tramo (nunca parseando un string ajeno)", () => {
    assert.match(vista, /ida\.origen_codigo \|\| ' - ' \|\| ida\.destino_codigo/);
    assert.match(vista, /reg\.destino_codigo is not null then ' - ' \|\| reg\.destino_codigo/);
  });

  test("record sale de coalesce(ida.record, reg.record) — nunca se inventa si el tramo no lo trae", () => {
    assert.match(vista, /coalesce\(ida\.record, reg\.record\) as record/);
  });

  test("las fechas de tramo (vuelo_fecha_ida/vuelo_fecha_regreso) son columnas NUEVAS, separadas de fecha_salida/fecha_regreso (que siguen viniendo de ventas sin cambio)", () => {
    assert.match(vista, /ida\.fecha_salida as vuelo_fecha_ida/);
    assert.match(vista, /reg\.fecha_salida as vuelo_fecha_regreso/);
    assert.match(vista, /v\.fecha_salida, v\.fecha_regreso, v\.empaquetado_ref_id/, "fecha_salida/fecha_regreso de ventas se conservan sin cambio");
  });

  test("cero PII/financiero: contrato_vuelos no aporta ninguna columna de cliente/costo/precio a la vista", () => {
    for (const col of ["cliente", "precio_venta", "costo_hotel", "costo_aereo", "comision_b2b"]) {
      assert.doesNotMatch(vista, new RegExp(`\\b${col}\\b`), `la vista no debe exponer ${col}`);
    }
  });

  test("el aislamiento estricto por tenant (acceso_ventas_vuelo_sistema) sigue siendo el único filtro de acceso — no se agregó ningún filtro adicional que lo debilite o lo saltee", () => {
    assert.match(vista, /and public\.acceso_ventas_vuelo_sistema\(v\.tenant\);/);
  });

  test("types/database.ts: el Row de ventas_vuelo_sistema declara las columnas aéreas nuevas", () => {
    const dbTypesSrc = leer("types/database.ts");
    const tipoVista = dbTypesSrc.slice(dbTypesSrc.indexOf("ventas_vuelo_sistema: {"), dbTypesSrc.indexOf("ventas_vuelo_sistema: {") + 1200);
    for (const campo of ["record", "origen_codigo", "destino_codigo", "ruta", "vuelo_ida", "vuelo_regreso", "hora_salida_ida", "hora_llegada_ida", "hora_salida_reg", "hora_llegada_reg", "vuelo_fecha_ida", "vuelo_fecha_regreso"]) {
      assert.match(tipoVista, new RegExp(`${campo}: string \\| null;`), `Row de ventas_vuelo_sistema debe declarar ${campo}`);
    }
  });
});

describe("vuelos/page.tsx, historico/page.tsx y EmpaquetadosTabla — conectan el detalle aéreo nuevo (hallazgo 1, 2ª ronda siguiente)", () => {
  const tablaSrc = leer("app/(dashboard)/dashboard/vuelos/EmpaquetadosTabla.tsx");

  test("vuelos/page.tsx mapea record/ruta/vuelo_ida/vuelo_regreso REALES para el origen 'contrato' (ya no null fijo)", () => {
    const bloque = vuelosPageSrc.slice(vuelosPageSrc.indexOf("...dinamicosActivos.map((d) =>"), vuelosPageSrc.indexOf("...dinamicosActivos.map((d) =>") + 500);
    assert.match(bloque, /record: d\.record, numeroContrato: d\.numero_contrato/);
    assert.match(bloque, /aerolinea: d\.aerolinea, ruta: d\.ruta,/);
    assert.match(bloque, /vuelo_ida: d\.vuelo_ida, fecha_regreso: d\.fecha_regreso, vuelo_regreso: d\.vuelo_regreso,/);
  });

  test("historico/page.tsx mapea los mismos campos reales para dinamicosPasados", () => {
    const bloque = historicoPageSrc.slice(historicoPageSrc.indexOf("...dinamicosPasados.map((d) =>"), historicoPageSrc.indexOf("...dinamicosPasados.map((d) =>") + 500);
    assert.match(bloque, /record: d\.record, numeroContrato: d\.numero_contrato/);
    assert.match(bloque, /aerolinea: d\.aerolinea, ruta: d\.ruta,/);
    assert.match(bloque, /vuelo_ida: d\.vuelo_ida, fecha_regreso: d\.fecha_regreso, vuelo_regreso: d\.vuelo_regreso,/);
  });

  // ⚠️ Migración 157 (ronda posterior a esta): "Record / Contrato" se separó
  // en DOS columnas — ver pruebas/editorVuelosContrato.test.ts para el detalle
  // completo del nuevo wiring (columnas separadas + Acciones). Aquí solo se
  // deja constancia de que el encabezado combinado de ESTA ronda ya no existe.
  test("EmpaquetadosTabla: el encabezado combinado 'Record / Contrato' de esta ronda fue reemplazado por columnas separadas en una ronda posterior", () => {
    assert.doesNotMatch(tablaSrc, /<th className="px-3 py-2">Record \/ Contrato<\/th>/);
    assert.match(tablaSrc, /<th className="px-3 py-2">Record<\/th>/);
    assert.match(tablaSrc, /<th className="px-3 py-2">Contrato<\/th>/);
  });

  test("EmpaquetadosTabla: origen 'contrato' muestra el record REAL o 'Sin PNR' en SU columna — el número de contrato vive en la columna Contrato, no como fallback de Record", () => {
    assert.match(tablaSrc, /f\.record \?\? "Sin PNR"/);
    assert.doesNotMatch(tablaSrc, /f\.record \?\? f\.numeroContrato/);
  });

  test("EmpaquetadosTabla: la columna Contrato (sin acceso) muestra el número de contrato como texto plano, sin link", () => {
    assert.match(tablaSrc, /!puedeVerContrato \? \(\s*<span className="font-mono text-sm font-semibold text-gray-500" title="Tu rol no tiene acceso a la ficha del contrato">\s*\{f\.numeroContrato\}/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ronda siguiente (2ª) — hallazgo 2 "FUNCIÓN SECURITY DEFINER":
// acceso_ventas_vuelo_sistema(text) conservaba por defecto EXECUTE para
// PUBLIC (todo `create function` lo hace salvo que se revoque explícito) —
// cualquier rol, incluido `anon`, podía invocarla directo como RPC. Mismo
// patrón YA usado en este repo para acceso_archivo_contratos() (migración
// 150): revoke all from public + grant execute solo a authenticated. Ver
// `supabase/scripts/test_empaquetados.sql` sección K para la prueba real
// (anon rechazado, authenticated respeta tenant, la vista sigue funcionando).
// ───────────────────────────────────────────────────────────────────────────
describe("acceso_ventas_vuelo_sistema() — EXECUTE revocado de PUBLIC (hallazgo 2, 2ª ronda siguiente)", () => {
  const mig156 = leer("supabase/migrations/20260601000156_empaquetados.sql");

  test("revoke all ... from public + grant execute ... to authenticated, en ese orden, inmediatamente después de crear la función", () => {
    const inicioFn = mig156.indexOf("create or replace function public.acceso_ventas_vuelo_sistema");
    const inicioVista = mig156.indexOf("create or replace view public.ventas_vuelo_sistema");
    const bloque = mig156.slice(inicioFn, inicioVista);
    const idxRevoke = bloque.indexOf("revoke all on function public.acceso_ventas_vuelo_sistema(text) from public;");
    const idxGrant = bloque.indexOf("grant execute on function public.acceso_ventas_vuelo_sistema(text) to authenticated;");
    assert.ok(idxRevoke > 0, "debe existir el revoke all ... from public");
    assert.ok(idxGrant > 0, "debe existir el grant execute ... to authenticated");
    assert.ok(idxRevoke < idxGrant, "el revoke debe ir ANTES del grant (revocar todo, luego otorgar el mínimo)");
    assert.ok(idxGrant < bloque.length, "ambos deben ocurrir ANTES de crear la vista que depende de la función");
  });

  test("nunca se otorga EXECUTE a anon — el mínimo indispensable es SOLO authenticated", () => {
    const inicioFn = mig156.indexOf("create or replace function public.acceso_ventas_vuelo_sistema");
    const inicioVista = mig156.indexOf("create or replace view public.ventas_vuelo_sistema");
    const bloque = mig156.slice(inicioFn, inicioVista);
    assert.doesNotMatch(bloque, /grant execute.*to anon/, "nunca debe otorgarse EXECUTE a anon");
    assert.doesNotMatch(bloque, /grant execute.*to public/i, "nunca debe volver a otorgarse a PUBLIC");
  });

  test("rollback_156: dropea la función DESPUÉS de dropear la vista (la vista depende de la función) — el revoke/grant desaparecen solos con el DROP FUNCTION", () => {
    const rollback156 = leer("supabase/scripts/rollback_156_empaquetados.sql");
    const idxDropVista = rollback156.indexOf("drop view if exists public.ventas_vuelo_sistema;");
    const idxDropFn = rollback156.indexOf("drop function if exists public.acceso_ventas_vuelo_sistema(text);");
    assert.ok(idxDropVista > 0 && idxDropFn > 0 && idxDropVista < idxDropFn, "orden correcto de dependencias: vista antes que función");
  });
});
