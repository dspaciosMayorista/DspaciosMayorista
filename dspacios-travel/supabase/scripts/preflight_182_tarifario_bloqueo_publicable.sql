-- Preflight 182 — SOLO LECTURA. Corre ANTES de aplicar
-- 20260601000182_tarifario_bloqueo_publicable.sql.
-- Objetivo: confirmar que la migración (1 función + 1 policy reemplazada +
-- 1 vista nueva + 1 vista reemplazada) no pisa nada inesperado, que sus
-- dependencias (migraciones 018/162/181) ya están aplicadas, y dimensionar
-- el hallazgo P1-b (paquetes inactivos que pudieron quedar con
-- snapshot_publicable=true por el DEFAULT de la 181, sin haber disparado
-- ningún trigger de invalidación).

-- 1) Ni la vista ni la función nuevas deben existir todavía.
select relname, relkind
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'tarifario_resultado_publicable';
-- Esperado: 0 filas.

select proname, pg_get_function_identity_arguments(oid) as argumentos
from pg_proc
where pronamespace = 'public'::regnamespace and proname = 'tarifario_paquete_publicable';
-- Esperado: 0 filas.

-- 2) tarifario_resumen (migración 162) DEBE existir ya como vista — la 182 la
--    reemplaza con CREATE OR REPLACE, nunca la crea desde cero.
select relname, relkind
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'tarifario_resumen';
-- Esperado: 1 fila, relkind = 'v'.

-- 3) armado_paquetes.tarifario_snapshot_publicable/activo (migración 181)
--    deben existir — son las columnas que el helper y la vista usan como filtro.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'armado_paquetes'
  and column_name in ('tarifario_snapshot_publicable', 'activo')
order by column_name;
-- Esperado: 2 filas.

-- 4) La FK tarifario_resultado.paquete_id -> armado_paquetes(id) (migración
--    018) debe existir — es el join que usan el helper y la vista nueva.
select conname, confrelid::regclass as tabla_referenciada
from pg_constraint
where conrelid = 'public.tarifario_resultado'::regclass
  and contype = 'f'
  and confrelid = 'public.armado_paquetes'::regclass;
-- Esperado: al menos 1 fila.

-- 5) Policy VIGENTE de lectura de tarifario_resultado — debe ser todavía la
--    de la migración 018 ("for select using (true)"), la que esta migración
--    va a reemplazar. Si ya no lo es, alguien la tocó fuera de esta migración
--    y hay que revisar antes de aplicar.
select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'tarifario_resultado'
order by policyname;
-- Esperado: 2 filas — "tarifario_resultado: escritura" (ALL) y
-- "tarifario_resultado: lectura" (SELECT, qual = 'true').

-- 6) Confirmar el set de columnas EXACTO de tarifario_resultado — la vista
--    nueva hace `select r.*`, así que cualquier columna futura se propaga
--    sola; esto es solo un inventario de referencia para el diff.
select column_name, ordinal_position
from information_schema.columns
where table_schema = 'public' and table_name = 'tarifario_resultado'
order by ordinal_position;

-- 7) Volumen actual: filas totales vs. publicables-Y-activas (dimensiona
--    cuánto se ocultará al aplicar la migración). Ninguna fila se modifica.
select
  (select count(*) from public.tarifario_resultado) as filas_totales,
  (select count(*) from public.tarifario_resultado r
     join public.armado_paquetes ap on ap.id = r.paquete_id
     where ap.tarifario_snapshot_publicable = true and ap.activo = true) as filas_publicables_y_activas,
  (select count(*) from public.armado_paquetes where tarifario_snapshot_publicable = false) as paquetes_bloqueados,
  (select count(*) from public.armado_paquetes) as paquetes_totales;

-- 8) ⚠️ Hallazgo P1-b — dimensiona el caso concreto: paquetes YA INACTIVOS
--    con snapshot_publicable=true (el DEFAULT de la 181 nunca se corrigió
--    porque ningún UPDATE posterior disparó el trigger de invalidación). La
--    vista/policy de esta migración los oculta igual (exige `activo=true`
--    aparte), pero es información valiosa saber cuántos hay ANTES de aplicar
--    — si el número es alto, vale la pena que el dueño revise esos paquetes
--    por separado.
select count(*) as paquetes_inactivos_con_snapshot_publicable_true
from public.armado_paquetes
where activo = false and tarifario_snapshot_publicable = true;

-- 9) Confirmar las policies vigentes de armado_paquetes (sin cambios en esta
--    migración, pero es la referencia de qué roles se consideran "internos"
--    para la nueva policy de tarifario_resultado).
select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'armado_paquetes'
order by policyname;

-- 10) mi_rol() debe existir (dependencia de la nueva policy y del helper).
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = 'mi_rol';
-- Esperado: 1 fila.

-- 11) ⚠️ Segunda ronda de auditoría, hallazgo 1 (grant faltante para
--     service_role) — el rol debe existir en este entorno para poder
--     concederle SELECT sobre la vista nueva.
select rolname from pg_roles where rolname = 'service_role';
-- Esperado: 1 fila.

-- 12) Confirma que ningún lector real de tarifario_resumen usa
--     createAdminClient() (service_role) — referencia para NO agregarle ese
--     grant "por simetría" (ver el hallazgo 1: solo se concede donde hay un
--     lector real). Esta consulta es solo documentación operativa; no puede
--     verificar el código TypeScript desde SQL — el grep real se hizo en el
--     código y quedó documentado en la cabecera de la migración.
select 'confirmado por grep en el código (no verificable desde SQL): cargarFilasResumenPaginado (único lector de tarifario_resumen) siempre usa el cliente de sesión, nunca createAdminClient()' as nota;

-- 13) ⚠️ Tercera ronda de auditoría — ACL HISTÓRICA de tarifario_resumen para
--     TODOS los roles (no solo service_role). SOLO DIAGNÓSTICO: la migración
--     182 NO modifica ningún privilegio de esta vista para ningún rol distinto
--     de anon/authenticated (que ya tenían exactamente SELECT desde la 162) —
--     lo que sea que aparezca aquí para otros roles (típicamente privilegios
--     estructurales heredados de un default privilege del proyecto, nunca
--     otorgados a propósito por ninguna migración de este repo) es el estado
--     PREEXISTENTE, y debe seguir siendo idéntico después de aplicar Y después
--     de revertir la 182 — guarda esta salida para comparar en la validación
--     manual del round-trip (aplicar → confirmar sin cambio → rollback →
--     confirmar idéntico a esto). Un saneamiento de estos privilegios
--     históricos, si hiciera falta, es una migración aparte.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'tarifario_resumen'
order by grantee, privilege_type;
