-- ROLLBACK 325. Se niega si ya hay evidencias o pasajeros guardados (no se destruyen datos ni archivos en silencio). Una sola transacción; espera de candados acotada (5 s).
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regclass('public.cotizacion_evidencias') is not null then lock table public.cotizacion_evidencias in access exclusive mode; end if;
  if to_regclass('public.cotizacion_pasajeros_aliado') is not null then lock table public.cotizacion_pasajeros_aliado in access exclusive mode; end if;
end $$;
do $$ begin
  if to_regclass('public.cotizacion_evidencias') is not null and exists (select 1 from public.cotizacion_evidencias) then raise exception 'ROLLBACK 325 detenido: hay evidencias registradas.'; end if;
  if to_regclass('public.cotizacion_pasajeros_aliado') is not null and exists (select 1 from public.cotizacion_pasajeros_aliado) then raise exception 'ROLLBACK 325 detenido: hay pasajeros guardados por aliados.'; end if;
  if exists (select 1 from storage.objects where bucket_id = 'evidencias-cotizacion') then raise exception 'ROLLBACK 325 detenido: el bucket evidencias-cotizacion tiene objetos.'; end if;
end $$;
drop function if exists public.cotizacion_pasajeros_aliado_guardar(bigint, uuid, jsonb);
drop function if exists public.evidencia_cotizacion_retirar(bigint, uuid);
drop function if exists public.evidencia_cotizacion_verificar(bigint, uuid);
drop function if exists public.evidencia_cotizacion_registrar(bigint, uuid, text, text, text, bigint, text);
drop function if exists public.f325_cotizacion_propia(bigint, uuid);
drop table if exists public.cotizacion_pasajeros_aliado;
drop table if exists public.cotizacion_evidencias;
delete from storage.buckets where id = 'evidencias-cotizacion';
commit;
