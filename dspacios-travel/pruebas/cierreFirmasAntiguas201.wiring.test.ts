// Firmas SIN versión de Vuelos que la 201 conserva para aplicar la migración
// antes que el código: liberar_silla(bigint), asignar_contrato_manual(bigint,text),
// quitar_contrato_manual(bigint) y la edición sin esperado.updated_at.
// Reglas del dueño: (1) nunca bloquear el código viejo antes de confirmar el
// despliegue nuevo; (2) nunca reabrir una firma que ya cerró; (3) el cierre se
// activa tras el despliegue, dentro de la propia 201 (sin migración nueva de
// Vuelos; los números siguientes son de otros módulos), con verificación HUMANA en Vercel porque la
// base no distingue Producción de un Preview; (4) el rollback total no deja
// retenciones sin gestión ni ofrece "conservar"; (5) ante un defecto SQL tras el
// cierre y antes de la 204: contener → hotfix fuera de banda → consolidar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const existe = (rel: string) => existsSync(new URL(`../${rel}`, import.meta.url));
const VUELOS = leer("app/(dashboard)/dashboard/vuelos/actions.ts");
const M201 = leer("supabase/migrations/20260601000201_pasajero_antes_contrato_vuelos.sql");
const FIRMAS_VIEJAS = ["liberar_silla(bigint)", "asignar_contrato_manual(bigint,text)", "quitar_contrato_manual(bigint)",
                       "editar_pasajero_silla sin esperado.updated_at"];

test("la app solo usa las firmas con versión (y quitar manda el plazo en la misma acción)", () => {
  const llamadas = [...VUELOS.matchAll(/rpc\("(liberar_silla|asignar_contrato_manual|quitar_contrato_manual|editar_contrato_manual)", \{([^}]*\}?[^)]*)\)/g)];
  assert.deepEqual(llamadas.map((m) => m[1]).sort(),
    ["asignar_contrato_manual", "editar_contrato_manual", "liberar_silla", "quitar_contrato_manual"], "una llamada a cada una");
  for (const m of llamadas) assert.match(m[2], /p_esperado: \{ updated_at: version \}/, `${m[1]} siempre con versión`);
  assert.match(VUELOS, /rpc\("quitar_contrato_manual", \{ p_silla_id: sillaId, p_plazo: plazo, p_esperado:/);
});

test("el cierre nace ABIERTO sin fecha: nada bloquea el código viejo antes de confirmar el despliegue", () => {
  assert.match(M201, /create table if not exists public\.vuelos_cierre_firmas_201/);
  assert.match(M201, /estado text not null default 'abierto'/);
  assert.match(M201, /insert into public\.vuelos_cierre_firmas_201 \(id\) values \(1\) on conflict \(id\) do nothing;/,
    "re-aplicar la 201 no toca el estado");
  assert.match(M201, /coalesce\(\(select c\.estado = 'cerrado' or \(c\.estado = 'programado' and now\(\) >= c\.cierra_en\)/);
  assert.match(M201, /from public\.vuelos_cierre_firmas_201 c where c\.id = 1\), false\)/, "sin fila: abiertas (nunca se cierra por omisión)");
  assert.doesNotMatch(M201, /interval '14 days'|marca:aplicada_201|_limite_firmas_antiguas/, "sin caducidad por fecha de aplicación");
  for (const firma of FIRMAS_VIEJAS) {
    assert.ok(M201.includes(`perform public._registrar_firma_antigua('${firma}', p_silla_id);`), `${firma} consulta el estado del cierre`);
  }
});

