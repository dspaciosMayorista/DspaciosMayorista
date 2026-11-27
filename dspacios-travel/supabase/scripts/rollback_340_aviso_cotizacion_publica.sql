-- ROLLBACK 340 (#78 residual). Se niega si ya hay avisos del tipo nuevo (no se destruyen datos en silencio). Una sola transacción.
-- Protegido contra escritores concurrentes: espera ACOTADA (5 s) y candado ACCESS EXCLUSIVE sobre avisos ANTES de contar (mismo criterio que el rollback de la 323).
begin;
set local lock_timeout = '5s';
lock table public.avisos in access exclusive mode;
do $$ begin
  if exists (select 1 from public.avisos where tipo = 'cotizacion_publica') then
    raise exception 'ROLLBACK 340 detenido: hay avisos de cotización pública.';
  end if;
end $$;
drop function if exists public.avisos_recientes(uuid, integer);
drop function if exists public.avisar_cotizacion_publica(bigint);
drop index if exists public.uq_avisos_cotizacion_publica;
alter table public.avisos drop constraint if exists avisos_tipo_check;
alter table public.avisos add constraint avisos_tipo_check check (tipo in ('soporte_pago_nuevo', 'soporte_pago_reemplazado', 'solicitud_contrato'));
commit;
