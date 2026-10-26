-- #118 — «Cupos disponibles» y «Cupos críticos» del Home, con unidades claras.
-- Aditiva: NO toca fn_dashboard_cupos_resumen (186), solo agrega una función
-- nueva. Mismo patrón que la 186: SECURITY INVOKER sobre cupos_por_bloqueo
-- (security_invoker = true), así la RLS de bloqueos/sillas sigue filtrando.
--
-- Reglas:
--   · record ACTIVO = fecha_ida nula o >= p_hoy (mismo criterio que el
--     inventario: lib/vuelos/stats.ts esPasado). p_hoy lo manda la app con la
--     fecha de Bogotá.
--   · sillas disponibles = suma de cupos_disponibles de los records activos; un
--     record sin sillas aporta 0 (greatest) y no cuenta como «record con sillas».
--   · próximos = activos con fecha_ida entre p_hoy y p_hoy + 14 (ambos
--     inclusive); el día 15 y los pasados quedan fuera. fecha nula nunca entra.
create or replace function public.fn_dashboard_cupos_activos(p_hoy date)
returns table(
  capacidad bigint, ocupados bigint,
  disponibles bigint, records_disponibles bigint,
  proximos_disponibles bigint, proximos_records bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select
    coalesce(sum(cupos_total), 0)::bigint,
    coalesce(sum(cupos_ocupados), 0)::bigint,
    coalesce(sum(greatest(cupos_disponibles, 0)), 0)::bigint,
    count(*) filter (where cupos_disponibles > 0),
    coalesce(sum(greatest(cupos_disponibles, 0)) filter (where fecha_ida <= p_hoy + 14), 0)::bigint,
    count(*) filter (where cupos_disponibles > 0 and fecha_ida <= p_hoy + 14)
  from public.cupos_por_bloqueo
  where fecha_ida is null or fecha_ida >= p_hoy;
$$;

revoke all on function public.fn_dashboard_cupos_activos(date) from public, anon;
grant execute on function public.fn_dashboard_cupos_activos(date) to authenticated, service_role;
