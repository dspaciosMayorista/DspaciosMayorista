-- PREFLIGHT 256 · SOLO LECTURA · UNA consulta integral: n · control · observado · esperado · veredicto.
-- Pegar COMPLETA en el editor SQL de Supabase, SIN envolver en begin/rollback (el editor solo muestra el resultado de la última sentencia).
-- Veredictos: OK · INFO · YA APLICADA (estado completo) · BLOQUEA / REVISAR (no aplicar). La ÚLTIMA fila (n = 99) es el VEREDICTO GLOBAL.
-- Orden acordado: 259 (ya aplicada) → 255 → 256 → 258. La 256 REEMPLAZA dos definiciones auditadas por huella (publicador interno y vista publicable de la 254).
-- Huellas: publicador 254 = 990e24…, 256 = fdea10…; vista 254 = d4165c…, 256 = 882ad9…. Cualquier otra huella = cambio ajeno → la migración ABORTA y aquí BLOQUEA.
with
hi as (select md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')), chr(13), '')) as h),
hv as (select md5(pg_get_viewdef(to_regclass('public.tarifario_resultado_publicable'), true)) as h),
ci as (select case when (select h from hi) is null then 'ausente' when (select h from hi) = '990e246824e567293372355d290a61a9' then '254' when (select h from hi) = 'fdea107e195de51abca78e34b3e90c9b' then '256' else 'AJENA' end as k),
cv as (select case when (select h from hv) is null then 'ausente' when (select h from hv) = 'd4165ca9aaa100ae9bfb49d07e1aacb6' then '254' when (select h from hv) = '882ad9b869dae2ffdf58a746f24d9631' then '256' else 'AJENA' end as k),
art as (
  select (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'fechas_disponibles'))::int
       + (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'tarifario_diagnostico'))::int
       + (exists (select 1 from pg_constraint where conname = 'tarifario_resultado_fechas_disponibles_chk' and conrelid = to_regclass('public.tarifario_resultado')))::int
       + (to_regprocedure('public.registrar_diagnostico_tarifario(bigint,bigint,text)') is not null)::int as n
),
a255 as (
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
colsr as (
  select count(*) as n from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name in
    ('paquete_id','paquete_nombre','paquete_activo','modulo','bloqueo_id','bloqueo_label','empaquetado_id','hotel_id','hotel_nombre','servicio_id','servicio_nombre','destino_id','destino_nombre','categoria','regimen','acomodacion','noches','fecha_ida','fecha_regreso','pax_desde','pax_hasta','tipo_tarifa','base_comisionable','impuesto','precio_pvp','precio_pvp_menor2','precio_pvp_sin_fijo','precio_pvp_menor2_sin_fijo','descripcion','recargo_individual','moneda','salida_id','temporada_ganadora','es_promocion','precio_final_autoritativo','procedencia_temporadas','procedencia_mixta')
),
colsa as (
  select count(*) as n from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name in
    ('tarifario_generacion','tarifario_revision_fuente','activo','tarifario_estado','tarifario_error','tarifario_generacion_publicada','tarifario_revision_publicada','tarifario_snapshot_publicable','tarifario_actualizado_en','moneda')
),
c as (
  select 1 as n, '255 ya aplicada (tabla, 3 funciones, trigger y policy: 6 de 6) — orden acordado 255 → 256' as control,
         (select n from a255)::text || ' de 6' as observado, '6 de 6' as esperado,
         case when (select n from a255) = 6 then 'OK' else 'BLOQUEA' end as veredicto
  union all
  select 2, '259 ya aplicada: las 2 entradas del publicador con statement_timeout=30s y lock_timeout=8s',
         (select n from p259)::text, '2', case when (select n from p259) = 2 then 'OK' else 'BLOQUEA' end
  union all
  select 3, 'base de la 254: columnas que el publicador nuevo inserta (37 en tarifario_resultado)',
         (select n from colsr)::text, '37', case when (select n from colsr) = 37 then 'OK' else 'BLOQUEA' end
  union all
  select 4, 'base de la 254/181: columnas de armado_paquetes que el publicador nuevo lee o escribe (10)',
         (select n from colsa)::text, '10', case when (select n from colsa) = 10 then 'OK' else 'BLOQUEA' end
  union all
  select 5, 'tipo tarifario_modulo contiene «servicios» (el CHECK de fechas_disponibles lo usa)',
         exists (select 1 from pg_enum e where e.enumtypid = to_regtype('public.tarifario_modulo') and e.enumlabel = 'servicios')::text, 'true',
         case when exists (select 1 from pg_enum e where e.enumtypid = to_regtype('public.tarifario_modulo') and e.enumlabel = 'servicios') then 'OK' else 'BLOQUEA' end
  union all
  select 6, 'huella del publicador interno (254 = 990e24… · 256 = fdea10…)', coalesce((select h from hi), 'función ausente'),
         '990e246824e567293372355d290a61a9 (254) o fdea107e195de51abca78e34b3e90c9b (256)',
         case (select k from ci) when '254' then 'OK' when '256' then 'YA APLICADA' else 'BLOQUEA' end
  union all
  select 7, 'huella de la vista tarifario_resultado_publicable (254 = d4165c… · 256 = 882ad9…)', coalesce((select h from hv), 'vista ausente'),
         'd4165ca9aaa100ae9bfb49d07e1aacb6 (254) o 882ad9b869dae2ffdf58a746f24d9631 (256)',
         case (select k from cv) when '254' then 'OK' when '256' then 'YA APLICADA' else 'BLOQUEA' end
  union all
  select 8, 'estado de la 256: limpio (0/4 artefactos + publicador y vista de la 254) · completo (4/4 + los de la 256) · intermedio por el rollback oficial (publicador de la 254, vista de la 254 o 256) · otro = ajeno',
         'artefactos=' || (select n from art) || '/4; publicador=' || (select k from ci) || '; vista=' || (select k from cv), 'limpio · completo · intermedio de rollback',
         case when (select n from art) = 0 and (select k from ci) = '254' and (select k from cv) = '254' then 'OK'
              when (select n from art) = 4 and (select k from ci) = '256' and (select k from cv) = '256' then 'YA APLICADA'
              when (select k from ci) = '254' and (select k from cv) in ('254', '256') then 'INFO'
              else 'BLOQUEA' end
  union all
  select 9, 'las 2 entradas públicas del publicador delegan en publicar_tarifario_resultado_interno (la 256 reemplaza solo el interno)',
         (select count(*) from pg_proc p where p.oid in (to_regprocedure('public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)'), to_regprocedure('public.publicar_tarifario_resultado_63(bigint,bigint,bigint,text,jsonb,text,numeric)')) and position('publicar_tarifario_resultado_interno' in p.prosrc) > 0)::text, '2',
         case when (select count(*) from pg_proc p where p.oid in (to_regprocedure('public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)'), to_regprocedure('public.publicar_tarifario_resultado_63(bigint,bigint,bigint,text,jsonb,text,numeric)')) and position('publicar_tarifario_resultado_interno' in p.prosrc) > 0) = 2 then 'OK' else 'BLOQUEA' end
  union all
  select 10, 'vista publicable: opciones (security_barrier=true, security_invoker=false) y SELECT para anon, authenticated y service_role (la 256 las conserva)',
         coalesce((select array_to_string(reloptions, ',') from pg_class where oid = to_regclass('public.tarifario_resultado_publicable')), 'vista ausente') || ' · anon=' ||
         coalesce(has_table_privilege('anon', to_regclass('public.tarifario_resultado_publicable'), 'select')::text, '-') || ' auth=' ||
         coalesce(has_table_privilege('authenticated', to_regclass('public.tarifario_resultado_publicable'), 'select')::text, '-') || ' service=' ||
         coalesce(has_table_privilege('service_role', to_regclass('public.tarifario_resultado_publicable'), 'select')::text, '-'),
         'security_barrier=true,security_invoker=false · anon=true auth=true service=true',
         case when (select coalesce(reloptions, '{}') @> array['security_barrier=true', 'security_invoker=false']::text[] from pg_class where oid = to_regclass('public.tarifario_resultado_publicable'))
               and has_table_privilege('anon', to_regclass('public.tarifario_resultado_publicable'), 'select')
               and has_table_privilege('authenticated', to_regclass('public.tarifario_resultado_publicable'), 'select')
               and has_table_privilege('service_role', to_regclass('public.tarifario_resultado_publicable'), 'select') then 'OK' else 'REVISAR' end
  union all
  select 11, 'paquetes con publicación en curso (tarifario_estado = recalculando)',
         (select count(*) from public.armado_paquetes where tarifario_estado = 'recalculando')::text, '0',
         case when (select count(*) from public.armado_paquetes where tarifario_estado = 'recalculando') = 0 then 'OK' else 'REVISAR' end
  union all
  select 12, 'transacciones abiertas sin actividad desde hace más de 1 minuto (pueden retener candados y hacer fallar el ALTER TABLE)',
         (select count(*) from pg_stat_activity a where a.pid <> pg_backend_pid() and a.state = 'idle in transaction' and a.xact_start < now() - interval '1 minute')::text, '0',
         case when (select count(*) from pg_stat_activity a where a.pid <> pg_backend_pid() and a.state = 'idle in transaction' and a.xact_start < now() - interval '1 minute') = 0 then 'OK' else 'REVISAR' end
  union all
  select 13, 'línea base: filas / paquetes en tarifario_resultado / filas en la vista publicable / tamaño total de la tabla (la 256 NO debe cambiarlas)',
         (select count(*) from public.tarifario_resultado)::text || ' / ' || (select count(distinct paquete_id) from public.tarifario_resultado)::text || ' / ' ||
         (select count(*) from public.tarifario_resultado_publicable)::text || ' / ' || pg_size_pretty(pg_total_relation_size('public.tarifario_resultado')),
         'anotar para el postcheck', 'INFO'
)
select n, control, observado, esperado, veredicto from c
union all
select 99, 'VEREDICTO GLOBAL',
       'controles con problema: ' || (select count(*) from c where veredicto in ('BLOQUEA', 'REVISAR'))::text, '0',
       case when (select count(*) from c where veredicto in ('BLOQUEA', 'REVISAR')) > 0 then 'NO APLICAR'
            when (select veredicto from c where n = 8) = 'YA APLICADA' then 'YA APLICADA (reaplicar es idempotente, pero no hace falta)'
            when (select veredicto from c where n = 8) = 'INFO' then 'APTO PARA APLICAR (estado intermedio de un rollback previo; la migración es idempotente y lo completa)'
            else 'APTO PARA APLICAR' end
order by n;
