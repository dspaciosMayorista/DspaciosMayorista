-- ROLLBACK 295 (#43/#60 incremento 3). Separado y PROTEGIDO: aborta sin tocar nada si hay propuestas
-- guardadas (deshacer las borraría). No toca la 293, los grupos, las tarifas ni la auditoría.
-- Antes de correrlo, revertir el código que llama a las RPC grupos_dias_*.
begin;
set local lock_timeout = '8s';
set local statement_timeout = '60s';

do $$
declare v_n bigint := 0;
begin
  if to_regclass('public.hotel_grupo_tarifa_propuesta') is not null then
    execute 'select count(*) from public.hotel_grupo_tarifa_propuesta' into v_n;
  end if;
  if v_n > 0 then
    raise exception 'ROLLBACK 295 ABORTADO (REVISAR): hay % propuesta(s) guardada(s); deshacer las borraría.', v_n;
  end if;
end $$;

drop trigger if exists trg_hotel_temporada_grupos_tipo_43 on public.hotel_temporada_grupos;
drop trigger if exists trg_hotel_temporadas_tipo_grupos_43 on public.hotel_temporadas;
drop function if exists public.grupos_dias_config(bigint);
drop function if exists public.grupos_dias_guardar(bigint, text, jsonb);
drop function if exists public.grupos_dias_guardar_propuesta(bigint, text, text, uuid, jsonb);
drop function if exists public.grupos_dias_borrar(uuid, text);
drop function if exists public._grupos_43_bloquear_y_comparar(bigint, text);
drop function if exists public._grupos_43_config(bigint);
drop function if exists public._grupos_43_autorizar(boolean);
drop function if exists public.tg_hotel_temporada_grupos_tipo_43();
drop function if exists public.tg_hotel_temporadas_tipo_grupos_43();
drop table if exists public.hotel_grupo_tarifa_propuesta;  -- vacía (comprobado arriba)

commit;
