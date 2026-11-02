-- ─────────────────────────────────────────────────────────────────────────────
-- POSTCHECK 269 · Canal WhatsApp de SalesBot (#56). SOLO LECTURA, UNA sola consulta.
-- Pegar completo en el editor SQL de Supabase DESPUÉS de correr la 269. Una fila por control
-- (control · valor · esperado · estado OK/REVISAR) y una última fila `RESUMEN` = VERIFICACION_OK | VERIFICACION_REVISAR.
-- Permisos: se comprueban con has_table_privilege para anon, authenticated y service_role en LAS TRES tablas.
-- ─────────────────────────────────────────────────────────────────────────────
with t(tabla) as (values ('salesbot_wa_mensajes'), ('salesbot_wa_sesiones'), ('salesbot_wa_traspasos')),
priv(privilegio) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')),
columnas_esperadas(tabla, columna) as (values
  ('salesbot_wa_mensajes', 'mensaje_id'), ('salesbot_wa_mensajes', 'wa_id'), ('salesbot_wa_mensajes', 'estado'), ('salesbot_wa_mensajes', 'intentos'),
  ('salesbot_wa_mensajes', 'lease_hasta'), ('salesbot_wa_mensajes', 'primer_recibo'), ('salesbot_wa_mensajes', 'resultado'), ('salesbot_wa_mensajes', 'enviados'),
  ('salesbot_wa_mensajes', 'actualizado'), ('salesbot_wa_mensajes', 'ts'),
  ('salesbot_wa_sesiones', 'wa_id'), ('salesbot_wa_sesiones', 'estado'), ('salesbot_wa_sesiones', 'traspaso_hasta'), ('salesbot_wa_sesiones', 'actualizada'), ('salesbot_wa_sesiones', 'lock_por'), ('salesbot_wa_sesiones', 'lock_hasta'), ('salesbot_wa_sesiones', 'ultimo_ts'),
  ('salesbot_wa_sesiones', 'ultimo_mensaje'),
  ('salesbot_wa_traspasos', 'id'), ('salesbot_wa_traspasos', 'mensaje_id'), ('salesbot_wa_traspasos', 'wa_id'), ('salesbot_wa_traspasos', 'nombre_perfil'),
  ('salesbot_wa_traspasos', 'resumen'), ('salesbot_wa_traspasos', 'creado'), ('salesbot_wa_traspasos', 'avisado_en'), ('salesbot_wa_traspasos', 'aviso_intentos'), ('salesbot_wa_traspasos', 'aviso_proximo'), ('salesbot_wa_traspasos', 'atendido_en'),
  ('salesbot_wa_traspasos', 'atendido_por')
),
controles as (
  -- 1. Existen las tres tablas.
  select 10 as orden, 'tabla existe: ' || t.tabla as control,
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname = t.tabla) as valor,
         '1' as esperado
  from t
  union all
  -- 2. Cada columna esperada existe (una fila por tabla con las que faltan).
  select 20, 'columnas completas: ' || t.tabla,
         coalesce((select string_agg(e.columna, ', ') from columnas_esperadas e
                    where e.tabla = t.tabla and not exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = e.tabla and k.column_name = e.columna)), 'ninguna falta'),
         'ninguna falta'
  from t
  union all
  -- 3. RLS activa (y no FORCE: el service-role la salta por diseño).
  select 30, 'RLS activa: ' || t.tabla,
         coalesce((select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t.tabla), 'NO EXISTE'),
         'true'
  from t
  union all
  -- 4. Sin ninguna policy: nadie, salvo el servidor, las lee ni las escribe.
  select 40, 'policies: ' || t.tabla,
         (select count(*)::text from pg_policies p where p.schemaname = 'public' and p.tablename = t.tabla),
         '0'
  from t
  union all
  -- 5. PERMISOS. anon y authenticated: ningún privilegio de tabla (lista los que sobran).
  select 50, 'privilegios de ' || r.rol || ' sobre ' || t.tabla,
         coalesce((select string_agg(p.privilegio, ', ') from priv p
                    where case when to_regclass('public.' || t.tabla) is null then false else has_table_privilege(r.rol, 'public.' || t.tabla, p.privilegio) end), 'ninguno'),
         'ninguno'
  from t cross join (values ('anon'), ('authenticated')) as r(rol)
  union all
  -- 6. service_role sí debe poder leer y escribir (lo usa el servidor); lista los que FALTAN.
  select 60, 'privilegios de service_role sobre ' || t.tabla,
         coalesce((select string_agg(u.priv, ', ') from unnest(array['SELECT', 'INSERT', 'UPDATE']) as u(priv)
                    where case when to_regclass('public.' || t.tabla) is null then true else not has_table_privilege('service_role', 'public.' || t.tabla, u.priv) end), 'completos'),
         'completos'
  from t
  union all
  -- 7. Idempotencia: mensaje_id es único en traspasos (un reintento no duplica la solicitud).
  select 70, 'UNIQUE(mensaje_id) en salesbot_wa_traspasos',
         (select count(*)::text from pg_index i where i.indrelid = to_regclass('public.salesbot_wa_traspasos') and i.indisunique and not i.indisprimary
            and (select array_agg(a.attname::text) from pg_attribute a where a.attrelid = i.indrelid and a.attnum = any (i.indkey)) = array['mensaje_id']),
         '1'
  union all
  -- 8. estado de la bandeja limitado a sus tres valores.
  select 80, 'CHECK de estado en salesbot_wa_mensajes',
         (select count(*)::text from pg_constraint k where k.conrelid = to_regclass('public.salesbot_wa_mensajes') and k.contype = 'c'
            and pg_get_constraintdef(k.oid) like '%procesando%' and pg_get_constraintdef(k.oid) like '%completado%' and pg_get_constraintdef(k.oid) like '%abandonado%'),
         '1'
  union all
  -- 9. Índice de cola de traspasos sin avisar.
  select 90, 'índice de traspasos sin avisar',
         (select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'salesbot_wa_traspasos_sin_avisar'),
         '1'
  union all
  -- 10. Sin triggers de auditoría (registrarían cada turno de cada cliente).
  select 100, 'triggers de auditoría en las tres tablas',
         (select count(*)::text from pg_trigger g where not g.tgisinternal and g.tgrelid in
            (to_regclass('public.salesbot_wa_mensajes'), to_regclass('public.salesbot_wa_sesiones'), to_regclass('public.salesbot_wa_traspasos'))),
         '0'
),
evaluado as (
  select orden, control, valor, esperado, case when valor = esperado then 'OK' else 'REVISAR' end as estado from controles
)
select orden, control, valor, esperado, estado from evaluado
union all
select 999, 'RESUMEN', count(*) filter (where estado <> 'OK')::text || ' control(es) por revisar', '0',
       case when count(*) filter (where estado <> 'OK') = 0 then 'VERIFICACION_OK' else 'VERIFICACION_REVISAR' end
from evaluado
order by orden, control;
