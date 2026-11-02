-- ─────────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 269 · Canal WhatsApp de SalesBot (#56). SOLO LECTURA, UNA sola consulta.
-- La numeración (que el 269 siga libre) se confirma con `ls supabase/migrations | sort | tail` en la rama que se fusione: aquí no se lee
-- supabase_migrations porque quien pega SQL a mano puede no tenerla poblada.
-- Pegar completo en el editor SQL de Supabase ANTES de correr la 269. Devuelve una fila por control
-- (control · valor · esperado · estado OK/REVISAR) y una última fila `RESUMEN` = PREFLIGHT_OK | PREFLIGHT_REVISAR.
-- ─────────────────────────────────────────────────────────────────────────────
with controles as (
  -- 1. Ninguna de las tres tablas existe todavía (si existe alguna, la 269 no es «la primera vez»: revisar antes de seguir).
  select 1 as orden, 'tablas salesbot_wa_* ya existentes' as control,
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('salesbot_wa_mensajes', 'salesbot_wa_sesiones', 'salesbot_wa_traspasos')) as valor,
         '0' as esperado
  union all
  -- 2. La tabla que referencia la FK existe y su id es uuid.
  select 2, 'public.usuarios.id es uuid',
         coalesce((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'usuarios' and column_name = 'id'), 'NO EXISTE'),
         'uuid'
  union all
  -- 3. Los roles que usa el REVOKE existen (Supabase los trae siempre).
  select 3, 'roles anon, authenticated y service_role',
         (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role')),
         '3'
),
evaluado as (
  select orden, control, valor, esperado,
         case when valor = esperado then 'OK' else 'REVISAR' end as estado
  from controles
)
select orden, control, valor, esperado, estado from evaluado
union all
select 99, 'RESUMEN', count(*) filter (where estado <> 'OK')::text || ' control(es) por revisar', '0',
       case when count(*) filter (where estado <> 'OK') = 0 then 'PREFLIGHT_OK' else 'PREFLIGHT_REVISAR' end
from evaluado
order by orden;
