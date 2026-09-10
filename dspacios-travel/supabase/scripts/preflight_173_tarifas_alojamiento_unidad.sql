-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT de la migración 173 (`public.hotel_tarifas_unidad`).
-- SOLO LECTURA — no modifica nada. Correr ANTES de aplicar la 173.
--
-- La 173 crea una tabla NUEVA, con una FK a `hoteles` y cuatro policies que se
-- apoyan en `mi_rol()`. No toca ninguna tabla existente ni escribe un solo
-- dato, así que las precondiciones son pocas pero no triviales:
--
--   1) `public.hoteles` existe y su PK `id` es **bigint** — es el destino de
--      la FK; si el tipo no coincide, el `create table` falla.
--   2) La tabla `hotel_tarifas_unidad` todavía NO existe. Si existe, la 173 ya
--      se aplicó (es idempotente: re-correrla es un no-op) — hay que averiguar
--      por qué se está corriendo de nuevo antes de hacerlo.
--   3) `public.mi_rol()` existe y devuelve el enum `rol_usuario` con el que
--      se compara en las policies. Sin ella, las cuatro policies quedan escritas
--      pero cualquier lectura falla al evaluarlas.
--   4) El nombre del índice no está ocupado por otra cosa.
--
-- NO comprueba datos Bernalo: no existen todavía y la 173 no carga ninguno.
-- La vigencia no se duplica aquí: `hotel_temporadas` sigue siendo el calendario
-- autoritativo, con rangos múltiples, blackouts y prioridad por hotel.
-- Los conteos de abajo son informativos, para poder comparar contra el
-- postcheck y confirmar que la migración no movió ninguna fila ajena.
--
--   psql -d <base> -v ON_ERROR_STOP=1 -f preflight_173_tarifas_alojamiento_unidad.sql
-- ───────────────────────────────────────────────────────────────────────────

\echo '=== 1) hoteles existe y hoteles.id es bigint (destino de la FK) ==='
select
  to_regclass('public.hoteles') is not null as tabla_hoteles_existe,
  c.data_type                             as tipo_hoteles_id,
  c.is_nullable                           as hoteles_id_nullable
from information_schema.columns c
where c.table_schema = 'public' and c.table_name = 'hoteles' and c.column_name = 'id';
\echo 'esperado: tabla_hoteles_existe = t | tipo_hoteles_id = bigint | hoteles_id_nullable = NO'
\echo 'si tipo_hoteles_id NO es bigint, la FK de la 173 falla — revisar antes de continuar'

\echo '=== 2) la tabla nueva todavía no existe ==='
select
  to_regclass('public.hotel_tarifas_unidad') is null   as tabla_aun_no_existe,
  (select count(*) from pg_class
    where relname = 'hotel_tarifas_unidad' and relkind = 'r') as objetos_con_ese_nombre;
\echo 'esperado: tabla_aun_no_existe = t (f = la 173 ya se aplicó; reaplicar es no-op, pero confirmar por qué)'

\echo '=== 3) mi_rol() existe, devuelve rol_usuario y es SECURITY DEFINER ==='
select
  to_regprocedure('public.mi_rol()') is not null as mi_rol_existe,
  coalesce(pg_get_function_result(to_regprocedure('public.mi_rol()')), '(no existe)') as mi_rol_retorna,
  coalesce(p.prosecdef, false) as mi_rol_es_security_definer
from (select 1) x
left join pg_proc p on p.oid = to_regprocedure('public.mi_rol()');
\echo 'esperado: mi_rol_existe = t | mi_rol_retorna = rol_usuario | mi_rol_es_security_definer = t'
\echo 'referencia: migraciones 005 y 140; SECURITY DEFINER evita recursión RLS al leer usuarios y la 140 devuelve null si el usuario está inactivo'

\echo '=== 4) el nombre del índice está libre (si no, el create index salta y hay que averiguar de quién es) ==='
select
  to_regclass('public.hotel_tarifas_unidad_hotel_estado_idx') is null as nombre_indice_libre;

\echo '=== 5) contexto: hoteles y usuarios por rol (informativo, para comparar contra el postcheck) ==='
select
  (select count(*) from public.hoteles) as hoteles_total;
select rol, count(*) as usuarios_activos
from public.usuarios
where activo is not false
group by rol
order by rol;
\echo 'esperado: entre los roles de arriba están superadmin/gerencia/administracion/operaciones (son los cuatro que la 173 habilita)'

\echo '=== 6) referencia: ninguna migración previa creó esta tabla (no debería haber historia) ==='
select count(*) as columnas_de_hotel_tarifas_unidad_ya_definidas
from information_schema.columns
where table_schema = 'public' and table_name = 'hotel_tarifas_unidad';
\echo 'esperado: 0 (si es > 0, la tabla ya existe: ver el punto 2)'
