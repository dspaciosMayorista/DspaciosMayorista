-- B2-11 / B2-12a (rev2) — dos cotizaciones SINTÉTICAS para ver la ficha del titular sin crear nada a mano. Aditiva e idempotente (no toca filas existentes).
-- No cargada en la base del dueño: el coordinador decide cómo cargarla (copia desechable o aditiva con respaldo).
--   · «Titular Ficha Uno»: dinámica abierta de la agencia mayorista con titular completo, 1 niño, 1 infante y 1 viajero guardado.
--   · «Titular Ficha Dos»: carrito de un freelance (venta B2B) con titular SIN teléfono ni correo: la ficha debe decir «No registrado».
insert into public.cotizaciones (tenant, tipo, estado, cliente, cliente_documento, destino, hotel, pax, moneda, precio_venta, fecha_salida, fecha_regreso, vigencia_hasta, asesor, payload)
select 'mayorista', 'manual', 'abierta', 'Titular Ficha Uno', '88100001', 'CARTAGENA', 'Hotel Ficha Uno', 2, 'COP', 1500000, '2030-05-10', '2030-05-13', '2030-04-30', 'Rev Venta',
  '{"cliente":{"nombres":"Titular","apellidos":"Ficha Uno","tipoDoc":"CC","numeroDoc":"88100001","nacimiento":"1988-03-15","telefono":"3115550001","email":"ficha.uno@consolidada.test"},"ninos":1,"infantes":1,"tipoAsesor":"interno","pasajeros":[{"nombres":"Viajero","apellidos":"Ficha Uno","tipoDoc":"CC","numeroDoc":"88100002","fechaNacimiento":"1990-07-20","nacionalidad":"Colombiana"}]}'::jsonb
where not exists (select 1 from public.cotizaciones where tenant = 'mayorista' and cliente = 'Titular Ficha Uno');

insert into public.cotizaciones (tenant, tipo, estado, cliente, cliente_documento, destino, pax, moneda, precio_venta, fecha_salida, fecha_regreso, vigencia_hasta, payload)
select 'mayorista', 'carrito', 'abierta', 'Titular Ficha Dos', '88200001', 'SAN ANDRES', 2, 'COP', 2000000, '2030-06-10', '2030-06-13', '2030-05-30',
  '{"cliente":{"nombres":"Titular","apellidos":"Ficha Dos","tipoDoc":"","numeroDoc":"88200001"},"tipoAsesor":"freelance","freelanceNombre":"Freelance Humo","items":[{"ref":"it-ficha-dos","destino":"SAN ANDRES","pax":2,"fechaIda":"2030-06-10","hotelNombre":"Hotel Ficha Dos","precio":2000000}],"tours":[]}'::jsonb
where not exists (select 1 from public.cotizaciones where tenant = 'mayorista' and cliente = 'Titular Ficha Dos');
