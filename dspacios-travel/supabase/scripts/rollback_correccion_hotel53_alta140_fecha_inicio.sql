-- ─────────────────────────────────────────────────────────────────────────
-- REVERSIÓN EXACTA de correccion_hotel53_alta140_fecha_inicio.sql (vuelve al valor anterior, 0206-12-24).
-- OJO: 0206-12-24 es el error de captura. Esto solo restituye el estado idéntico al de antes de la corrección (si se necesitara
-- volver atrás por cualquier motivo). Misma guardia: solo actúa si la fila está exactamente como la dejó la corrección.
-- ─────────────────────────────────────────────────────────────────────────
begin;

do $$
declare
  v_filas integer;
begin
  perform 1 from public.hotel_temporadas where id = 140 for update;

  if not exists (
    select 1 from public.hotel_temporadas t
    where t.id = 140 and t.hotel_id = 53 and t.nombre = 'ALTA'
      and t.fecha_inicio = date '2026-12-24' and t.fecha_fin = date '2027-01-03'
      and (select count(*) from jsonb_array_elements(t.rangos) e
           where e->>'fecha_inicio' = '2026-12-24' and e->>'fecha_fin' = '2027-01-03') = 1
  ) then
    raise exception 'NO SE REVIERTE: la fila id=140 no está como la dejó la corrección. No se cambió nada.';
  end if;

  update public.hotel_temporadas t
     set fecha_inicio = date '0206-12-24',
         rangos = (
           select jsonb_agg(
                    case when e->>'fecha_inicio' = '2026-12-24' and e->>'fecha_fin' = '2027-01-03'
                         then jsonb_set(e, '{fecha_inicio}', '"0206-12-24"'::jsonb)
                         else e end
                    order by ord)
           from jsonb_array_elements(t.rangos) with ordinality as x(e, ord))
   where t.id = 140 and t.hotel_id = 53 and t.nombre = 'ALTA'
     and t.fecha_inicio = date '2026-12-24' and t.fecha_fin = date '2027-01-03';

  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'Se esperaba revertir exactamente 1 fila y fueron %; se revierte todo.', v_filas;
  end if;
end $$;

commit;
