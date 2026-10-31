-- PREFLIGHT 258 · SOLO LECTURA · UNA consulta integral: n · control · observado · esperado · veredicto.
-- Pegar COMPLETA en el editor SQL de Supabase, SIN envolver en begin/rollback (el editor solo muestra el resultado de la última sentencia).
-- Veredictos: OK · INFO · YA APLICADA (estado completo) · BLOQUEA / REVISAR (no aplicar). La ÚLTIMA fila (n = 99) es el VEREDICTO GLOBAL.
-- Orden acordado: 259 (ya aplicada) → 255 → 256 → 258. La 258 es ADITIVA (1 tabla + 1 función nuevas); no modifica ninguna definición existente. La 257 está reservada para B2B.
-- ⚠️ Fila 11: el código del hotfix RECHAZA cotizar y reservar cualquier salida publicada de bloqueo/dinámico que no tenga evidencia de la 258. La migración sola no
-- rompe nada (el código desplegado hoy ignora la tabla), pero tras desplegar el hotfix TODO paquete listado en la fila 11 queda sin venta hasta regenerar su tarifario.
with
hi as (select md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')), chr(13), '')) as h),
art as (
  select (to_regclass('public.tarifario_composicion_publicada') is not null)::int
       + (to_regprocedure('public.registrar_composicion_publicada(bigint,bigint,smallint,jsonb)') is not null)::int as n
),
a255 as (
  select (to_regclass('public.servicio_suplementos_franja') is not null)::int
       + (to_regprocedure('public.fn_franja_minutos(text)') is not null)::int
       + (to_regprocedure('public.fn_franja_contiene(integer,integer,integer)') is not null)::int
       + (to_regprocedure('public.tg_servicio_suplementos_franja_solape()') is not null)::int
       + (exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.servicio_suplementos_franja') and t.tgname = 'servicio_suplementos_franja_solape' and not t.tgisinternal))::int
       + (exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'servicio_suplementos_franja' and policyname = 'servicio_suplementos_franja: interno'))::int as n
),
a256 as (
  select (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'fechas_disponibles'))::int
       + (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'tarifario_diagnostico'))::int
       + (exists (select 1 from pg_constraint where conname = 'tarifario_resultado_fechas_disponibles_chk' and conrelid = to_regclass('public.tarifario_resultado')))::int
       + (to_regprocedure('public.registrar_diagnostico_tarifario(bigint,bigint,text)') is not null)::int as n
),
p259 as (
  select count(*) as n from pg_proc p
   where p.oid in (to_regprocedure('public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)'),
                   to_regprocedure('public.publicar_tarifario_resultado_63(bigint,bigint,bigint,text,jsonb,text,numeric)'))
     and coalesce(p.proconfig, '{}'::text[]) @> array['statement_timeout=30s', 'lock_timeout=8s']::text[]
),
pend as (
  -- Parejas paquete + fecha_ida que HOY se venden desde la vista publicable (bloqueo/dinámico) y quedarán sin evidencia de composición hasta regenerar su tarifario.
  select v.paquete_id, count(distinct v.fecha_ida) + (case when bool_or(v.fecha_ida is null) then 1 else 0 end) as fechas
    from public.tarifario_resultado_publicable v where v.modulo::text in ('bloqueo', 'dinamico') group by v.paquete_id
),
c as (
  select 1 as n, '255 ya aplicada (6 de 6 artefactos) — orden acordado' as control, (select n from a255)::text || ' de 6' as observado, '6 de 6' as esperado,
         case when (select n from a255) = 6 then 'OK' else 'BLOQUEA' end as veredicto
  union all
  select 2, '256 ya aplicada (4 de 4 artefactos) — orden acordado 256 → 258', (select n from a256)::text || ' de 4', '4 de 4',
         case when (select n from a256) = 4 then 'OK' else 'BLOQUEA' end
  union all
  select 3, 'publicador interno = definición de la 256 (huella fdea10…)', coalesce((select h from hi), 'función ausente'), 'fdea107e195de51abca78e34b3e90c9b',
         case when (select h from hi) = 'fdea107e195de51abca78e34b3e90c9b' then 'OK' else 'BLOQUEA' end
  union all
  select 4, '259 ya aplicada: las 2 entradas del publicador con statement_timeout=30s y lock_timeout=8s', (select n from p259)::text, '2',
         case when (select n from p259) = 2 then 'OK' else 'BLOQUEA' end
  union all
  select 5, 'armado_paquetes.id es bigint (la FK de la tabla nueva apunta a ella)',
         coalesce((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'id'), 'ausente'), 'bigint',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'id' and data_type = 'bigint') then 'OK' else 'BLOQUEA' end
  union all
  select 6, 'armado_paquetes tiene tarifario_generacion, tarifario_generacion_publicada y tarifario_estado (la función nueva los lee)',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name in ('tarifario_generacion', 'tarifario_generacion_publicada', 'tarifario_estado'))::text, '3',
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name in ('tarifario_generacion', 'tarifario_generacion_publicada', 'tarifario_estado')) = 3 then 'OK' else 'BLOQUEA' end
  union all
  select 7, 'función public.mi_rol() existe', (to_regprocedure('public.mi_rol()') is not null)::text, 'true',
         case when to_regprocedure('public.mi_rol()') is not null then 'OK' else 'BLOQUEA' end
  union all
  select 8, 'estado de la 258 (tabla + función): 0 = limpio · 2 = ya aplicada · otro = parcial o ajeno', (select n from art)::text || ' de 2', '0 (limpio) o 2 (ya aplicada)',
         case when (select n from art) = 0 then 'OK' when (select n from art) = 2 then 'YA APLICADA' else 'BLOQUEA' end
  union all
  select 9, 'paquetes con publicación en curso (tarifario_estado = recalculando)', (select count(*) from public.armado_paquetes where tarifario_estado = 'recalculando')::text, '0',
         case when (select count(*) from public.armado_paquetes where tarifario_estado = 'recalculando') = 0 then 'OK' else 'REVISAR' end
  union all
  select 10, 'transacciones abiertas sin actividad desde hace más de 1 minuto (pueden retener candados)',
         (select count(*) from pg_stat_activity a where a.pid <> pg_backend_pid() and a.state = 'idle in transaction' and a.xact_start < now() - interval '1 minute')::text, '0',
         case when (select count(*) from pg_stat_activity a where a.pid <> pg_backend_pid() and a.state = 'idle in transaction' and a.xact_start < now() - interval '1 minute') = 0 then 'OK' else 'REVISAR' end
  union all
  select 11, 'TRABAJO DE REGENERACIÓN: fechas publicadas de bloqueo/dinámico que necesitarán evidencia tras desplegar el hotfix (fechas · paquetes · paquete:fechas)',
         (select coalesce(sum(fechas), 0) from pend)::text || ' fechas · ' || (select count(*) from pend)::text || ' paquetes · ' || coalesce((select string_agg(paquete_id::text || ':' || fechas::text, ',' order by paquete_id) from pend), '-'),
         'anotar la lista completa', 'INFO'
  union all
  select 12, 'línea base: filas publicadas de bloqueo/dinámico en la vista (no deben cambiar con la 258)',
         (select count(*) from public.tarifario_resultado_publicable where modulo::text in ('bloqueo', 'dinamico'))::text, 'anotar para el postcheck', 'INFO'
)
select n, control, observado, esperado, veredicto from c
union all
select 99, 'VEREDICTO GLOBAL',
       'controles con problema: ' || (select count(*) from c where veredicto in ('BLOQUEA', 'REVISAR'))::text, '0',
       case when (select count(*) from c where veredicto in ('BLOQUEA', 'REVISAR')) > 0 then 'NO APLICAR'
            when exists (select 1 from c where veredicto = 'YA APLICADA') then 'YA APLICADA (reaplicar es idempotente, pero no hace falta)'
            else 'APTO PARA APLICAR' end
order by n;
