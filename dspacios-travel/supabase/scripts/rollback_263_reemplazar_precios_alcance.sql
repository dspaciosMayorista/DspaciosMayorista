-- Rollback de la 263 (provisional): solo retira la función. No toca datos ni la 262.
begin;
drop function if exists public.reemplazar_precios_alcance(bigint, jsonb);
do $$ begin
  if to_regprocedure('public.reemplazar_precios_alcance(bigint,jsonb)') is not null then raise exception 'rollback 263: la función sigue presente'; end if;
end $$;
commit;
