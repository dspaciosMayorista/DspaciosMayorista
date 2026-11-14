-- Datos de prueba de la 301 (se cargan ANTES de aplicarla, sobre la cadena de la 300). Hotel 9305: tarifa ALTA en junio de 2027,
-- una promoción existente (930510) y una regla EBB 30 días activa ⇒ al aplicar la 301 la promoción queda «heredada» con EBB.
insert into public.hoteles (id, destino_id, nombre, modelo_tarifario) values (9305, 9301, 'T301 ACUMULACION', 'persona') on conflict (id) do nothing;
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
  (930501, 9305, 'ALTA', '2027-06-01', '2027-06-30', 1, 'tarifa');
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor) values
  (930510, 9305, 'HEREDADA', '2027-06-01', '2027-06-30', 2, 'descuento_pct', 10);
insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct, activa) values (9305, 'ebb', 30, 12, true);
