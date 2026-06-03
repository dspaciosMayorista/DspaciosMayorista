-- Backfill: copiar los datos del pasajero a las sillas ya asignadas.
--
-- Para contratos creados ANTES del fix, las sillas guardaban el contrato/asesor/
-- hotel pero no los datos personales del pasajero. Este script los rellena
-- emparejando, por contrato, los pasajeros (sin infante, por `orden`) con las
-- sillas (por `numero_silla`). Solo toca sillas con el nombre vacío (idempotente).
--
-- Correr una vez en el SQL Editor de Supabase.

with pax as (
  select
    numero_contrato,
    nombre,
    tipo_id,
    identificacion,
    fecha_nacimiento,
    row_number() over (partition by numero_contrato order by orden, id) as rn
  from public.contrato_pasajeros
  where coalesce(es_infante, false) = false
),
sil as (
  select
    id,
    numero_contrato,
    row_number() over (partition by numero_contrato order by numero_silla, id) as rn
  from public.sillas
  where numero_contrato is not null
)
update public.sillas s
set
  pasajero_nombres = pax.nombre,
  tipo_doc         = pax.tipo_id,
  numero_doc       = pax.identificacion,
  nacimiento       = pax.fecha_nacimiento
from sil
join pax
  on pax.numero_contrato = sil.numero_contrato
 and pax.rn = sil.rn
where s.id = sil.id
  and (s.pasajero_nombres is null or s.pasajero_nombres = '');
