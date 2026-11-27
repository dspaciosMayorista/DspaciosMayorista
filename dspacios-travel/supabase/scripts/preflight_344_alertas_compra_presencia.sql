-- PREFLIGHT 344 (B3: alertas de compra con «Revisado», fuentes de hotel/servicio, presencia paginada) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 344 (y DESPUÉS de la 343).
with t as (
  select to_regprocedure('public.generar_avisos_compra(date,integer)') as fn_gen,
         to_regprocedure('public.f343_ventanas_compra(date,integer)') as fn_ven,
         to_regprocedure('public.f343_archivar_ventana()') as fn_arch,
         to_regprocedure('public.fn_actividad_reciente(integer)') as fn_act,
         to_regprocedure('public.avisos_reclamar(uuid,integer)') as fn_recl,
         to_regprocedure('public.avisos_marcar_leidos(uuid,bigint[])') as fn_leer,
         to_regprocedure('public.avisos_recientes(uuid,integer)') as fn_rec,
         to_regclass('public.presencia_usuario') as pres,
         to_regclass('public.hotel_temporadas') as htemp, to_regclass('public.servicio_temporadas') as stemp,
         to_regclass('public.hoteles') as hot, to_regclass('public.servicios_adicionales') as serv,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_temporadas' and column_name in ('hotel_id', 'nombre', 'compra_fin'))::int as cols_h,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'servicio_temporadas' and column_name in ('servicio_id', 'nombre', 'compra_fin'))::int as cols_s,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('hoteles', 'servicios_adicionales') and column_name = 'activo')::int as cols_activo,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'avisos' and column_name = 'revisado_en')::int as col_rev,
         (select count(*) from pg_proc where proname in ('fn_actividad_resumen', 'fn_actividad_pagina', 'alertas_compra_listar', 'alertas_compra_revisar') and pronamespace = 'public'::regnamespace)::int as fn_nuevas,
         (select count(*) from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null)::int as vivos
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'La 343 está aplicada (generador, ventanas, archivo, presencia, fn_actividad_reciente)' as control,
         concat_ws(' / ', coalesce(fn_gen::text, 'falta generar'), coalesce(fn_ven::text, 'falta ventanas'), coalesce(fn_arch::text, 'falta archivar'), coalesce(pres::text, 'falta presencia'), coalesce(fn_act::text, 'falta actividad')) as observado,
         'las cinco existen' as esperado, case when fn_gen is not null and fn_ven is not null and fn_arch is not null and pres is not null and fn_act is not null then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'Existen las funciones de la campana que la 344 reemplaza (281/340)', concat_ws(' / ', coalesce(fn_recl::text, 'falta reclamar'), coalesce(fn_leer::text, 'falta leer'), coalesce(fn_rec::text, 'falta recientes')), 'las tres existen', case when fn_recl is not null and fn_leer is not null and fn_rec is not null then 'OK' else 'REVISAR' end from t
  union all select 3, 'Existen hotel_temporadas, servicio_temporadas, hoteles y servicios_adicionales con las columnas que usa la 344', concat_ws(' / ', cols_h::text, cols_s::text, cols_activo::text), '3 / 3 / 2', case when htemp is not null and stemp is not null and hot is not null and serv is not null and cols_h = 3 and cols_s = 3 and cols_activo = 2 then 'OK' else 'REVISAR' end from t
  union all select 4, 'Aún NO existen avisos.revisado_en ni las cuatro funciones nuevas (existen si la 344 ya se corrió)', col_rev::text || ' / ' || fn_nuevas::text, '0 / 0', case when col_rev = 0 and fn_nuevas = 0 then 'OK' else 'REVISAR' end from t
  union all select 5, 'INFO: alertas de compra vivas hoy (al aplicar la 344 dejan de verse en la campana y pasan al área de ALERTAS del tablero; ninguna se borra)', vivos::text, 'n/a', 'INFO' from t
) r order by orden;
