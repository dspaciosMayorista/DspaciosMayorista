-- ROLLBACK de la 322 (#76/#77). La tabla guarda lo que los aliados escribieron sobre sus clientes (teléfono, correo, documento, notas): son DATOS PERSONALES de terceros.
-- El script se NIEGA si existe alguna fila (mismo patrón protegido de 318/319/323). Con filas: exportar/archivar primero y vaciar a conciencia; solo entonces repetir. Úsalo con el código de «Mis clientes» retirado.
--
-- B7 — PROTEGIDO CONTRA ESCRITORES CONCURRENTES. Orden: (1) tiempo de espera ACOTADO para el candado; (2) candado ACCESS EXCLUSIVE sobre la tabla ANTES de mirar si hay datos:
-- espera a que terminen (commit/rollback) los escritores en curso y bloquea a los nuevos hasta el final de esta transacción; (3) solo entonces se cuenta y se borra. Así una fila que
-- otra sesión esté insertando ahora (aún sin commit) se ve en la guarda y la rechaza, en vez de perderse con el DROP. Si el candado no se obtiene en 5 s, el script FALLA sin cambiar nada.
-- IMPACTO DE MANTENIMIENTO: mientras corre (milisegundos si no hay escritores), las lecturas y escrituras de public.aliado_clientes esperan; tras el DROP fallan por «no existe» (el código de «Mis clientes» ya debe estar retirado).
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regclass('public.aliado_clientes') is not null then
    lock table public.aliado_clientes in access exclusive mode;
  end if;
end $$;
do $$ begin
  if to_regclass('public.aliado_clientes') is not null and exists (select 1 from public.aliado_clientes) then
    raise exception 'ROLLBACK 322 detenido: hay clientes de aliados registrados (datos personales); no se elimina la tabla.';
  end if;
end $$;
drop table if exists public.aliado_clientes;
commit;
