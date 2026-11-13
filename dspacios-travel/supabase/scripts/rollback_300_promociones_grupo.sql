-- ROLLBACK 300 (#43/#60 entrega 4). Separado y PROTEGIDO: aborta sin tocar nada si alguna promoción usa lo que
-- agrega la 300 (reglas, vínculo, unidad, noche bonificada o días): borrar esas columnas cambiaría precios en venta.
-- Para llegar a 0: quitar las reglas y volver a elegir en cada promoción afectada (o eliminarla).
-- ANTES de correrlo: revertir el código que lee o escribe estas columnas.
begin;
set local lock_timeout = '8s';
set local statement_timeout = '60s';

do $$
declare v_reglas bigint; v_vig bigint;
begin
  select count(*) into v_reglas from public.hotel_promocion_reglas;
  select count(*) into v_vig from public.hotel_temporadas
  where promo_base_id is not null or descuento_unidad is not null or noche_gratis_regla is not null or dias_promo is not null;
  if v_reglas > 0 or v_vig > 0 then
    raise exception 'ROLLBACK 300 ABORTADO (REVISAR): hay % regla(s) y % promoción(es) que usan la 300.', v_reglas, v_vig;
  end if;
end $$;

drop function if exists public.promocion_guardar_reglas(bigint, bigint, jsonb, jsonb);
-- Restaura la configuración de grupos de la 299 (se conservó intacta con otro nombre).
do $$
begin
  if to_regprocedure('public._grupos_43_config_299(bigint)') is not null then
    drop function if exists public._grupos_43_config(bigint);
    alter function public._grupos_43_config_299(bigint) rename to _grupos_43_config;
    revoke all on function public._grupos_43_config(bigint) from public, anon, authenticated;
  end if;
end $$;
drop function if exists public._promo_300_revision(bigint);
drop function if exists public._promo_300_candado_base(bigint[]);
drop trigger if exists trg_promo_300_conflictos on public.hotel_temporadas;
drop trigger if exists trg_promo_300_conflictos on public.hotel_promocion_reglas;
drop trigger if exists trg_hotel_temporada_grupos_promo_300 on public.hotel_temporada_grupos;
drop trigger if exists trg_hotel_temporadas_promo_300 on public.hotel_temporadas;
drop table if exists public.hotel_promocion_reglas;
drop function if exists public.tg_hotel_temporada_grupos_promo_300();
drop function if exists public.tg_hotel_promocion_reglas_300();
drop function if exists public.tg_hotel_temporadas_promo_300();
drop function if exists public.tg_promo_300_conflictos();
drop function if exists public._promo_300_texto(jsonb);
drop function if exists public._promo_300_conflictos(bigint);
drop function if exists public._promo_300_regla(bigint, bigint, date);
drop function if exists public._promo_300_extremo(jsonb, date, date, boolean);
drop function if exists public._promo_300_cubre(jsonb, jsonb, date, date, date);
drop function if exists public._promo_300_cubre(jsonb, date, date, jsonb, date);
drop index if exists public.hotel_temporadas_promo_base_idx;
alter table public.hotel_temporadas drop constraint if exists hotel_temporadas_promo_300;
alter table public.hotel_temporadas
  drop column if exists dias_promo,
  drop column if exists noche_gratis_regla,
  drop column if exists descuento_unidad,
  drop column if exists promo_base_id;

commit;
