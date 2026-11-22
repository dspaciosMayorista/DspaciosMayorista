-- #126-E · contratos de prueba para «Viaje más reciente» en Gestión de contratos: salida AYER / HOY / MAÑANA / pasado mañana / sin fecha / muy antigua, calculadas con el día de Bogotá (public.fecha_negocio()) al correr el script.
-- SOLO COPIA DESECHABLE (#126). Rehúsa correr fuera de una base cuyo nombre empiece por «rev_verif» y nunca toca la base de revisión del dueño ni producción.
-- Orden de preparación de la copia (ver docs/tecnico/followup-126-acceptance-matrix-2026-11-18.md §9): crear la copia desde rev_verif_corr → migraciones 312 y 313 → seed126.sql … seed126d.sql → seed126e.sql.
-- Requisito: existe el contrato DTM-10608 en la copia (se clona su fila de ventas como molde); si no existe, falla sin cambiar nada.
do $$
begin
  if current_database() !~ '^rev_verif' then
    raise exception 'seed126e: solo en copias desechables rev_verif_*; base actual: %. No se cambió nada.', current_database();
  end if;
  if not exists (select 1 from public.ventas where numero_contrato = 'DTM-10608') then
    raise exception 'seed126e: falta el contrato molde DTM-10608 en esta copia.';
  end if;
end $$;
begin;
create temp table t on commit drop as select * from public.ventas where numero_contrato = 'DTM-10608' limit 1;
create temp table e (numero text, cliente text, salida date) on commit drop;
insert into e values
  ('DTM-12611', 'E126 salida AYER',          public.fecha_negocio() - 1),
  ('DTM-12612', 'E126 salida HOY',           public.fecha_negocio()),
  ('DTM-12613', 'E126 salida MANANA',        public.fecha_negocio() + 1),
  ('DTM-12614', 'E126 salida pasado manana', public.fecha_negocio() + 2),
  ('DTM-12615', 'E126 sin fecha de salida',  null),
  ('DTM-12616', 'E126 salida muy antigua',   public.fecha_negocio() - 400);
-- una fila por contrato: se copia el molde y se le cambian identidad, estado y fechas
insert into public.ventas
  select (x).* from (
    select json_populate_record(t, json_build_object(
      'numero_contrato', e.numero, 'contrato_uid', gen_random_uuid(), 'share_token', gen_random_uuid(), 'reserva_token', null, 'estado', 'pendiente', 'cliente', e.cliente,
      'precio_venta', 1000000, 'moneda', 'COP', 'moneda_cobro', null, 'trm_cobro', null, 'total_cobro', null, 'trm_contrato', null, 'nacio_de_reuso', false,
      'cotizacion_id', null, 'cotizacion_origen_id', null, 'grupo_conversion', null, 'fecha_salida', e.salida, 'fecha_regreso', case when e.salida is null then null else e.salida + 3 end,
      'obligaciones_materializadas_en', null)) as x
    from e cross join t) q;
commit;
select numero_contrato, cliente, fecha_salida from public.ventas where numero_contrato like 'DTM-1261_' order by fecha_salida nulls last, numero_contrato;
