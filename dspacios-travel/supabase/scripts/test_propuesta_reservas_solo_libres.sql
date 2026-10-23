-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBA de la PROPUESTA supabase/propuestas/reservas_solo_sillas_libres.sql
-- (sin aplicarla de verdad): se carga DENTRO de una transacción que termina en
-- ROLLBACK. SOLO base LOCAL o DESECHABLE (192–196 aplicadas). Uso:
--   { echo 'begin;'; cat supabase/propuestas/reservas_solo_sillas_libres.sql; \
--     cat supabase/scripts/test_propuesta_reservas_solo_libres.sql; } | psql -v ON_ERROR_STOP=1
-- (este archivo NO abre la transacción: la abre el comando de arriba).
-- ───────────────────────────────────────────────────────────────────────────
create function pg_temp.ok(p boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p, false) then raise exception 'FALLO: %', p_msg; end if;
  raise notice 'OK   %', p_msg;
end $$;
create function pg_temp.falla(p_sql text, p_patron text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_patron in sqlerrm) > 0 then raise notice 'OK   % → «%»', p_msg, sqlerrm; return; end if;
    raise exception 'FALLO: % → error inesperado «%» (se esperaba «%»)', p_msg, sqlerrm, p_patron;
  end;
  raise exception 'FALLO: % → no falló (se esperaba «%»)', p_msg, p_patron;
end $$;

select pg_temp.ok(position('_silla_libre' in pg_get_viewdef('public.cupos_por_bloqueo'::regclass)) > 0
  and position('_silla_libre' in pg_get_functiondef('public._ajustar_sillas_bloqueo_nucleo(text, bigint, integer)'::regprocedure)) > 0
  and position('_vaciar_sillas' in pg_get_functiondef('public._ajustar_sillas_bloqueo_nucleo(text, bigint, integer)'::regprocedure)) > 0,
  'propuesta cargada en esta transacción (y conserva la liberación limpia de la 196)');

insert into public.bloqueos_vuelo (record, cupos_total) values ('PRO001', 6);
insert into public.sillas (bloqueo_id, numero_silla, estado) select b.id, g, 'disponible' from public.bloqueos_vuelo b, generate_series(1, 6) g where b.record = 'PRO001';
update public.sillas set pasajero_nombres = 'CARGA MASIVA', numero_doc = '555' where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PRO001') and numero_silla = 3;
update public.sillas set asesor = 'RESIDUO' where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PRO001') and numero_silla = 4;
update public.sillas set inf_nombres = 'BEBE' where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PRO001') and numero_silla = 5;
insert into public.ventas (numero_contrato, cliente, tenant, estado) values ('DTM-9971', 'pr', 'mayorista', 'pendiente'), ('DTM-9972', 'pr', 'mayorista', 'pendiente');

select pg_temp.ok((select cupos_disponibles = 3 and cupos_disponibles_con_datos = 3 from public.cupos_por_bloqueo where record = 'PRO001'),
  'vista: 3 libres de verdad (1, 2 y 6) y 3 "disponibles" con datos que ya no se venden');

create temp table a1 as select * from public._ajustar_sillas_bloqueo_nucleo('DTM-9971', (select id from public.bloqueos_vuelo where record = 'PRO001'), 2);
select pg_temp.ok((select array_agg(numero_silla order by numero_silla) from public.sillas where numero_contrato = 'DTM-9971') = array[1, 2],
  'reserva de 2: toma las sillas 1 y 2 (libres de verdad), nunca la 3/4/5');
select pg_temp.ok((select pasajero_nombres = 'CARGA MASIVA' and numero_contrato is null from public.sillas
                    where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PRO001') and numero_silla = 3),
  'el pasajero de carga masiva no se sobrescribe');
select pg_temp.falla(format('select * from public._ajustar_sillas_bloqueo_nucleo(%L, %s, 2)', 'DTM-9972', (select id from public.bloqueos_vuelo where record = 'PRO001')),
  'No hay suficientes sillas disponibles en el bloqueo (1 disponibles, 2 requeridas)',
  'reserva de 2 con 1 libre real: rechazada (antes se habría asignado una silla con datos de otra persona)');
select pg_temp.ok((select count(*) from public.sillas where numero_contrato = 'DTM-9972') = 0,
  'el rechazo no asignó nada');

rollback;
\echo 'TODAS LAS PRUEBAS PASARON (propuesta cargada y revertida: NO quedó aplicada)'
