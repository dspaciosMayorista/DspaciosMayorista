-- ───────────────────────────────────────────────────────────────────────────
-- FIX · Asignar destino a los bloqueos de inventario que quedaron sin destino_id
--
-- Toma el IATA del DESTINO desde la ruta "MDE - SMR - MDE" (segundo tramo) y lo
-- empareja con destinos.codigo_iata. Corre DESPUÉS de cargar destinos_mundo.sql.
-- ───────────────────────────────────────────────────────────────────────────

update public.bloqueos_vuelo b
set destino_id = d.id
from public.destinos d
where b.destino_id is null
  and b.ruta is not null
  and upper(trim(split_part(replace(b.ruta, ' ', ''), '-', 2))) = upper(d.codigo_iata);

-- Verificar los que aún queden sin destino (revisar su ruta a mano):
-- select id, record, ruta from public.bloqueos_vuelo where destino_id is null;
