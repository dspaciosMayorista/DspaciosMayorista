-- ───────────────────────────────────────────────────────────────────────────
-- AUDITORÍA DE TARIFAS RECUPERABLES (pendiente #26) — SOLO LECTURA.
-- No escribe, no restaura, no publica. Se puede correr ANTES o DESPUÉS de la
-- migración 203 (no usa nada de ella). Correr en el editor SQL como rol con
-- acceso a `auditoria` (la RLS de la 087 solo deja leerla a superadmin/gerencia).
--
-- Qué conserva `auditoria` (087/108): por cada UPDATE/DELETE de `tarifa_hotel`
-- y de `hotel_temporadas`, la fila COMPLETA anterior en `antes` (y la nueva en
-- `despues` para UPDATE/INSERT), con fecha, actor (null si fue service_role) y
-- `registro_id` = id de la fila. Límites: nada anterior a la aplicación de la
-- 087; columnas agregadas después de una versión no aparecen en su `antes`
-- (p. ej. `precio_final_autoritativo` antes de la 179); TRUNCATE no se audita.
-- ───────────────────────────────────────────────────────────────────────────

-- 1) Cobertura: desde cuándo hay auditoría de tarifas y vigencias.
select tabla, accion, count(*) as eventos, min(creado_en) as primero, max(creado_en) as ultimo
from public.auditoria
where tabla in ('tarifa_hotel', 'hotel_temporadas')
group by tabla, accion
order by tabla, accion;

-- 2) Por hotel: versiones de tarifa recuperables (UPDATE/DELETE con `antes`).
--    `hoy_sin_fila` = versiones cuya combinación categoría/régimen/temporada ya
--    no existe en `tarifa_hotel` (lo que solo vive en auditoría).
with v as (
  select (a.antes->>'hotel_id')::bigint as hotel_id, a.accion, a.creado_en,
         not exists (
           select 1 from public.tarifa_hotel th
           where th.hotel_id = (a.antes->>'hotel_id')::bigint
             and btrim(th.tipo_habitacion) = btrim(a.antes->>'tipo_habitacion')
             and btrim(th.alimentacion) = btrim(a.antes->>'alimentacion')
             and btrim(th.temporada) = btrim(a.antes->>'temporada')) as sin_fila
  from public.auditoria a
  where a.tabla = 'tarifa_hotel' and a.accion in ('UPDATE', 'DELETE') and a.antes is not null
)
select v.hotel_id, h.nombre as hotel,
       count(*) filter (where v.accion = 'DELETE') as eliminadas,
       count(*) filter (where v.accion = 'UPDATE') as modificadas,
       count(*) filter (where v.sin_fila) as hoy_sin_fila,
       min(v.creado_en) as desde, max(v.creado_en) as hasta
from v
left join public.hoteles h on h.id = v.hotel_id
group by v.hotel_id, h.nombre
order by eliminadas desc, hotel_id;

-- 3) Por hotel y temporada: qué precios se perdieron de la tabla viva.
with d as (
  select (a.antes->>'hotel_id')::bigint as hotel_id, btrim(a.antes->>'temporada') as temporada,
         btrim(a.antes->>'alimentacion') as regimen, a.creado_en
  from public.auditoria a
  where a.tabla = 'tarifa_hotel' and a.accion = 'DELETE' and a.antes is not null
)
select d.hotel_id, d.temporada, d.regimen, count(*) as eliminadas, max(d.creado_en) as ultima_eliminacion,
       exists (select 1 from public.hotel_temporadas t
               where t.hotel_id = d.hotel_id and btrim(t.nombre) = d.temporada) as vigencia_existe_hoy
from d
group by d.hotel_id, d.temporada, d.regimen
order by hotel_id, temporada, regimen;

-- 4) Hotel 59 / vigencia 674 (BLU BY TAMACÁ): SOLO verificación del respaldo.
--    Esperado: las filas PC y PAM eliminadas el 2026-10-01 (20:05:29 y 20:18:51 UTC).
--    No se restauran ni se incorporan sin nueva autorización.
select a.id as auditoria_id, a.creado_en, a.accion, a.actor_email,
       a.antes->>'alimentacion' as regimen, a.antes->>'tipo_habitacion' as categoria,
       a.antes->>'neto_sencilla' as sencilla, a.antes->>'neto_doble' as doble
from public.auditoria a
where a.tabla = 'tarifa_hotel' and a.accion = 'DELETE'
  and (a.antes->>'hotel_id')::bigint = 59
  and btrim(a.antes->>'temporada') = (select btrim(nombre) from public.hotel_temporadas where id = 674)
order by a.id;

-- 5) Después de aplicar la 203, el detalle completo con la vigencia
--    reconstruida al momento de cada cambio (también solo lectura):
--      select * from public.reconstruir_tarifas_desde_auditoria(<hotel_id>);
--      select * from public.reconstruir_tarifas_desde_auditoria(null);  -- todos
