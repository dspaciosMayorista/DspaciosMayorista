-- REV2 · BLOQUE 3 — semilla ADITIVA e idempotente para el recorrido corregido (B3-01…B3-03). NO se ejecuta contra rev_consolidada sin decisión del coordinador (requiere la migración 344).
-- Cuentas ficticias de presencia: sin contraseña ni correo real; dominio @consolidada.test; se pueden retirar con el bloque «LIMPIEZA» del final.
-- 1) Paginación de presencia: 45 personas internas con rol control_vuelo (así NO entran en los selectores de asesor ni en los conteos de venta/operaciones de otros pasos) y 25 aliados (agencia/freelance) con presencia repartida (algunos recientes, otros de horas o días, otros sin observación).
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000b3' || lpad(g::text, 3, '0'))::uuid, 'presencia' || lpad(g::text, 2, '0') || '@consolidada.test' from generate_series(1, 70) g on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id)
select ('00000000-0000-0000-0000-0000000b3' || lpad(g::text, 3, '0'))::uuid, 'presencia' || lpad(g::text, 2, '0') || '@consolidada.test',
       case when g <= 45 then 'Equipo Rev2 ' else 'Aliado Rev2 ' end || lpad(g::text, 2, '0'),
       (case when g <= 45 then 'control_vuelo' else (array['agencia', 'freelance'])[1 + g % 2] end)::public.rol_usuario,
       true, 'mayorista', null
  from generate_series(1, 70) g on conflict (id) do update set rol = excluded.rol, activo = true, nombre = excluded.nombre, tenant = excluded.tenant;
insert into public.presencia_usuario (usuario_id, visto_en)
select id, now() - make_interval(mins => case right(id::text, 3)::int % 4 when 0 then 2 when 1 then 90 when 2 then 3000 else 0 end)
  from public.usuarios where email like 'presencia%@consolidada.test' and right(id::text, 3)::int % 5 <> 0 on conflict (usuario_id) do nothing;

-- 2) B3-03: vigencias de compra de HOTEL y de SERVICIO a 1 y 4 días de hoy (Bogotá). Dos hoteles NUEVOS (12041 y 12042, ninguno usado por paquetes existentes: así no se invalida ningún tarifario ya generado) con el MISMO nombre y la MISMA vigencia, para comprobar que cada alerta abre SU hotel (por id guardado, no por nombre).
insert into public.hoteles (id, destino_id, nombre, modelo_tarifario, moneda, tarifa_bajo_solicitud, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max)
values (12041, 12001, 'Hotel Caribe Plaza', 'persona', 'COP', false, 0, 2, 2, 10), (12042, 12001, 'Hotel Caribe Plaza', 'persona', 'COP', false, 0, 2, 2, 10) on conflict (id) do nothing;
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, compra_fin) values
  (120401, 12042, 'ALTA DICIEMBRE REV2', public.fecha_negocio() + 40, public.fecha_negocio() + 70, public.fecha_negocio() + 1),
  (120402, 12041, 'ALTA DICIEMBRE REV2', public.fecha_negocio() + 40, public.fecha_negocio() + 70, public.fecha_negocio() + 1)
on conflict (id) do nothing;
insert into public.servicios_adicionales (id, nombre, activo) values (12051, 'Tour Islas del Rosario REV2', true) on conflict (id) do nothing;
insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, compra_fin) values (120501, 12051, 'NAVIDAD REV2', public.fecha_negocio() + 40, public.fecha_negocio() + 70, public.fecha_negocio() + 4) on conflict (id) do nothing;

-- 3) Una pasada del generador (como el cron): crea las alertas nuevas para las personas que escriben paquetes. Las alertas VIVAS que dejó la semilla anterior (07 + post_semillas: paquete, salida dinámica, empaquetado, paquete total) conservan su forma (ventana_tipo/id/ref/titulo/compra_fin) y quedan como activas SIN revisar (revisado_en nace null con la 344); el generador solo añade lo que falta y archiva lo que ya no aplica.
select public.generar_avisos_compra();
-- Comprobación de coherencia (solo lectura): alertas vivas por fuente. Esperado con esta semilla el mismo día: paquete/salida_dinamica/empaquetado/paquete_total = 1 por destinatario cada una (más un segundo «paquete»), hotel_vigencia = 2, servicio_vigencia = 1.
select ventana_tipo, count(distinct ventana_id) as alertas, count(*) as filas_por_persona, count(*) filter (where revisado_en is not null) as revisadas from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null group by ventana_tipo order by ventana_tipo;

-- LIMPIEZA (solo si se retira la semilla):
-- delete from public.avisos where ventana_tipo in ('hotel_vigencia', 'servicio_vigencia');
-- delete from public.hotel_temporadas where id in (120401, 120402); delete from public.hoteles where id in (12041, 12042);
-- delete from public.servicio_temporadas where id = 120501; delete from public.servicios_adicionales where id = 12051;
-- delete from public.presencia_usuario where usuario_id::text like '00000000-0000-0000-0000-0000000b3%'; delete from public.usuarios where id::text like '00000000-0000-0000-0000-0000000b3%'; delete from auth.users where id::text like '00000000-0000-0000-0000-0000000b3%';
