-- ─────────────────────────────────────────────────────────────────────────
-- CORRECCIÓN PUNTUAL · hotel 53, vigencia ALTA id 140: inicio 0206-12-24 → 2026-12-24
-- Decisión del dueño: «0206» es un error de captura; el inicio correcto es 2026-12-24.
-- QUÉ HACE: cambia ese ÚNICO valor en dos sitios de la MISMA fila (la columna fecha_inicio y el elemento correspondiente de `rangos`,
--           que es el que usa el motor). No cambia ninguna otra columna ni fila, ni el hotel 9, ni tarifas, ni prioridades.
-- GUARDIA: antes de escribir comprueba, con la fila bloqueada, que sigue EXACTAMENTE como se verificó en el preflight; si algo
--          no coincide, aborta con un error y no cambia nada. Una segunda ejecución también aborta (ya no hay 0206).
-- AUDITORÍA: los triggers de historial y auditoría guardan la versión anterior de la fila.
-- NO HACE: no regenera ni publica el tarifario. El cálculo en vivo (cotización por fechas y reserva) usa la vigencia al instante;
--          el tarifario ya publicado de este hotel se actualiza la próxima vez que se regenere (acción del dueño, aparte).
-- ORDEN: 1) preflight_correccion_hotel53_alta140_fecha_inicio.sql → «LISTO PARA CORREGIR»; 2) este archivo;
--        3) postcheck_correccion_hotel53_alta140_fecha_inicio.sql. Reversión exacta: rollback_correccion_hotel53_alta140_fecha_inicio.sql.
-- ─────────────────────────────────────────────────────────────────────────
begin;

do $$
declare
  v_filas integer;
begin
  -- Bloquea la fila para que nadie la cambie entre la comprobación y la escritura.
  perform 1 from public.hotel_temporadas where id = 140 for update;

  if not exists (
    select 1 from public.hotel_temporadas t
    where t.id = 140 and t.hotel_id = 53 and t.nombre = 'ALTA'
      and t.fecha_inicio = date '0206-12-24' and t.fecha_fin = date '2027-01-03'
      and (select count(*) from jsonb_array_elements(t.rangos) e
           where e->>'fecha_inicio' = '0206-12-24' and e->>'fecha_fin' = '2027-01-03') = 1
  ) then
    raise exception 'NO SE APLICA: la fila id=140 no está exactamente como se verificó (hotel 53, ALTA, inicio 0206-12-24, fin 2027-01-03, un solo rango 0206-12-24 → 2027-01-03). No se cambió nada.';
  end if;

  update public.hotel_temporadas t
     set fecha_inicio = date '2026-12-24',
         rangos = (
           select jsonb_agg(
                    case when e->>'fecha_inicio' = '0206-12-24' and e->>'fecha_fin' = '2027-01-03'
                         then jsonb_set(e, '{fecha_inicio}', '"2026-12-24"'::jsonb)
                         else e end
                    order by ord)
           from jsonb_array_elements(t.rangos) with ordinality as x(e, ord))
   where t.id = 140 and t.hotel_id = 53 and t.nombre = 'ALTA'
     and t.fecha_inicio = date '0206-12-24' and t.fecha_fin = date '2027-01-03';

  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'Se esperaba actualizar exactamente 1 fila y fueron %; se revierte todo.', v_filas;
  end if;
end $$;

commit;
