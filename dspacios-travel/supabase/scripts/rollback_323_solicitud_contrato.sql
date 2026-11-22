-- ROLLBACK 323 (#78). Se niega si ya hay solicitudes o avisos del tipo nuevo (no se destruyen datos en silencio). Una sola transacción.
--
-- B7 — PROTEGIDO CONTRA ESCRITORES CONCURRENTES: (1) espera ACOTADA (5 s) por los candados; (2) candado ACCESS EXCLUSIVE sobre cotizacion_solicitudes_contrato y luego sobre avisos (SIEMPRE ese orden)
-- ANTES de contar: espera a las transacciones en curso y bloquea a las nuevas hasta el final; (3) solo entonces se cuenta y se modifica. Si no se obtienen en 5 s, falla sin cambiar nada.
-- IMPACTO DE MANTENIMIENTO (real): avisos es una tabla compartida por todas las notificaciones; ALTER TABLE ya exigía ese candado, y ahora se toma desde el inicio. Mientras corre, crear/leer avisos
-- espera (milisegundos si no hay transacciones largas) y las solicitudes de contrato esperan o fallan por «no existe». Conviene ejecutarlo en una ventana tranquila.
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regclass('public.cotizacion_solicitudes_contrato') is not null then
    lock table public.cotizacion_solicitudes_contrato in access exclusive mode;
  end if;
  lock table public.avisos in access exclusive mode;
end $$;
do $$ begin
  if to_regclass('public.cotizacion_solicitudes_contrato') is not null and exists (select 1 from public.cotizacion_solicitudes_contrato) then
    raise exception 'ROLLBACK 323 detenido: hay solicitudes de contrato registradas.';
  end if;
  if exists (select 1 from public.avisos where tipo = 'solicitud_contrato') then
    raise exception 'ROLLBACK 323 detenido: hay avisos de solicitud de contrato.';
  end if;
end $$;
drop function if exists public.solicitar_contrato_cotizacion(bigint, uuid);
drop table if exists public.cotizacion_solicitudes_contrato;
alter table public.avisos drop constraint if exists avisos_tipo_check;
alter table public.avisos add constraint avisos_tipo_check check (tipo in ('soporte_pago_nuevo', 'soporte_pago_reemplazado'));
alter table public.avisos drop column if exists cotizacion_id;
commit;
