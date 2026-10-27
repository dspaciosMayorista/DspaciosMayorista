-- ───────────────────────────────────────────────────────────────────────────
-- 249 · POSTCHECK INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre DESPUÉS de la 249. Columnas: control · valor · esperado · estado.
-- Compara 'cotizaciones_total' y 'huella_de_payload...' con las del preflight (deben ser idénticas: la 249 no escribe datos).
-- ───────────────────────────────────────────────────────────────────────────
with
cot as (select c.id, c.payload from public.cotizaciones c),
trg as (
  select t.tgenabled, t.tgtype
    from pg_trigger t
   where t.tgname = 'trg_cot_manuales_inmutables' and t.tgrelid = 'public.cotizaciones'::regclass and not t.tgisinternal
),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'funcion_presente', (to_regprocedure('public.tg_cot_manuales_inmutables()') is not null)::text, 'true',
         case when to_regprocedure('public.tg_cot_manuales_inmutables()') is not null then 'OK' else 'REVISAR' end
  union all
  select 2, 'disparador_presente_y_habilitado', coalesce((select tgenabled::text from trg), 'ausente'), 'O',
         case when coalesce((select tgenabled::text from trg), '') = 'O' then 'OK' else 'REVISAR' end
  union all
  -- ROW (1) + BEFORE (2) + UPDATE (16) = 19, sin INSERT (4) ni DELETE (8).
  select 3, 'disparador_before_row_update_solamente', coalesce((select tgtype::text from trg), 'ausente'), '19',
         case when coalesce((select tgtype::int from trg), -1) = 19 then 'OK' else 'REVISAR' end
  union all
  select 4, 'funcion_no_ejecutable_por_roles_de_la_api',
         (has_function_privilege('anon', 'public.tg_cot_manuales_inmutables()', 'EXECUTE')
          or has_function_privilege('authenticated', 'public.tg_cot_manuales_inmutables()', 'EXECUTE'))::text,
         'false',
         case when not (has_function_privilege('anon', 'public.tg_cot_manuales_inmutables()', 'EXECUTE')
                        or has_function_privilege('authenticated', 'public.tg_cot_manuales_inmutables()', 'EXECUTE')) then 'OK' else 'REVISAR' end
  union all
  select 5, 'disparador_238_sigue_presente',
         exists (select 1 from pg_trigger where tgname = 'trg_cot_b2b_asistido_inmutable' and not tgisinternal)::text, 'true',
         case when exists (select 1 from pg_trigger where tgname = 'trg_cot_b2b_asistido_inmutable' and not tgisinternal) then 'OK' else 'REVISAR' end
  union all
  select 6, 'cotizaciones_total', (select count(*) from cot)::text, 'igual al preflight', 'INFO'
  union all
  select 7, 'huella_de_payload_que_la_249_no_debe_tocar',
         md5(coalesce((select string_agg(id::text || ':' || md5(coalesce(payload::text, '')), '|' order by id) from cot), '')),
         'igual al preflight', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
