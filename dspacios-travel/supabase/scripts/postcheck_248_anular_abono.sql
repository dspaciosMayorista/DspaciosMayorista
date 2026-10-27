-- ───────────────────────────────────────────────────────────────────────────
-- 248 · POSTCHECK INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre DESPUÉS de la 248. Columnas: control · valor (observado) · esperado · estado.
--   Compara contra el preflight: abonos_total y la huella de abonos deben ser IGUALES (la 248 no borra ni cambia datos por sí sola).
-- ───────────────────────────────────────────────────────────────────────────
with
ab as (select id, numero_contrato, valor_abono, monto_cop from public.abonos),
fn as (select to_regprocedure('public.anular_abono(bigint,text,text,uuid,text)') as oid),
tg as (select count(*) as n from pg_trigger where tgrelid = to_regclass('public.abonos_anulados') and not tgisinternal),
f208 as (
  select count(*) as n from pg_trigger
   where not tgisinternal and tgenabled = 'O'
     and tgname in ('trg_f208_asiento_guarda_i', 'trg_f208_asiento_guarda_u', 'trg_f208_asiento_guarda_d', 'trg_f208_linea_guarda')
),
descuadre as (
  select count(*) as n from (select asiento_id from public.asiento_lineas group by asiento_id having sum(debe) <> sum(haber)) x
),
huerfanos as (
  select count(*) as n from public.asientos_contables a
   where a.origen = 'abono' and a.referencia ~ '^abono:[0-9]+$'
     and not exists (select 1 from public.abonos b where 'abono:' || b.id = a.referencia)
     and not exists (select 1 from public.abonos_anulados z where 'abono:' || z.abono_id = a.referencia)
),
permisos as (
  select (select oid from fn) is not null
     and has_function_privilege('service_role', (select oid from fn), 'execute')
     and not has_function_privilege('anon', (select oid from fn), 'execute')
     and not has_function_privilege('authenticated', (select oid from fn), 'execute') as ok
),
reg as (select to_regprocedure('public.registrar_abono(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid)') as oid),
permisos_reg as (
  select (select oid from reg) is not null
     and has_function_privilege('service_role', (select oid from reg), 'execute')
     and not has_function_privilege('anon', (select oid from reg), 'execute')
     and not has_function_privilege('authenticated', (select oid from reg), 'execute') as ok
),
marca as (
  select p.prosrc ~ 'es_rpc_registro_abono' as con_excepcion, p.prosrc ~ 'current_user <> ''service_role''' as conserva_regla_208
    from pg_proc p where p.oid = to_regprocedure('public.f208_abonos_marca()')
),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'tabla_abonos_anulados_existe', (to_regclass('public.abonos_anulados') is not null)::text, 'true',
         case when to_regclass('public.abonos_anulados') is not null then 'OK' else 'REVISAR' end
  union all
  select 2, 'abonos_anulados_con_rls', coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.abonos_anulados')), 'no existe'), 'true',
         case when coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.abonos_anulados')), false) then 'OK' else 'REVISAR' end
  union all
  select 3, 'abonos_anulados_sin_escritura_para_anon_authenticated',
         (not has_table_privilege('anon', 'public.abonos_anulados', 'select,insert,update,delete')
          and not has_table_privilege('authenticated', 'public.abonos_anulados', 'insert,update,delete'))::text, 'true',
         case when not has_table_privilege('anon', 'public.abonos_anulados', 'select,insert,update,delete')
               and not has_table_privilege('authenticated', 'public.abonos_anulados', 'insert,update,delete') then 'OK' else 'REVISAR' end
  union all
  select 4, 'huella_append_only (triggers update/delete + truncate)', (select n from tg)::text, '2', case when (select n from tg) = 2 then 'OK' else 'REVISAR' end
  union all
  select 5, 'anular_abono_solo_service_role', (select ok from permisos)::text, 'true', case when (select ok from permisos) then 'OK' else 'REVISAR' end
  union all
  select 6, 'guarda_F4415_intacta (trigger de borrado de abonos activo)',
         exists (select 1 from pg_trigger where tgrelid = 'public.abonos'::regclass and tgname = 'trg_f208_abonos_borrar' and tgenabled = 'O')::text, 'true',
         case when exists (select 1 from pg_trigger where tgrelid = 'public.abonos'::regclass and tgname = 'trg_f208_abonos_borrar' and tgenabled = 'O') then 'OK' else 'REVISAR' end
  union all
  select 7, 'guardas_de_asientos_intactas (3 de asiento + 1 de lineas)', (select n from f208)::text, '4', case when (select n from f208) = 4 then 'OK' else 'REVISAR' end
  union all
  select 8, 'abonos_total', (select count(*) from ab)::text, 'igual al preflight', 'INFO'
  union all
  select 9, 'huella_de_abonos', md5(coalesce((select string_agg(id || ':' || numero_contrato || ':' || coalesce(valor_abono::text, '') || ':' || coalesce(monto_cop::text, ''), '|' order by id) from ab), '')),
         'igual al preflight', 'INFO'
  union all
  select 10, 'libro_descuadrado_asientos (debe ser 0)', (select n from descuadre)::text, '0', case when (select n from descuadre) = 0 then 'OK' else 'REVISAR' end
  union all
  select 11, 'asientos_de_abono_huerfanos (sin abono vivo ni huella; debe ser 0)', (select n from huerfanos)::text, '0', case when (select n from huerfanos) = 0 then 'OK' else 'REVISAR' end
  union all
  select 12, 'registrar_abono_solo_service_role', (select ok from permisos_reg)::text, 'true', case when (select ok from permisos_reg) then 'OK' else 'REVISAR' end
  union all
  select 13, 'abono_operaciones_con_rls_y_sin_acceso_de_la_API',
         (coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.abono_operaciones')), false)
          and not has_table_privilege('anon', 'public.abono_operaciones', 'select,insert,update,delete')
          and not has_table_privilege('authenticated', 'public.abono_operaciones', 'select,insert,update,delete'))::text, 'true',
         case when coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.abono_operaciones')), false)
               and not has_table_privilege('anon', 'public.abono_operaciones', 'select,insert,update,delete')
               and not has_table_privilege('authenticated', 'public.abono_operaciones', 'select,insert,update,delete') then 'OK' else 'REVISAR' end
  union all
  select 14, 'f208_abonos_marca_con_la_excepcion_de_registrar_abono_y_la_regla_de_la_208',
         coalesce(((select con_excepcion from marca) and (select conserva_regla_208 from marca))::text, 'no existe'), 'true',
         case when coalesce((select con_excepcion and conserva_regla_208 from marca), false) then 'OK' else 'REVISAR' end
  union all
  select 15, 'operaciones_sin_abono_ni_huella (abono_operaciones huerfanas; debe ser 0)',
         (select count(*) from public.abono_operaciones o
           where not exists (select 1 from public.abonos b where b.id = o.abono_id)
             and not exists (select 1 from public.abonos_anulados z where z.abono_id = o.abono_id))::text, '0',
         case when (select count(*) from public.abono_operaciones o
           where not exists (select 1 from public.abonos b where b.id = o.abono_id)
             and not exists (select 1 from public.abonos_anulados z where z.abono_id = o.abono_id)) = 0 then 'OK' else 'REVISAR' end
)
select control, valor, esperado, estado from controles order by orden;
