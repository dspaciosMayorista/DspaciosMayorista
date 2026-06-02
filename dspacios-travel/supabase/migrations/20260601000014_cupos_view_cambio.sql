-- Migración 014: la vista de cupos cuenta 'cambio_entrante' como disponible
-- (igual que el sistema real: las sillas recibidas por cambio se pueden vender).

create or replace view public.cupos_por_bloqueo as
select
  b.id,
  b.record,
  b.ruta,
  b.fecha_ida,
  b.cupos_total,
  count(s.id) filter (where s.estado in ('disponible','cambio_entrante')) as cupos_disponibles,
  count(s.id) filter (where s.estado in ('confirmada','en_plazo'))         as cupos_ocupados,
  count(s.id) filter (where s.estado = 'devuelta')                         as cupos_devueltos
from public.bloqueos_vuelo b
left join public.sillas s on s.bloqueo_id = b.id
group by b.id, b.record, b.ruta, b.fecha_ida, b.cupos_total;
