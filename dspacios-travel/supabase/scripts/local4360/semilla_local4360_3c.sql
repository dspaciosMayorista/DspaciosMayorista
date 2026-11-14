-- Semilla SINTÉTICA de la entrega 3c (#43/#60, migración 299) para el entorno local4360. Idempotente.
-- LOCAL 1 · «PUENTE» (15–17 mar 2027, lunes a miércoles, prioridad 1) compite con ALTA en Estándar/PAM doble: al aplicar ALTA por grupos,
-- la revisión debe mostrar «Empate de prioridad entre ALTA y PUENTE»; subir PUENTE a prioridad 2 lo resuelve.
begin;
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo)
values (4360015, 436001, 'PUENTE', '2027-03-15', '2027-03-17', 1, 'tarifa')
on conflict (id) do nothing;
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble)
select 436001, 'Estándar', 'PAM', 'PUENTE', 110000
 where not exists (select 1 from public.tarifa_hotel where hotel_id = 436001 and temporada = 'PUENTE');
commit;
