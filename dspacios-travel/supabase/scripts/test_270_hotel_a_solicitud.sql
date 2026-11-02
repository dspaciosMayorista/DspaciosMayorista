-- Pruebas de la 270 (#120). Corren dentro de una transacción que termina en ROLLBACK. Requieren la semilla de test_259 (usuario superadmin ...a1) y la 269 aplicada.
-- Cada caso imprime OK/FALLA; RESUMEN al final. Ejecutadas contra Postgres real (plantilla255 + 255..268 + 270).
begin;
create temp table _r (caso text, ok boolean) on commit drop;
grant all on _r to public;
create or replace function pg_temp.espera_error(p_sql text, p_patron text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlerrm like '%' || p_patron || '%'; end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

do $$
declare v_dest bigint; v_h bigint; v_h2 bigint; v_pq bigint; v_c bigint; v_c2 bigint; v_json jsonb;
begin
  insert into public.destinos (id, nombre) overriding system value values (926900, 'T270') returning id into v_dest;
  insert into public.hoteles (id, destino_id, nombre) overriding system value values (926901, v_dest, 'T270 sin tarifas') returning id into v_h;
  insert into public.hoteles (id, destino_id, nombre) overriding system value values (926902, v_dest, 'T270 tarifado') returning id into v_h2;
  insert into _r select 'la marca nace apagada', not (select tarifa_bajo_solicitud from public.hoteles where id = v_h);

  -- marcar un hotel sin tarifas: permitido; tarifas solo desmarcando
  update public.hoteles set tarifa_bajo_solicitud = true where id = v_h;
  insert into _r select 'marcar hotel sin tarifas', (select tarifa_bajo_solicitud from public.hoteles where id = v_h);
  insert into _r select 'no se cargan tarifas a un hotel marcado',
    pg_temp.espera_error(format($q$insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada) values (%s,'X','PC','T')$q$, v_h), 'HOTEL_BAJO_SOLICITUD');

  -- un hotel CON tarifas no se puede marcar (los hoteles tarifados no cambian)
  insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada) values (v_h2, 'X', 'PC', 'T');
  insert into _r select 'no se marca un hotel con tarifas', pg_temp.espera_error(format('update public.hoteles set tarifa_bajo_solicitud = true where id = %s', v_h2), 'HOTEL_BAJO_SOLICITUD');
  insert into _r select 'el hotel tarifado sigue sin marca', not (select tarifa_bajo_solicitud from public.hoteles where id = v_h2);

  -- un hotel por unidad no se marca
  insert into _r select 'no se marca un hotel por unidad',
    pg_temp.espera_error(format($q$update public.hoteles set modelo_tarifario = 'unidad', tarifa_bajo_solicitud = true where id = %s$q$, v_h), 'hoteles_bajo_solicitud_no_unidad');

  -- cotización pendiente de tarifa
  insert into public.armado_paquetes (id, nombre, tipo) overriding system value values (926903, 'T270 pq', 'porcion_terrestre') returning id into v_pq;
  insert into public.cotizaciones (id, tenant, estado, payload, detalle, cliente, paquete_armado_id, precio_venta)
    values (926904, 'mayorista', 'pendiente_tarifa', jsonb_build_object('hotelId', v_h), '{}'::jsonb, 'Cliente', v_pq, 0) returning id into v_c;
  insert into _r select 'nace pendiente sin precio', (select estado = 'pendiente_tarifa' and precio_venta = 0 from public.cotizaciones where id = v_c);
  insert into _r select 'pendiente con precio al nacer se rechaza',
    pg_temp.espera_error($q$insert into public.cotizaciones (tenant, estado, payload, cliente, precio_venta) values ('mayorista','pendiente_tarifa','{}','x',5)$q$, 'COTIZACION_PENDIENTE_TARIFA');
  insert into _r select 'no se convierte una pendiente', pg_temp.espera_error(format($q$update public.cotizaciones set estado = 'convertida' where id = %s$q$, v_c), 'COTIZACION_PENDIENTE_TARIFA');
  insert into _r select 'no se abre sin neta', pg_temp.espera_error(format($q$update public.cotizaciones set estado = 'abierta', precio_venta = 100 where id = %s$q$, v_c), 'COTIZACION_PENDIENTE_TARIFA');
  insert into _r select 'no se desmarca con una solicitud pendiente', pg_temp.espera_error(format('update public.hoteles set tarifa_bajo_solicitud = false where id = %s', v_h), 'HOTEL_BAJO_SOLICITUD');

  -- carga de neta como usuario autenticado con rol de producto: atómica, idempotente, neta distinta rechazada
  execute 'set local role authenticated';
  v_json := public.cargar_neta_solicitud(v_c, 'hotel', 1200000, 'COP', 0.2, 1500000, '{"venta":{}}'::jsonb, current_date + 1);
  insert into _r select 'cargar neta abre la cotización con el precio congelado', (v_json ->> 'repetida') = 'false';
  v_json := public.cargar_neta_solicitud(v_c, 'hotel', 1200000, 'COP', 0.2, 1500000, '{"venta":{}}'::jsonb, current_date + 1);
  insert into _r select 'misma neta = no-op (reintento)', (v_json ->> 'repetida') = 'true';
  insert into _r select 'neta distinta se rechaza', pg_temp.espera_error(format($q$select public.cargar_neta_solicitud(%s,'hotel',999,'COP',0.2,1000,'{}'::jsonb,null)$q$, v_c), 'NETA_DISTINTA');
  execute 'reset role';
  insert into _r select 'queda una sola fila de neta', (select count(*) = 1 from public.cotizacion_tarifa_solicitud where cotizacion_id = v_c);
  insert into _r select 'tras valorar ya no vuelve a pendiente', pg_temp.espera_error(format($q$update public.cotizaciones set estado = 'pendiente_tarifa' where id = %s$q$, v_c), 'COTIZACION_PENDIENTE_TARIFA');
  insert into _r select 'no se desmarca con una cotización valorada aún abierta', pg_temp.espera_error(format('update public.hoteles set tarifa_bajo_solicitud = false where id = %s', v_h), 'HOTEL_BAJO_SOLICITUD');

  -- sin sesión no se carga neta; anon no lee las netas
  insert into public.cotizaciones (id, tenant, estado, payload, detalle, cliente, paquete_armado_id, precio_venta)
    values (926905, 'mayorista', 'pendiente_tarifa', jsonb_build_object('hotelId', v_h), '{}'::jsonb, 'Cliente 2', v_pq, 0) returning id into v_c2;
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role authenticated';
  insert into _r select 'sin sesión no se carga neta', pg_temp.espera_error(format($q$select public.cargar_neta_solicitud(%s,'hotel',1,'COP',0,1,'{}'::jsonb,null)$q$, v_c2), 'NETA_SIN_PERMISO');
  execute 'reset role';
  execute 'set local role anon';
  insert into _r select 'anon no lee las netas', pg_temp.espera_error('select * from public.cotizacion_tarifa_solicitud', 'permission denied');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

  -- resolver las solicitudes libera la marca
  update public.cotizaciones set estado = 'descartada' where id in (v_c, v_c2);
  update public.hoteles set tarifa_bajo_solicitud = false where id = v_h;
  insert into _r select 'desmarcar tras resolver las solicitudes', not (select tarifa_bajo_solicitud from public.hoteles where id = v_h);
end $$;

select case when ok then 'OK    ' else 'FALLA ' end || caso as resultado from _r order by ok, caso;
select 'RESUMEN: ' || count(*) filter (where ok) || ' OK, ' || count(*) filter (where not ok) || ' FALLAS' from _r;
rollback;
