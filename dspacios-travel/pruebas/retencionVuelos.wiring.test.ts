// Cableado de la retención en plazo SIN contrato (migración 201, decisión del
// dueño): liberación solo manual, aviso con la misma regla que la base,
// versión de la silla al liberar, validación de pasajero + plazo al capturar,
// y el cron / liberar_vencidas sin tocar retenciones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const M201 = leer("supabase/migrations/20260601000201_pasajero_antes_contrato_vuelos.sql");

test("el cron y liberar_vencidas siguen atendiendo SOLO contratos pendientes", () => {
  assert.doesNotMatch(M201, /function public\.liberar_vencidas/i, "la 201 no redefine liberar_vencidas (sigue la de la 196)");
  for (const rel of ["lib/reservar/liberarVencidas.ts", "app/api/cron/liberar-vencidas/route.ts"]) {
    assert.doesNotMatch(leer(rel), /retenci|liberar_retencion_vencida/i, `${rel} no libera retenciones`);
  }
  assert.match(M201, /create or replace function public\.liberar_retencion_vencida\(p_silla_id bigint, p_esperado jsonb\)/);
  assert.match(M201, /grant execute on function public\.liberar_retencion_vencida\(bigint, jsonb\) to authenticated;/);
  assert.match(M201, /if not public\._retencion_vencida\(v_s\.plazo, v_hoy\) then/, "vence solo con plazo < fecha de negocio (el propio día no vence)");
  assert.match(M201, /v_hoy date := public\.fecha_negocio\(now\(\)\)/, "la fecha de corte es la de negocio de Bogotá");
});

test("la acción Liberar manda la versión que mostró la pantalla", () => {
  const acciones = leer("app/(dashboard)/dashboard/vuelos/actions.ts");
  assert.match(acciones, /export async function liberarRetencionVencida\(sillaId: number, bloqueoId: number, version: string\)/);
  assert.match(acciones, /rpc\("liberar_retencion_vencida", \{ p_silla_id: sillaId, p_esperado: \{ updated_at: version \} \}\)/);
});

test("el record identifica las vencidas con la misma regla y ofrece Liberar solo en ellas", () => {
  const pagina = leer("app/(dashboard)/dashboard/vuelos/[id]/page.tsx");
  assert.match(pagina, /responsable_menor, updated_at"\)/, "lee updated_at para la versión");
  assert.match(pagina, /esRetencionVencida\(\{ \.\.\.s, contrato_manual: contratoManualPorSilla\.get\(s\.id\) \?\? null \}, hoyNegocio\)/,
    "usa el contrato manual REAL y el día de negocio");
  assert.match(pagina, /const hoyNegocio = fechaNegocio\(\);/);
  assert.match(pagina, /\{retencionVencida\(s\) && \(\s*<LiberarRetencion/, "Liberar solo en filas vencidas");
  assert.match(pagina, /version=\{s\.updated_at\}/);
  assert.match(pagina, /data-testid="aviso-retenciones-vencidas"/);
  assert.match(leer("app/(dashboard)/dashboard/vuelos/[id]/LiberarRetencion.tsx"), /<ConfirmDialog/, "confirmación propia de la app");
});

test("el aviso de Vuelos cuenta con la misma regla que la base", () => {
  const vuelos = leer("app/(dashboard)/dashboard/vuelos/page.tsx");
  assert.match(vuelos,
    /\.eq\("estado", "en_plazo"\)\.is\("numero_contrato", null\)\.is\("contrato_manual", null\)\s*\.lt\("plazo", fechaNegocio\(\)\)/,
    "en_plazo, sin contrato orgánico ni manual, plazo ANTERIOR al día de negocio");
  assert.match(vuelos, /data-testid="aviso-retenciones-vencidas"/);
});

test("capturar sin contrato exige pasajero y plazo antes de llamar a la base", () => {
  const comp = leer("app/(dashboard)/dashboard/vuelos/[id]/PasajeroAcciones.tsx");
  const iValida = comp.indexOf("const motivo = validarRetencion(form, inicial.plazo || null);");
  const iEditar = comp.indexOf("await editarPasajeroSilla(sillaId, bloqueoId, form, contratoVisto)");
  assert.ok(iValida > 0 && iEditar > iValida, "la validación va antes de la llamada");
  assert.match(comp, /if \(sinContrato\) \{/);
  const acciones = leer("app/(dashboard)/dashboard/vuelos/actions.ts");
  assert.match(acciones, /if \(!reFecha\.test\(plazo\)\) \{ errores\.push\(`Fila \$\{linea\}: sin fecha de plazo/, "la carga masiva exige plazo");
  assert.match(acciones, /if \(plazo < hoyNegocio\)/, "y que no haya pasado");
  assert.match(leer("app/(dashboard)/dashboard/vuelos/pasajeros/page.tsx"), /\{ key: "plazo", label: "Plazo \(AAAA-MM-DD\)"/);
});

test("una retención acepta contrato manual (lo confirma) en la base y en la pantalla", () => {
  assert.match(M201, /not in \('disponible', 'cambio_entrante', 'en_plazo'\) then\s*raise exception using errcode = 'P0001', message = 'Solo se asigna un contrato manual a un cupo disponible o retenido en plazo, sin contrato\.';/);
  assert.match(leer("app/(dashboard)/dashboard/vuelos/[id]/SillaContrato.tsx"),
    /estado !== "disponible" && estado !== "cambio_entrante" && estado !== "en_plazo"/);
});

test("una retención VENCIDA no recibe contrato hasta actualizar el plazo (base y pantalla, misma regla)", () => {
  assert.match(M201, /create or replace function public\._retencion_vencida\(p_plazo date, p_hoy date\)/);
  assert.match(M201, /select p_plazo is not null and p_hoy is not null and p_plazo < p_hoy/, "vence solo con plazo < día de negocio");
  assert.match(M201, /if v_s\.estado::text = 'en_plazo' and public\._retencion_vencida\(v_s\.plazo, public\.fecha_negocio\(now\(\)\)\) then/,
    "el núcleo de asignar (firma vieja y nueva) rechaza la retención vencida");
  assert.match(M201, /if not public\._retencion_vencida\(v_s\.plazo, v_hoy\) then/, "la liberación usa la misma definición");
  const pagina = leer("app/(dashboard)/dashboard/vuelos/[id]/page.tsx");
  assert.match(pagina, /vencida=\{retencionVencida\(s\)\}/, "la celda de contrato sabe si la retención venció");
  assert.match(leer("app/(dashboard)/dashboard/vuelos/[id]/SillaContrato.tsx"), /if \(vencida\) \{/);
});

test("las firmas sin versión quedan registradas para poder retirarlas con evidencia", () => {
  assert.match(M201, /create table if not exists public\.vuelos_firmas_antiguas_uso/);
  for (const firma of ["liberar_silla(bigint)", "asignar_contrato_manual(bigint,text)", "editar_pasajero_silla sin esperado.updated_at"]) {
    assert.ok(M201.includes(`perform public._registrar_firma_antigua('${firma}', p_silla_id);`), `registra el uso de ${firma}`);
  }
});
