-- #126-E · re-ancla al DÍA DE HOY (Bogotá) las salidas de los seis contratos sintéticos DTM-12611..12616, para que la guía dé siempre el mismo resultado el día de la revisión.
-- Solo cambia `fecha_salida`/`fecha_regreso` de ESOS seis contratos (ayer / hoy / mañana / pasado mañana / sin fecha / muy antiguo); no toca ningún otro dato ni el avance de la revisión. Idempotente.
-- Uso: docker exec -i -e PGPASSWORD=postgres pgb2b psql -h 127.0.0.1 -U supabase_admin -d rev_verif_int_revision -X -q -v ON_ERROR_STOP=1 < supabase/scripts/localreview_integrado/reanclar_126e.sql
do $$ begin
  if current_database() !~ '^rev_verif' then raise exception 'reanclar_126e: solo en bases rev_verif_*; base actual: %', current_database(); end if;
end $$;
update public.ventas v set fecha_salida = d.salida, fecha_regreso = case when d.salida is null then null else d.salida + 3 end
from (values
  ('DTM-12611', public.fecha_negocio() - 1), ('DTM-12612', public.fecha_negocio()), ('DTM-12613', public.fecha_negocio() + 1),
  ('DTM-12614', public.fecha_negocio() + 2), ('DTM-12615', null::date), ('DTM-12616', public.fecha_negocio() - 400)
) d(numero, salida)
where v.numero_contrato = d.numero and (v.fecha_salida is distinct from d.salida);
select numero_contrato, fecha_salida from public.ventas where numero_contrato like 'DTM-1261_' order by fecha_salida nulls last, numero_contrato;
