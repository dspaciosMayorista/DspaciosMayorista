-- Migration 337 (#18, Codex F2): the air-service voucher is written atomically, idempotently and at most once per contract.
--
-- Why: the first implementation regenerated with DELETE-then-INSERT from the application: a failed INSERT lost the previous voucher
-- (and its public link), a failed DELETE was ignored (two vouchers), two simultaneous calls left two vouchers.
--
-- What this migration does (additive; hotel/service vouchers are untouched):
--   1. Partial unique index `vouchers_vuelo_uno_por_contrato` (numero_contrato) WHERE tipo = 'vuelo' — the invariant.
--      It refuses to install if a contract already has more than one air voucher (nothing is deleted: resolve by hand, see preflight).
--   2. `guardar_voucher_vuelo(p_numero, p_contenido)` — ONE statement `INSERT ... ON CONFLICT ... DO UPDATE`:
--        · first call creates the voucher; later calls UPDATE it IN PLACE, so `id` and `share_token` (the public link already issued)
--          stay the same and the link shows the regenerated content;
--        · on any failure nothing changes (single statement);
--        · SECURITY INVOKER: the caller's RLS (vouchers: lectura/insertar/actualizar — own contract for `venta`) and the contract
--          identity guard (284) apply exactly as they did to the direct insert.
-- Rollback: supabase/scripts/rollback_336_337_conversion_voucher.sql

begin;

do $$ begin
  if to_regclass('public.vouchers') is null then raise exception '337: falta public.vouchers'; end if;
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'vouchers_vuelo_uno_por_contrato') then raise exception '337: ya aplicada.'; end if;
  if exists (select 1 from public.vouchers where tipo = 'vuelo' group by numero_contrato having count(*) > 1) then
    raise exception '337: hay contratos con más de un voucher de vuelo; resuélvelo a mano (preflight 336/337, control 3) antes de aplicar.';
  end if;
end $$;

create unique index vouchers_vuelo_uno_por_contrato on public.vouchers (numero_contrato) where tipo = 'vuelo';

create function public.guardar_voucher_vuelo(p_numero text, p_contenido jsonb)
returns table (id bigint, share_token uuid, creado boolean)
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if p_numero is null or btrim(p_numero) = '' then raise exception 'contrato requerido' using errcode = '22023'; end if;
  if p_contenido is null or jsonb_typeof(p_contenido) <> 'object' or p_contenido->>'clase' is distinct from 'vuelo' then
    raise exception 'el contenido no es un voucher de vuelo' using errcode = '22023';
  end if;
  return query
    insert into public.vouchers as v (numero_contrato, tipo, proveedor, contenido)
    values (p_numero, 'vuelo', 'Servicio aéreo', p_contenido)
    on conflict (numero_contrato) where tipo = 'vuelo'
    do update set contenido = excluded.contenido
    returning v.id, v.share_token, (v.xmax = 0);
end $$;
revoke all on function public.guardar_voucher_vuelo(text, jsonb) from public, anon;
grant execute on function public.guardar_voucher_vuelo(text, jsonb) to authenticated, service_role;

commit;
