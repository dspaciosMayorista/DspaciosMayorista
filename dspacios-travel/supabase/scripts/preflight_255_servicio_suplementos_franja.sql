-- PREFLIGHT 255 · SOLO LECTURA · UNA consulta integral: n · control · observado · esperado · veredicto.
-- Pegar COMPLETA en el editor SQL de Supabase, SIN envolver en begin/rollback (el editor solo muestra el resultado de la última sentencia).
-- Veredictos: OK · INFO · YA APLICADA (estado completo) · BLOQUEA / REVISAR (no aplicar). La ÚLTIMA fila (n = 99) es el VEREDICTO GLOBAL.
-- Orden acordado: 259 (ya aplicada) → 255 → 256 → 258. La 255 es ADITIVA (tabla + 3 funciones + trigger + policy); no toca ninguna tabla existente.
with
rm as (select prorettype as t from pg_proc where oid = to_regprocedure('public.mi_rol()')),
art as (
  select (to_regclass('public.servicio_suplementos_franja') is not null)::int
       + (to_regprocedure('public.fn_franja_minutos(text)') is not null)::int
       + (to_regprocedure('public.fn_franja_contiene(integer,integer,integer)') is not null)::int
       + (to_regprocedure('public.tg_servicio_suplementos_franja_solape()') is not null)::int
       + (exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.servicio_suplementos_franja') and t.tgname = 'servicio_suplementos_franja_solape' and not t.tgisinternal))::int
       + (exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'servicio_suplementos_franja' and policyname = 'servicio_suplementos_franja: interno'))::int as n
),
p259 as (
  select count(*) as n from pg_proc p
   where p.oid in (to_regprocedure('public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)'),
                   to_regprocedure('public.publicar_tarifario_resultado_63(bigint,bigint,bigint,text,jsonb,text,numeric)'))
     and coalesce(p.proconfig, '{}'::text[]) @> array['statement_timeout=30s', 'lock_timeout=8s']::text[]
),
c as (
  select 1 as n, 'tabla servicio_temporadas existe (migración 089)' as control,
         (to_regclass('public.servicio_temporadas') is not null)::text as observado, 'true' as esperado,
         case when to_regclass('public.servicio_temporadas') is not null then 'OK' else 'BLOQUEA' end as veredicto
  union all
  select 2, 'servicio_temporadas tiene PRIMARY KEY (la FK de la 255 apunta a ella)',
         exists (select 1 from pg_constraint where conrelid = to_regclass('public.servicio_temporadas') and contype = 'p')::text, 'true',
         case when exists (select 1 from pg_constraint where conrelid = to_regclass('public.servicio_temporadas') and contype = 'p') then 'OK' else 'BLOQUEA' end
  union all
  select 3, 'función public.mi_rol() existe', (to_regprocedure('public.mi_rol()') is not null)::text, 'true',
         case when to_regprocedure('public.mi_rol()') is not null then 'OK' else 'BLOQUEA' end
  union all
  select 4, 'el tipo que devuelve mi_rol() contiene superadmin, gerencia, administracion y operaciones (la policy los compara)',
         (select count(*) from pg_enum e join rm on e.enumtypid = rm.t where e.enumlabel in ('superadmin', 'gerencia', 'administracion', 'operaciones'))::text, '4',
         case when (select count(*) from pg_enum e join rm on e.enumtypid = rm.t where e.enumlabel in ('superadmin', 'gerencia', 'administracion', 'operaciones')) = 4 then 'OK' else 'BLOQUEA' end
  union all
  select 5, 'base de la 254 presente (armado_paquetes.pvp_infante_fijo y tarifario_resultado.precio_pvp_sin_fijo)',
         (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'pvp_infante_fijo')
          and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'precio_pvp_sin_fijo'))::text, 'true',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'pvp_infante_fijo')
               and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'precio_pvp_sin_fijo') then 'OK' else 'BLOQUEA' end
  union all
  select 6, '259 ya aplicada: las 2 entradas del publicador con statement_timeout=30s y lock_timeout=8s',
         (select n from p259)::text, '2', case when (select n from p259) = 2 then 'OK' else 'BLOQUEA' end
  union all
  select 7, 'estado de la 255 (tabla, 3 funciones, trigger, policy): 0 = limpio · 6 = ya aplicada · otro = parcial o ajeno',
         (select n from art)::text || ' de 6', '0 (limpio) o 6 (ya aplicada)',
         case when (select n from art) = 0 then 'OK' when (select n from art) = 6 then 'YA APLICADA' else 'BLOQUEA' end
  union all
  select 8, 'transacciones abiertas sin actividad desde hace más de 1 minuto (pueden retener candados y hacer fallar el ALTER/CREATE)',
         (select count(*) from pg_stat_activity a where a.pid <> pg_backend_pid() and a.state = 'idle in transaction' and a.xact_start < now() - interval '1 minute')::text, '0',
         case when (select count(*) from pg_stat_activity a where a.pid <> pg_backend_pid() and a.state = 'idle in transaction' and a.xact_start < now() - interval '1 minute') = 0 then 'OK' else 'REVISAR' end
  union all
  select 9, 'línea base: filas de servicio_temporadas y de servicios_adicionales (la 255 NO debe cambiarlas)',
         (select count(*) from public.servicio_temporadas)::text || ' / ' || (select count(*) from public.servicios_adicionales)::text, 'anotar para el postcheck', 'INFO'
)
select n, control, observado, esperado, veredicto from c
union all
select 99, 'VEREDICTO GLOBAL',
       'controles con problema: ' || (select count(*) from c where veredicto in ('BLOQUEA', 'REVISAR'))::text, '0',
       case when (select count(*) from c where veredicto in ('BLOQUEA', 'REVISAR')) > 0 then 'NO APLICAR'
            when exists (select 1 from c where veredicto = 'YA APLICADA') then 'YA APLICADA (reaplicar es idempotente, pero no hace falta)'
            else 'APTO PARA APLICAR' end
order by n;
