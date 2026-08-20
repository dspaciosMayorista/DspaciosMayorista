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
// de Empaquetados (migraciones 155/156/157). Estas pruebas cubren lo que
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

// ── Ventana de transición 155→157 (defecto 1, revisión de PR #268) ─────────
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
    "la 155 transitoria NO debe convertir el dato 'individual'→'serie' — eso es responsabilidad exclusiva de la 157 (cierre), después del despliegue (el RPC sí contiene un UPDATE, pero es su comportamiento normal en tiempo de ejecución, no una conversión de datos históricos)"
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
  assert.doesNotMatch(mig155, /raise exception '155 FALLÓ/, "la 155 ya no es la migración que cierra el dominio — ese bloque vive en la 157");
});

const rollback155 = leer("supabase/scripts/rollback_155_modalidad_emision_serie.sql");
test("rollback 155 (transitoria): transaccional, CIERRA de vuelta a individual/grupo (deshace la ampliación) — no convierte datos porque la 155 tampoco los tocó", () => {
  assert.match(rollback155, /^begin;/m);
  assert.match(rollback155, /^commit;/m);
  assert.match(rollback155, /check \(modalidad_emision in \('individual', 'grupo'\)\)/, "el rollback debe cerrar el CHECK de vuelta a individual/grupo");
  assert.match(rollback155, /p_modalidad_emision not in \('individual', 'grupo'\)/, "el rollback debe restaurar el dominio viejo del RPC");
});

// ───────────────────────────────────────────────────────────────────────────
// Migración 157 — CIERRE (posterior al despliegue, revisión de PR #268 defecto 1)
// ───────────────────────────────────────────────────────────────────────────
const mig157 = leer("supabase/migrations/20260601000157_modalidad_emision_serie_cierre.sql");

test("migración 157 (cierre): corre en transacción explícita, renombra el 'individual' remanente a 'serie', y CIERRA el CHECK a solo serie/grupo", () => {
  assert.match(mig157, /^begin;/m);
  assert.match(mig157, /^commit;/m);
  assert.match(
    mig157,
    /update public\.bloqueos_vuelo\s*\n\s*set modalidad_emision = 'serie'\s*\n\s*where modalidad_emision = 'individual';/,
    "el UPDATE de cierre no tiene exactamente esta forma (solo 'individual' → 'serie')"
  );
  assert.match(mig157, /check \(modalidad_emision in \('serie', 'grupo'\)\)/, "el CHECK de cierre no es exactamente serie/grupo");
});

test("migración 157 (cierre): reemplaza el RPC a solo serie/grupo (cierra el dominio también ahí, no solo en la tabla)", () => {
  const inicio = mig157.indexOf("create or replace function public.actualizar_control_bloqueo");
  assert.notEqual(inicio, -1, "la 157 no reemplaza el RPC");
  const fin = mig157.indexOf("comment on function public.actualizar_control_bloqueo", inicio);
  const fn = mig157.slice(inicio, fin > inicio ? fin : undefined);
  assert.match(fn, /p_modalidad_emision not in \('serie', 'grupo'\)/, "el RPC de cierre sigue validando contra individual/grupo");
  assert.doesNotMatch(fn, /'individual'/, "el RPC de cierre todavía menciona 'individual' en algún lado (validación o etiqueta del historial)");
});

test("migración 157 (cierre): verifica al final que no quede ninguna fila en 'individual' ni fuera de serie/grupo/null — aborta si no cuadra", () => {
  assert.match(mig157, /raise exception '157 FALLÓ/);
  assert.match(mig157, /modalidad_emision = 'individual'/);
});

test("migración 157 (cierre): el comentario de despliegue advierte NO correrla en el mismo despliegue que la 155/156", () => {
  assert.match(mig157, /NO CORRER en el mismo despliegue/i);
});

const rollback157 = leer("supabase/scripts/rollback_157_modalidad_emision_serie_cierre.sql");
test("rollback 157 (cierre): transaccional, REABRE el CHECK/RPC a individual/serie/grupo (misma fase transitoria de la 155)", () => {
  assert.match(rollback157, /^begin;/m);
  assert.match(rollback157, /^commit;/m);
  assert.match(rollback157, /check \(modalidad_emision in \('individual', 'serie', 'grupo'\)\)/);
  assert.match(rollback157, /p_modalidad_emision not in \('individual', 'serie', 'grupo'\)/);
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
  assert.match(paso7, /if \(\(origen\.tipo === "bloqueo" \|\| origen\.tipo === "empaquetado"\) && datosVuelo\) \{/);
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
    assert.match(datosSrc, /import \{ empaquetadoVigente, hoyBogota \} from "@\/lib\/reservar\/origen";/);
  });

  test("desactivado DESPUÉS de generar: el filtro corre en LECTURA (esta función), no solo al regenerar — mismo mecanismo que activo", () => {
    assert.match(bloque, /e\.activo && empaquetadoVigente/);
  });

  test("FALLA CERRADA: si la consulta de vigencia devuelve error, TODAS las filas de empaquetado se ocultan (nunca se publica una tarifa sin verificar)", () => {
    assert.match(bloque, /const vigentes = empsError\s*\n\s*\? new Set<number>\(\)/);
  });

  test("FALLA CERRADA: sin SUPABASE_SERVICE_ROLE_KEY, las filas de empaquetado también se ocultan (antes se mostraban sin chequeo)", () => {
    assert.match(bloque, /if \(!process\.env\.SUPABASE_SERVICE_ROLE_KEY\) \{\s*\n\s*filas = filas\.filter\(\(f\) => f\.empaquetado_id == null\);/);
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

  test("incluye control_vuelo en el set de roles permitidos (el gap reportado)", () => {
    const vista = mig156.slice(mig156.indexOf("create or replace view public.ventas_vuelo_sistema"), mig156.indexOf("grant select on public.ventas_vuelo_sistema"));
    assert.match(vista, /'superadmin','gerencia','administracion','operaciones','control_vuelo'/);
  });

  test("filtra por tenant con puede_ver_tenant (aislamiento entre agencias)", () => {
    const vista = mig156.slice(mig156.indexOf("create or replace view public.ventas_vuelo_sistema"), mig156.indexOf("grant select on public.ventas_vuelo_sistema"));
    assert.match(vista, /and public\.puede_ver_tenant\(v\.tenant\);/);
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
