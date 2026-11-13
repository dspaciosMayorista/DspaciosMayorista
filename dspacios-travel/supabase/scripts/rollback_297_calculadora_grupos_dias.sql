-- ROLLBACK 297 (#43/#60 entrega 3b). Separado y PROTEGIDO: aborta sin tocar nada si hay bases de grupo
-- guardadas (deshacer las borraría). No toca la 293, la 295, las propuestas, las tarifas ni los params
-- de las calculadoras (solo quita la columna version y su trigger).
-- ANTES de correrlo: revertir el código que lee `hotel_calculadora.version` y llama a las RPC de la 297.
begin;
set local lock_timeout = '8s';
set local statement_timeout = '60s';

do $$
declare v_n bigint := 0;
begin
  if to_regclass('public.hotel_calculadora_grupo_bases') is not null then
    execute 'select count(*) from public.hotel_calculadora_grupo_bases' into v_n;
  end if;
  if v_n > 0 then
    raise exception 'ROLLBACK 297 ABORTADO (REVISAR): hay % fila(s) de bases por grupo; deshacer las borraría.', v_n;
  end if;
end $$;

drop function if exists public.grupos_dias_guardar_calculadora(bigint, text, uuid, text, bigint, bigint, jsonb, jsonb);
drop function if exists public.grupos_dias_borrar_con_bases(uuid, text, jsonb);
drop function if exists public.grupos_dias_config_bases(bigint);
drop function if exists public._calc_grupos_43_bases_de(bigint);
drop function if exists public._calc_grupos_43_validar_bases(text, jsonb, jsonb, jsonb);
drop function if exists public._calc_grupos_43_validar_lista(text, jsonb, jsonb, jsonb, text);
drop function if exists public._calc_grupos_43_numero(jsonb, boolean);
drop table if exists public.hotel_calculadora_grupo_bases;  -- vacía (comprobado arriba)
drop trigger if exists trg_hotel_calculadora_version_43 on public.hotel_calculadora;
drop function if exists public.tg_version_fila_43();
alter table public.hotel_calculadora drop column if exists version;

commit;
