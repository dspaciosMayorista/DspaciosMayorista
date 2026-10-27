-- ───────────────────────────────────────────────────────────────────────────
-- 249 · PREFLIGHT INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre ANTES de la 249. Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple lo esperado · REVISAR = hay que mirar antes de aplicar · INFO = dato (se compara con el postcheck).
-- No imprime filas de negocio: solo conteos y una huella.
-- ───────────────────────────────────────────────────────────────────────────
with
cot as (select c.id, c.payload from public.cotizaciones c),
con_manuales as (select id, payload from cot where jsonb_typeof(payload) = 'object' and payload ? 'manuales'),
manuales_sin_impuesto as (
  select count(*) as n
    from con_manuales c,
         jsonb_array_elements(case when jsonb_typeof(c.payload -> 'manuales') = 'array' then c.payload -> 'manuales' else '[]'::jsonb end) m
   where not (m ? 'impuestoNoComisionable')
),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'tabla_cotizaciones_presente', (to_regclass('public.cotizaciones') is not null)::text, 'true',
         case when to_regclass('public.cotizaciones') is not null then 'OK' else 'REVISAR' end
  union all
  select 2, 'migracion_249_no_aplicada',
         (to_regprocedure('public.tg_cot_manuales_inmutables()') is null
          and not exists (select 1 from pg_trigger where tgname = 'trg_cot_manuales_inmutables' and not tgisinternal))::text,
         'true',
         case when to_regprocedure('public.tg_cot_manuales_inmutables()') is null
                   and not exists (select 1 from pg_trigger where tgname = 'trg_cot_manuales_inmutables' and not tgisinternal) then 'OK' else 'REVISAR' end
  union all
  -- La 249 convive con el disparador de la 238 (payload.b2bAsistido): se espera que esté.
  select 3, 'disparador_238_presente',
         exists (select 1 from pg_trigger where tgname = 'trg_cot_b2b_asistido_inmutable' and not tgisinternal)::text, 'true',
         case when exists (select 1 from pg_trigger where tgname = 'trg_cot_b2b_asistido_inmutable' and not tgisinternal) then 'OK' else 'REVISAR' end
  union all
  select 4, 'cotizaciones_total', (select count(*) from cot)::text, 'igual en el postcheck', 'INFO'
  union all
  -- El servicio manual (#64) aún no se publica: lo esperado es 0. Si hay alguna, quedará congelada tal como está.
  select 5, 'cotizaciones_con_bloque_manuales', (select count(*) from con_manuales)::text, '0 (si hay, quedan congeladas tal cual)',
         case when (select count(*) from con_manuales) = 0 then 'OK' else 'INFO' end
  union all
  -- Un manual sin `impuestoNoComisionable` (guardado antes de ese campo) no se podrá convertir: habría que recotizarlo.
  select 6, 'manuales_sin_impuesto_no_comisionable', (select n from manuales_sin_impuesto)::text, '0',
         case when (select n from manuales_sin_impuesto) = 0 then 'OK' else 'REVISAR' end
  union all
  select 7, 'huella_de_payload_que_la_249_no_debe_tocar',
         md5(coalesce((select string_agg(id::text || ':' || md5(coalesce(payload::text, '')), '|' order by id) from cot), '')),
         'igual en el postcheck', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
