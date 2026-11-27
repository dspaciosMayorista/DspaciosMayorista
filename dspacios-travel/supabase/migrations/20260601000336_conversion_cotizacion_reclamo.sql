-- Migration 336 (#40, Codex F1): one in-flight conversion per quotation, claimed BEFORE a contract number is spent.
--
-- Why: `convertirCotizacion` (non-#63 path) numbers the contract, inserts the `ventas` header (stamped with `cotizacion_id`, unique
-- since 164) and only then writes passengers/seats/payables; `financiero_estado` flips 'pendiente' -> 'completo' ATOMICALLY inside
-- `registrar_financiero_contrato`, and any earlier failure deletes the header again (`revertir_contrato_incompleto`). Two requests for
-- the SAME quotation therefore (a) both spent a number and (b) the loser could see the winner's still-incomplete header.
--
-- What this migration adds (additive; touches no existing table, function or policy):
--   · `cotizacion_conversion_reclamo` — one lease row per quotation (service_role only, no policies, RLS on).
--   · `reclamar_conversion_cotizacion(p_cotizacion, p_ttl_segundos)` — atomic acquire. Returns the lease token, or NULL while another
--     unexpired lease exists. An expired lease (crashed process) is taken over by the next caller.
--   · `liberar_conversion_cotizacion(p_cotizacion, p_token)` — releases only with the matching token.
-- The lease is advisory for numbering; correctness still rests on `ventas_cotizacion_id_key` (164) and on `financiero_estado`.
--
-- Rollback: supabase/scripts/rollback_336_337_conversion_voucher.sql

begin;

do $$ begin
  if to_regclass('public.cotizaciones') is null then raise exception '336: falta public.cotizaciones'; end if;
  if to_regclass('public.cotizacion_conversion_reclamo') is not null then raise exception '336: ya aplicada (existe cotizacion_conversion_reclamo).'; end if;
end $$;

create table public.cotizacion_conversion_reclamo (
  cotizacion_id bigint primary key references public.cotizaciones(id) on delete cascade,
  token         uuid not null,
  reclamado_en  timestamptz not null default now(),
  expira_en     timestamptz not null
);
comment on table public.cotizacion_conversion_reclamo is
  'Migración 336 (#40). Un reclamo vigente por cotización mientras una conversión corre. Solo service_role (RPC). Un reclamo vencido lo toma el siguiente intento; la unicidad de ventas.cotizacion_id (164) sigue siendo la garantía final.';
alter table public.cotizacion_conversion_reclamo enable row level security;
revoke all on public.cotizacion_conversion_reclamo from public, anon, authenticated;
grant all on public.cotizacion_conversion_reclamo to service_role;

create function public.reclamar_conversion_cotizacion(p_cotizacion bigint, p_ttl_segundos integer default 300)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_token uuid;
begin
  if p_cotizacion is null or p_cotizacion <= 0 then raise exception 'cotización inválida' using errcode = '22023'; end if;
  if p_ttl_segundos is null or p_ttl_segundos < 30 or p_ttl_segundos > 1800 then raise exception 'ttl fuera de rango (30–1800 s)' using errcode = '22023'; end if;
  insert into public.cotizacion_conversion_reclamo as r (cotizacion_id, token, reclamado_en, expira_en)
  values (p_cotizacion, gen_random_uuid(), now(), now() + make_interval(secs => p_ttl_segundos))
  on conflict (cotizacion_id) do update set token = excluded.token, reclamado_en = excluded.reclamado_en, expira_en = excluded.expira_en
    where r.expira_en <= now()
  returning r.token into v_token;
  return v_token;   -- NULL: otro reclamo vigente
end $$;
revoke all on function public.reclamar_conversion_cotizacion(bigint, integer) from public, anon, authenticated;
grant execute on function public.reclamar_conversion_cotizacion(bigint, integer) to service_role;

create function public.liberar_conversion_cotizacion(p_cotizacion bigint, p_token uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  delete from public.cotizacion_conversion_reclamo where cotizacion_id = p_cotizacion and token = p_token;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.liberar_conversion_cotizacion(bigint, uuid) from public, anon, authenticated;
grant execute on function public.liberar_conversion_cotizacion(bigint, uuid) to service_role;

commit;
