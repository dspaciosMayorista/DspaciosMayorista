-- Pruebas SQL de la 262 (esquema local desechable, después de aplicar la 255 y la 262). Imprime una fila «OK    nombre» o «FALLA nombre» por comprobación.
-- Todo corre dentro de una transacción que termina en ROLLBACK.
begin;

create temp table _r (resultado text);
create or replace function pg_temp.espera_error(p_sql text, p_estado text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_estado;
end $$;
create or replace function pg_temp.ok(p_nombre text, p_cond boolean) returns void language sql as $$
  insert into _r values (case when coalesce(p_cond, false) then 'OK    ' else 'FALLA ' end || p_nombre);
$$;

insert into public.servicios_adicionales (nombre, categoria) values ('__t262__', 'tour_traslado');
insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin)
  select id, 'V1', '2026-01-01', '2026-12-31' from public.servicios_adicionales where nombre = '__t262__';
create temp table _ids as select s.id as sid, t.id as vid from public.servicios_adicionales s join public.servicio_temporadas t on t.servicio_id = s.id where s.nombre = '__t262__';

-- ── 1. Clasificación ─────────────────────────────────────────────────────────────────────────────────
select pg_temp.ok('servicio antiguo queda SIN clasificar (no se asigna nada solo)', (select tipo_receptivo is null and combo_incluye_traslado is null and combo_traslado_alcance is null from public.servicios_adicionales where nombre = '__t262__'));
select pg_temp.ok('tipo_receptivo fuera de catálogo se rechaza (23514)', pg_temp.espera_error($q$update public.servicios_adicionales set tipo_receptivo = 'otro' where nombre = '__t262__'$q$, '23514'));
update public.servicios_adicionales set tipo_receptivo = 'tour' where nombre = '__t262__';
update public.servicios_adicionales set tipo_receptivo = 'asistencia_medica' where nombre = '__t262__';
select pg_temp.ok('tour, traslado y asistencia_medica se aceptan', (select tipo_receptivo = 'asistencia_medica' from public.servicios_adicionales where nombre = '__t262__'));
update public.servicios_adicionales set tipo_receptivo = 'traslado' where nombre = '__t262__';
select pg_temp.ok('traslado/tour/asistencia no pueden declarar datos de combo (23514)', pg_temp.espera_error($q$update public.servicios_adicionales set combo_incluye_traslado = true, combo_traslado_alcance = 'ida_regreso' where nombre = '__t262__'$q$, '23514'));
select pg_temp.ok('un combo DEBE declarar si contiene traslado (23514)', pg_temp.espera_error($q$update public.servicios_adicionales set tipo_receptivo = 'combo' where nombre = '__t262__'$q$, '23514'));
select pg_temp.ok('combo con traslado DEBE declarar cómo se cobra (23514)', pg_temp.espera_error($q$update public.servicios_adicionales set tipo_receptivo = 'combo', combo_incluye_traslado = true where nombre = '__t262__'$q$, '23514'));
select pg_temp.ok('combo sin traslado no puede traer alcance (23514)', pg_temp.espera_error($q$update public.servicios_adicionales set tipo_receptivo = 'combo', combo_incluye_traslado = false, combo_traslado_alcance = 'ida_regreso' where nombre = '__t262__'$q$, '23514'));
select pg_temp.ok('alcance de combo fuera de catálogo se rechaza (23514)', pg_temp.espera_error($q$update public.servicios_adicionales set tipo_receptivo = 'combo', combo_incluye_traslado = true, combo_traslado_alcance = 'mitad' where nombre = '__t262__'$q$, '23514'));
update public.servicios_adicionales set tipo_receptivo = 'combo', combo_incluye_traslado = true, combo_traslado_alcance = 'trayecto_llegada' where nombre = '__t262__';
select pg_temp.ok('combo con traslado y alcance declarado se acepta', (select combo_traslado_alcance = 'trayecto_llegada' from public.servicios_adicionales where nombre = '__t262__'));
update public.servicios_adicionales set tipo_receptivo = 'combo', combo_incluye_traslado = false, combo_traslado_alcance = null where nombre = '__t262__';
select pg_temp.ok('combo sin traslado se acepta', (select combo_incluye_traslado = false from public.servicios_adicionales where nombre = '__t262__'));

-- ── 2. Precio propio por trayecto / rango ─────────────────────────────────────────────────────────────
insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, precio) select vid, 'trayecto', 50000 from _ids;
insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, precio) select vid, 'ida_regreso', 80000 from _ids;
select pg_temp.ok('un trayecto y ida y regreso por persona son filas independientes (50.000 y 80.000, no mitad/doble)',
  (select count(*) = 2 and min(precio) = 50000 and max(precio) = 80000 from public.servicio_precio_alcance));
select pg_temp.ok('segundo precio por persona del MISMO alcance se rechaza (23505)',
  pg_temp.espera_error(format($q$insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, precio) values (%s, 'trayecto', 1)$q$, (select vid from _ids)), '23505'));
select pg_temp.ok('alcance inválido se rechaza (23514)',
  pg_temp.espera_error(format($q$insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, precio) values (%s, 'mitad', 1)$q$, (select vid from _ids)), '23514'));
select pg_temp.ok('precio negativo se rechaza (23514)',
  pg_temp.espera_error(format($q$insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, pax_desde, pax_hasta, precio) values (%s, 'trayecto', 1, 4, -1)$q$, (select vid from _ids)), '23514'));
select pg_temp.ok('rango con un solo extremo se rechaza (23514)',
  pg_temp.espera_error(format($q$insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, pax_desde, precio) values (%s, 'trayecto', 1, 10)$q$, (select vid from _ids)), '23514'));
