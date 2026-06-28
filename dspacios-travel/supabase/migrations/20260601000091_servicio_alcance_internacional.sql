-- ───────────────────────────────────────────────────────────────────────────
-- 091 · SERVICIOS — alcance "todos los destinos internacionales"
--
--  Hasta ahora un servicio con destino_id NULL = "todos los destinos
--  nacionales". Algunas asistencias aplican SOLO a destinos internacionales.
--  Se agrega `alcance` para distinguir el catch-all cuando NO hay destino
--  específico:
--    · destino_id NOT NULL → un destino puntual (alcance se ignora).
--    · destino_id NULL + alcance='nacional'      → todos los destinos nacionales.
--    · destino_id NULL + alcance='internacional' → todos los internacionales.
--
--  Internacional = el destino del paquete tiene `pais` distinto de Colombia
--  (ver migr. 050 destino_pais). El emparejamiento servicio↔paquete se resuelve
--  en app/(dashboard)/dashboard/paquetes/[id]/page.tsx según el país del destino.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.servicios_adicionales
  add column if not exists alcance text not null default 'nacional';

-- Los existentes con destino NULL quedan como 'nacional' (comportamiento previo).
update public.servicios_adicionales set alcance = 'nacional' where alcance is null;
