-- ROLLBACK 298 (#43/#60 3b). Separado y PROTEGIDO: aborta sin tocar nada si algún grupo tiene parámetros
-- propios guardados (deshacer los borraría y sus propuestas quedarían sin poder reproducirse).
-- ANTES de correrlo: revertir el código que llama a grupos_dias_guardar_calculadora_grupo.
-- Deja la 297 tal como se aplicó (restaura su versión de _calc_grupos_43_bases_de).
begin;
set local lock_timeout = '8s';
set local statement_timeout = '60s';

do $$
declare v_n bigint := 0;
begin
  if exists (select 1 from information_schema.columns where table_name = 'hotel_calculadora_grupo_bases' and column_name = 'generales') then
    execute 'select count(*) from public.hotel_calculadora_grupo_bases where generales is not null' into v_n;
  end if;
  if v_n > 0 then
    raise exception 'ROLLBACK 298 ABORTADO (REVISAR): % grupo(s) con parámetros propios; deshacer los borraría.', v_n;
  end if;
end $$;

drop function if exists public.grupos_dias_guardar_calculadora_grupo(bigint, text, uuid, text, bigint, bigint, jsonb, jsonb, jsonb);
drop function if exists public._calc_grupos_43_validar_generales(text, jsonb, jsonb);
drop trigger if exists trg_calc_grupo_generales_43 on public.hotel_calculadora_grupo_bases;
drop function if exists public.tg_calc_grupo_generales_43();
alter table public.hotel_calculadora_grupo_bases drop constraint if exists hotel_calculadora_grupo_bases_generales_forma;
alter table public.hotel_calculadora_grupo_bases drop column if exists generales;

-- Versión de la 297 (sin generales_propios).
create or replace function public._calc_grupos_43_bases_de(p_temporada_id bigint)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('grupo_id', b.grupo_id, 'tipo', b.tipo, 'version', b.version,
           'categorias', case when b.tipo = 'mixta' then (select count(*) from jsonb_each(b.bases) e, jsonb_array_elements(e.value) x)
                              else jsonb_array_length(b.bases) end)
         order by b.grupo_id, b.tipo), '[]')
  from public.hotel_calculadora_grupo_bases b join public.hotel_temporada_grupos g on g.id = b.grupo_id
  where g.temporada_id = p_temporada_id
$$;
revoke all on function public._calc_grupos_43_bases_de(bigint) from public, anon, authenticated;

commit;