select pg_temp.ok('rango invertido se rechaza (23514)',
  pg_temp.espera_error(format($q$insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, pax_desde, pax_hasta, precio) values (%s, 'trayecto', 5, 2, 10)$q$, (select vid from _ids)), '23514'));
insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, pax_desde, pax_hasta, precio)
  select vid, 'trayecto', a, b, p from _ids, (values (1, 4, 45000), (5, 12, 80000), (13, 19, 130000), (20, 40, 190000)) v(a, b, p);
select pg_temp.ok('4 rangos de grupo contiguos del mismo alcance se aceptan', (select count(*) = 4 from public.servicio_precio_alcance where pax_desde is not null));
select pg_temp.ok('rango que se cruza (4–6 sobre 1–4 y 5–12) se rechaza (23P01)',
  pg_temp.espera_error(format($q$insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, pax_desde, pax_hasta, precio) values (%s, 'trayecto', 4, 6, 1)$q$, (select vid from _ids)), '23P01'));
insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, pax_desde, pax_hasta, precio) select vid, 'ida_regreso', 1, 4, 70000 from _ids;
select pg_temp.ok('el mismo rango 1–4 en OTRO alcance (ida y regreso) sí se acepta: no se cruzan entre alcances', (select count(*) = 1 from public.servicio_precio_alcance where alcance = 'ida_regreso' and pax_desde = 1));
select pg_temp.ok('editar un rango sin moverlo no choca consigo mismo',
  not pg_temp.espera_error(format($q$update public.servicio_precio_alcance set precio = 46000 where servicio_temporada_id = %s and alcance = 'trayecto' and pax_desde = 1$q$, (select vid from _ids)), '23P01'));

-- ── 3. Suplementos por rango de pasajeros ─────────────────────────────────────────────────────────────
insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro, pax_desde, pax_hasta)
  select vid, '19:00', '06:00', 'ambos', 'monto', v, 'grupo', a, b from _ids, (values (1, 4, 45000), (5, 12, 80000), (13, 19, 130000), (20, 40, 190000)) x(a, b, v);
select pg_temp.ok('misma franja horaria con 4 importes por rango de pasajeros (45.000 / 80.000 / 130.000 / 190.000)',
  (select count(*) = 4 and min(valor) = 45000 and max(valor) = 190000 from public.servicio_suplementos_franja where servicio_temporada_id = (select vid from _ids)));
select pg_temp.ok('mismo horario y tramo con pasajeros que se cruzan (3–6) se rechaza (23P01)',
  pg_temp.espera_error(format($q$insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro, pax_desde, pax_hasta) values (%s, '20:00', '22:00', 'llegada', 'monto', 1, 'grupo', 3, 6)$q$, (select vid from _ids)), '23P01'));
select pg_temp.ok('una franja SIN rango (todos los pax) choca con las que tienen rango (23P01)',
  pg_temp.espera_error(format($q$insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values (%s, '20:00', '22:00', 'salida', 'monto', 1, 'grupo')$q$, (select vid from _ids)), '23P01'));
select pg_temp.ok('rango de pasajeros fuera del existente (41–60) en el mismo horario sí se acepta',
  not pg_temp.espera_error(format($q$insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro, pax_desde, pax_hasta) values (%s, '19:00', '06:00', 'ambos', 'monto', 250000, 'grupo', 41, 60)$q$, (select vid from _ids)), '23P01'));
select pg_temp.ok('franja con un solo extremo de pasajeros se rechaza (23514)',
  pg_temp.espera_error(format($q$insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro, pax_desde) values (%s, '07:00', '08:00', 'llegada', 'monto', 1, 'grupo', 2)$q$, (select vid from _ids)), '23514'));
select pg_temp.ok('en otro horario sin cruce la misma vigencia admite una franja sin rango',
  not pg_temp.espera_error(format($q$insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values (%s, '10:00', '12:00', 'llegada', 'monto', 5000, 'persona')$q$, (select vid from _ids)), '23P01'));

-- ── 4. Lo vendido ────────────────────────────────────────────────────────────────────────────────────
-- En el esquema completo contrato_servicios depende de ventas (FK): se prueba la restricción propia sin armar toda una venta.
set local session_replication_role = replica;
select pg_temp.ok('contrato_servicios.alcance_traslado rechaza un valor inventado (23514)',
  pg_temp.espera_error($q$insert into public.contrato_servicios (numero_contrato, descripcion, alcance_traslado) values ('T-262', 'x', 'mitad')$q$, '23514'));
select pg_temp.ok('contrato_servicios.alcance_traslado acepta llegada / salida / ida_regreso / NULL',
  not pg_temp.espera_error($q$insert into public.contrato_servicios (numero_contrato, descripcion, alcance_traslado) values ('T-262', 'x', 'ida_regreso'), ('T-262', 'x', 'llegada'), ('T-262', 'x', 'salida'), ('T-262', 'x', null)$q$, '23514'));

set local session_replication_role = origin;

-- ── 5. Cascada y permisos ────────────────────────────────────────────────────────────────────────────
select pg_temp.ok('anon no puede leer servicio_precio_alcance', not has_table_privilege('anon', 'public.servicio_precio_alcance', 'select'));
delete from public.servicio_temporadas where id = (select vid from _ids);
select pg_temp.ok('borrar la vigencia borra sus precios por trayecto', (select count(*) = 0 from public.servicio_precio_alcance));
select pg_temp.ok('borrar la vigencia borra sus franjas', (select count(*) = 0 from public.servicio_suplementos_franja where servicio_temporada_id = (select vid from _ids)));

select resultado from _r;
rollback;