test("la llamada con versión es solo condición NECESARIA: puede venir de un Preview (misma base)", () => {
  assert.match(M201, /Todavía no hay ninguna llamada con versión registrada \(condición necesaria; no prueba por sí sola el despliegue en Producción\)/);
  assert.doesNotMatch(M201, /esa es la verificación de que el despliegue nuevo está vivo/);
  assert.match(M201, /new\.cierra_en < now\(\) \+ interval '3 days'/, "ventana mínima de 3 días");
  assert.equal((M201.match(/perform public\._registrar_firma_nueva\(\);/g) ?? []).length, 6,
    "editar con versión, asignar, quitar, editar referencia, liberar retención y Borrar con versión");
  assert.match(leer("supabase/scripts/cancelar_cierre_firmas_201.sql"), /select public\.cancelar_cierre_firmas_antiguas\(/);
});

test("activar exige la verificación HUMANA de Vercel: commit, Ready, dominio de Production y Previews resueltos", () => {
  const activar = leer("supabase/scripts/activar_cierre_firmas_201.sql");
  for (const campo of ["commit_produccion", "dominio_produccion", "deployment_ready", "commit_es_merge_201",
                       "celda_nueva_vista", "previews_resueltos", "verificado_por"]) {
    assert.ok(activar.includes(` as ${campo}`), `pide ${campo}`);
  }
  assert.match(activar, /'no'::text\s+as deployment_ready/, "nace sin verificar: hay que llenarla");
  assert.match(activar, /v\.commit_produccion !~ '\^\[0-9a-f\]\{7,40\}\$'/);
  assert.match(activar, /v\.dominio_produccion ~ '-git-'/, "rechaza dominios con forma de Preview");
  assert.match(activar, /v\.previews_resueltos <> 'si'/);
  assert.match(activar, /select public\.programar_cierre_firmas_antiguas\(\s*v\.dias_ventana,/);
  assert.match(activar, /Verificado en Vercel por %s/, "deja la verificación como constancia");
});

test("una firma cerrada NUNCA se reabre: trigger de solo-avance y rollback de la 201 que se niega", () => {
  assert.match(M201, /'Las firmas antiguas ya cerraron: no se reabren ni se reprograman\./);
  assert.match(M201, /before update or delete on public\.vuelos_cierre_firmas_201/);
  assert.match(M201, /before truncate on public\.vuelos_cierre_firmas_201/);
  const rb = leer("supabase/scripts/rollback_201_pasajero_antes_contrato_vuelos.sql");
  assert.match(rb, /if public\._firmas_antiguas_cerradas\(\) then\s*raise exception 'Las firmas antiguas ya cerraron: revertir la 201 las reabriría/);
  assert.match(rb, /El cierre de firmas antiguas está programado: cancelarlo antes/);
  for (const viejo of ["cierre_201_firmas_antiguas.sql", "rollback_cierre_201_firmas_antiguas.sql",
                       "postcheck_cierre_201_firmas_antiguas.sql", "marcar_despliegue_codigo_201.sql"]) {
    assert.ok(!existe(`supabase/scripts/${viejo}`), `${viejo} (diseño anterior, que reabría o usaba la 204) ya no existe`);
  }
});

// ── Guardia por INTENCIÓN, no por número ──────────────────────────────────
// Lo que se prohíbe es una migración NUEVA (posterior a la 201) que reabra o
// altere el cierre de firmas de Vuelos: el cierre se activa con scripts dentro
// de la 201 y un defecto se contiene y corrige fuera de banda. Las migraciones
// de OTROS módulos (202 CRM, 203 Tarifas, 204 Contabilidad, 205 Comisiones…)
// no se juzgan por su número.
const M201_NOMBRE = "20260601000201_pasajero_antes_contrato_vuelos.sql";
// Nombre: patrones específicos (ojo: "confirmar" contiene "firma").
const NOMBRE_CIERRE_VUELOS = /cierre[_-]?(de[_-])?firmas|firmas?[_-](viejas|antiguas|sin[_-]version)|vuelos[_-]cierre[_-]firmas|reabrir[_-].*firmas|hotfix[_-].*(vuelos|201|firmas)|(vuelos|201|firmas).*[_-]hotfix/i;
// Contenido: piezas del cierre creadas por la 201, o volver a dar EXECUTE a
// una firma vieja (eso la reabriría).
const PIEZAS_CIERRE = /vuelos_cierre_firmas_201|_firmas_antiguas_cerradas|_registrar_firma_antigua|_registrar_firma_nueva|programar_cierre_firmas_antiguas|cancelar_cierre_firmas_antiguas/i;
const REABRE_FIRMA_VIEJA = /grant\s+execute\s+on\s+function\s+public\.(liberar_silla\s*\(\s*bigint\s*\)|asignar_contrato_manual\s*\(\s*bigint\s*,\s*text\s*\)|quitar_contrato_manual\s*\(\s*bigint\s*\))/i;
const numeroMigracion = (f: string) => Number(/^(\d{14})_/.exec(f)?.[1] ?? NaN);

/** Motivo por el que `nombre`/`contenido` sería una migración nueva que toca el
 * cierre de firmas de Vuelos; `null` si no lo es. Solo juzga lo posterior a la 201. */
function motivoMigracionCierreVuelos(nombre: string, contenido: string): string | null {
  if (nombre === M201_NOMBRE || !(numeroMigracion(nombre) > numeroMigracion(M201_NOMBRE))) return null;
  if (NOMBRE_CIERRE_VUELOS.test(nombre)) return "su nombre indica cierre/hotfix de firmas de Vuelos";
  if (PIEZAS_CIERRE.test(contenido)) return "toca las piezas del cierre de firmas de la 201";
  if (REABRE_FIRMA_VIEJA.test(contenido)) return "vuelve a dar EXECUTE a una firma vieja de Vuelos";
  return null;
}

test("sin migración nueva que reabra o altere el cierre de firmas de Vuelos (guardia por intención, sobre el repo real)", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const malas = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => [f, motivoMigracionCierreVuelos(f, readFileSync(new URL(f, dir), "utf8"))] as const)
    .filter(([, motivo]) => motivo !== null);
  assert.deepEqual(malas, [], "ninguna migración posterior a la 201 toca el cierre de firmas");
});

test("la guardia NO juzga por número: migraciones de otros módulos (202–205) pasan", () => {
  const casos: [string, string][] = [
    ["20260601000202_crm_leads.sql", "create table if not exists public.crm_leads (id bigserial primary key, nombre text);"],
    ["20260601000203_tarifas_generacion_acotada_historial.sql", leer("supabase/migrations/20260601000203_tarifas_generacion_acotada_historial.sql")],
    ["20260601000204_staging_dian_contable.sql", "create table if not exists public.documento_dian_staging (id bigserial primary key);"],
    ["20260601000205_comisiones_b2b_base.sql", "alter table public.aliados_b2b add column if not exists base_comision_calculada numeric;"],
    ["20260601000206_hotfix_contabilidad.sql", "create or replace function public.x() returns int language sql as $$ select 1 $$;"],
    ["20260601000207_confirmar_venta_ajuste.sql", "select 1;"], // "confirmar" contiene "firma": no es del cierre
  ];
  for (const [nombre, contenido] of casos) {
    assert.equal(motivoMigracionCierreVuelos(nombre, contenido), null, nombre);
  }
});

test("la guardia SÍ rechaza una migración nueva de cierre de firmas de Vuelos (por nombre o por contenido)", () => {
  const casos: [string, string][] = [
    ["20260601000206_cierre_firmas_antiguas_vuelos.sql", "select 1;"],
    ["20260601000206_reabrir_firmas_vuelos.sql", "select 1;"],
    ["20260601000206_hotfix_vuelos_201.sql", "select 1;"],
    ["20260601000206_vuelos_ajuste.sql", "update public.vuelos_cierre_firmas_201 set estado = 'abierto' where id = 1;"],
    ["20260601000206_vuelos_ajuste.sql", "select public.cancelar_cierre_firmas_antiguas('motivo');"],
    ["20260601000206_vuelos_permisos.sql", "grant execute on function public.liberar_silla(bigint) to authenticated;"],
  ];
  for (const [nombre, contenido] of casos) {
    assert.notEqual(motivoMigracionCierreVuelos(nombre, contenido), null, `${nombre} :: ${contenido}`);
  }
  // La 201 y las anteriores (p. ej. la 194, que creó firmas viejas) no se juzgan.
  assert.equal(motivoMigracionCierreVuelos(M201_NOMBRE, M201), null);
  assert.equal(motivoMigracionCierreVuelos("20260601000194_traslado_sillas_atomico.sql",
    "grant execute on function public.liberar_silla(bigint) to authenticated;"), null);
});

test("salida post-cierre sin la 204: contención (nunca firmas viejas) y hotfix con guarda de hash", () => {
  const contener = leer("supabase/scripts/contener_funcion_201.sql");
  assert.doesNotMatch(contener, /when 'public\.(liberar_silla\(bigint\)|asignar_contrato_manual\(bigint,text\)|quitar_contrato_manual\(bigint\))'/,
    "la contención nunca toca ni reabre firmas viejas");
  assert.match(contener, /revoke execute on function %s from %I/);
  const hotfix = leer("supabase/scripts/plantilla_hotfix_201.sql");
  assert.match(hotfix, /if v_hash not in \(h\.hash_201, h\.hash_hotfix\) then/, "solo sobre el cuerpo de la 201 o ya corregido");
  assert.match(hotfix, /no toca las firmas viejas ni las piezas del cierre/);
  assert.match(hotfix, /El estado del cierre de firmas cambió durante el hotfix/);
  assert.match(hotfix, /REQUIERE AUTORIZACIÓN SEPARADA DEL DUEÑO PARA CADA INCIDENTE/);
  assert.match(hotfix, /'PEGAR_AUTORIZACION'::text as autorizacion/);
  assert.match(hotfix, /if coalesce\(btrim\(h\.autorizacion\), ''\) = '' or h\.autorizacion ~ '\^PEGAR_' then/, "sin autorización, se niega");
  assert.match(hotfix, /nunca un número reservado ni una 205 antes de la 204/, "la consolidación no usa reservados ni salta la 204");
  assert.doesNotMatch(hotfix, /PRIMERA migración libre\s*\n--\s*DESPUÉS de la 204/, "la 204 (Contabilidad) no se presenta como la siguiente de Vuelos");
  const doc = leer("docs/tecnico/vuelos-201-despliegue-y-cierre.md");
  assert.match(doc, /no se presenta como prueba de despliegue en Producción/);
  assert.match(doc, /Ya no existen\*\* \(no son opciones de rollback\)/);
});

test("runbook: decisiones del dueño tomadas y la 204 nunca como migración de Vuelos", () => {
  const doc = leer("docs/tecnico/vuelos-201-despliegue-y-cierre.md");
  assert.match(doc, /\*\*Activar el cierre después de verificar Producción\*\*, con \*\*ventana de 7 días\*\*/);
  assert.match(doc, /\*\*no está preautorizado\*\*\. Cada incidente requiere una\s*\n\s*\*\*autorización separada del dueño\*\*/);
  assert.match(doc, /204 \(Contabilidad\)\*\*\. Ninguno de ellos es de Vuelos/);
  assert.doesNotMatch(doc, /primera migración libre después de la 204/i, "la 204 no aparece como la próxima correctiva de Vuelos");
  assert.match(doc, /Confirmar que la 199 y la 200 están aplicadas en Producción/);
  assert.match(leer("supabase/scripts/activar_cierre_firmas_201.sql"), /7\s+as dias_ventana/, "ventana de 7 días por defecto");
});

test("rollback total: exige drenar retenciones por vías reales, sin 'conservar' ni contratos ficticios", () => {
  const rb = leer("supabase/scripts/rollback_201_pasajero_antes_contrato_vuelos.sql");
  assert.match(rb, /lock table public\.sillas in exclusive mode;/);
  assert.match(rb, /Quedan % retención\(es\) en plazo sin contrato/);
  assert.doesNotMatch(rb, /current_setting\('app\.rollback_201_retenciones'/, "no hay válvula 'conservar'");
  for (const f of ["programar_cierre_firmas_antiguas(integer, text)", "cancelar_cierre_firmas_antiguas(text)",
                   "_firmas_antiguas_cerradas()", "_registrar_firma_nueva()", "editar_contrato_manual(bigint, text, jsonb)"]) {
    assert.ok(rb.includes(`drop function if exists public.${f};`), `borra ${f}`);
  }
  const prep = leer("supabase/scripts/preparar_rollback_201_retenciones.sql");
  assert.match(prep, /NUNCA una\s*\n--\s*referencia inventada/);
  assert.match(prep, /BLOQUEA el rollback total/);
});

test("las 152 sillas G: decisión cerrada, sin backfill", () => {
  const pre = leer("supabase/scripts/preflight_201_retenciones.sql");
  assert.match(pre, /DECISIÓN CERRADA del dueño\s*\n--\s*\(152 en producción\): SIN backfill/);
  assert.doesNotMatch(M201, /^update public\.sillas/im, "la 201 no hace ningún backfill de sillas (el plazo solo se fija dentro de quitar)");
});
