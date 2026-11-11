-- ROLLBACK 293 (#43/#60 incremento 1). Separado de la migración y PROTEGIDO:
-- se ABORTA sin tocar nada si existe cualquier grupo o cualquier tarifa con grupo,
-- porque deshacer borraría esos datos. Si aborta, se decide con el dueño qué hacer con
-- ellos ANTES de volver a intentarlo; este script nunca los borra.
-- El historial (tarifa_hotel_historial, auditoria) NO se toca: sus versiones con
-- grupo_id/grupo_dias en jsonb se conservan como registro.
begin;
set local lock_timeout = '8s';
set local statement_timeout = '60s';

do $$
declare
  v_grupos bigint := 0;
  v_tarifas bigint := 0;
begin
  if to_regclass('public.hotel_temporada_grupos') is not null then
    execute 'select count(*) from public.hotel_temporada_grupos' into v_grupos;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'tarifa_hotel' and column_name = 'grupo_id') then
    execute 'select count(*) from public.tarifa_hotel where grupo_id is not null or grupo_dias is not null' into v_tarifas;
  end if;
  if v_grupos > 0 or v_tarifas > 0 then
    raise exception 'ROLLBACK 293 ABORTADO (REVISAR): hay % grupo(s) y % tarifa(s) con grupo; deshacer los borraría.',
      v_grupos, v_tarifas;
  end if;
end $$;

drop trigger if exists trg_tarifa_hotel_grupo_43 on public.tarifa_hotel;
drop trigger if exists trg_hotel_temporadas_grupos_43 on public.hotel_temporadas;
drop trigger if exists trg_hoteles_modelo_grupos_43 on public.hoteles;

drop index if exists public.tarifa_hotel_grupo_clave_uq;
drop index if exists public.tarifa_hotel_grupo_idx;
alter table public.tarifa_hotel drop constraint if exists tarifa_hotel_grupo_dias_coherente;
alter table public.tarifa_hotel drop column if exists grupo_dias;
alter table public.tarifa_hotel drop column if exists grupo_id;

drop table if exists public.hotel_temporada_grupos;  -- vacía (comprobado arriba); arrastra sus triggers y políticas

drop function if exists public.tg_tarifa_hotel_grupo_43();
drop function if exists public.tg_hotel_temporadas_grupos_43();
drop function if exists public.tg_hoteles_modelo_grupos_43();
drop function if exists public.tg_hotel_temporada_grupos_validar();
drop function if exists public.tg_hotel_temporada_grupos_propagar_dias();
drop function if exists public.t43_60_candado_hotel(bigint, boolean);

commit;
