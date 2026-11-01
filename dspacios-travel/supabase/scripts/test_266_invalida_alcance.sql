-- Pruebas SQL de la 266 (SOLO base local desechable con 255/256/258/259/262/263/264/265 + test_259_semilla.sql). Lo corre test_266_invalida_alcance.sh, ANTES de la 266 (el hueco debe verse) y DESPUÉS.
-- Cubre: editar precio por alcance / franja / clasificación oculta al instante la tarifa anterior; una actualización SIN cambio no invalida; regenerar vuelve a publicar; y la RPC
-- reemplazar_precios_alcance con los CUATRO rangos de un traslado (tiempos, atomicidad, rol authenticated). «Vendible» = visible en tarifario_resultado_publicable y tarifario_paquete_publicable.
\set ON_ERROR_STOP on
\set QUIET on
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);

drop table if exists public.t_res; drop table if exists public.t_med;
create table public.t_res (ok boolean, msg text);
create table public.t_med (k text, ms numeric, extra text);
create or replace function public.t_ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin insert into public.t_res values (coalesce(p_cond, false), p_msg); raise notice '% %', case when coalesce(p_cond, false) then '  OK ' else '  FALLA' end, p_msg; end $$;
create or replace function public.t_vis() returns bigint language sql as $$ select count(*) from public.tarifario_resultado_publicable where paquete_id = 73 $$;
create or replace function public.t_vendible() returns boolean language sql as $$ select public.t_vis() > 0 and public.tarifario_paquete_publicable(73) $$;
create or replace function public.t_rev() returns bigint language sql as $$ select tarifario_revision_fuente from public.armado_paquetes where id = 73 $$;
-- Publicación con el publicador de siempre (259): deja el paquete 73 publicado y vendible.
create or replace function public.t_republicar() returns void language plpgsql as $$
declare g bigint; r bigint;
begin
  select generacion, revision_capturada into g, r from public.iniciar_generacion_tarifario(73);
  if not public.publicar_tarifario_resultado(73, g, r, 'COP', public.bench_filas(60, 73)) then raise exception 'no publicó'; end if;
end $$;

-- ── Mundo ──────────────────────────────────────────────────────────────────────────
truncate public.tarifario_resultado cascade;
delete from public.armado_servicios;
update public.armado_paquetes set tarifario_estado = 'pendiente', tarifario_snapshot_publicable = false;
insert into public.servicios_adicionales (id, nombre, tipo_receptivo) overriding system value values (112, 'Traslados in/out', 'traslado') on conflict (id) do update set tipo_receptivo = 'traslado';
insert into public.servicios_adicionales (id, nombre, tipo_receptivo, combo_incluye_traslado, combo_traslado_alcance) overriding system value values (113, 'Combo con traslado', 'combo', true, 'ida_regreso')
  on conflict (id) do update set tipo_receptivo = 'combo', combo_incluye_traslado = true, combo_traslado_alcance = 'ida_regreso';
delete from public.servicio_temporadas where servicio_id in (112, 113);
insert into public.servicio_temporadas (servicio_id, nombre) values (112, 'GENERAL'), (113, 'GENERAL');
insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin) values (112, 'ALTA', '2030-01-01', '2030-03-31');
insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, pax_desde, pax_hasta, precio)
  select id, 'trayecto', null, null, 50000 from public.servicio_temporadas where servicio_id = 112 and nombre = 'GENERAL';
insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro)
  select id, '22:00', '24:00', 'llegada', 'monto', 10000, 'grupo' from public.servicio_temporadas where servicio_id = 112 and nombre = 'GENERAL';
insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (73, 112, 'persona', true), (73, 113, 'persona', true);
select id as st112 from public.servicio_temporadas where servicio_id = 112 and nombre = 'GENERAL' \gset
select id as stalta from public.servicio_temporadas where servicio_id = 112 and nombre = 'ALTA' \gset

-- ── A · cambios que deben ocultar la tarifa anterior al instante ──────────────────────────────────────────────
create temp table caso (n int primary key, nombre text, muta text, revierte text);
insert into caso values
 (1, 'EDITAR el precio por alcance (servicio_precio_alcance UPDATE)',      'update public.servicio_precio_alcance set precio = 65000 where servicio_temporada_id = ' || :st112, 'update public.servicio_precio_alcance set precio = 50000 where servicio_temporada_id = ' || :st112),
 (2, 'AGREGAR un precio por rango de pasajeros (INSERT)',                   'insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, pax_desde, pax_hasta, precio) values (' || :st112 || ', ''trayecto'', 4, 8, 40000)', 'delete from public.servicio_precio_alcance where servicio_temporada_id = ' || :st112 || ' and pax_desde = 4'),
 (3, 'RETIRAR el precio por alcance (DELETE)',                              'delete from public.servicio_precio_alcance where servicio_temporada_id = ' || :st112 || ' and pax_desde is null', 'insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, pax_desde, pax_hasta, precio) values (' || :st112 || ', ''trayecto'', null, null, 50000)'),
 (4, 'EDITAR un suplemento de franja (servicio_suplementos_franja UPDATE)', 'update public.servicio_suplementos_franja set valor = 15000 where servicio_temporada_id = ' || :st112, 'update public.servicio_suplementos_franja set valor = 10000 where servicio_temporada_id = ' || :st112),
 (5, 'CAMBIAR la clasificación del servicio (tipo_receptivo)',              'update public.servicios_adicionales set tipo_receptivo = ''tour'' where id = 112', 'update public.servicios_adicionales set tipo_receptivo = ''traslado'' where id = 112'),
 (6, 'CAMBIAR el alcance del traslado del combo (combo_traslado_alcance)',  'update public.servicios_adicionales set combo_traslado_alcance = ''trayecto_llegada'' where id = 113', 'update public.servicios_adicionales set combo_traslado_alcance = ''ida_regreso'' where id = 113'),
 (7, 'CONTROL (disparador de la 181): EDITAR la vigencia (servicio_temporadas)', 'update public.servicio_temporadas set prioridad = 5 where id = ' || :st112, 'update public.servicio_temporadas set prioridad = 1 where id = ' || :st112),
 (8, 'SIN CAMBIO: precio = precio',                                         'update public.servicio_precio_alcance set precio = precio where servicio_temporada_id = ' || :st112, 'select 1'),
 (9, 'SIN CAMBIO: franja con los mismos valores',                           'update public.servicio_suplementos_franja set valor = valor, tipo = tipo where servicio_temporada_id = ' || :st112, 'select 1'),
 (10,'SIN CAMBIO: clasificación con el mismo valor',                        'update public.servicios_adicionales set tipo_receptivo = tipo_receptivo, combo_traslado_alcance = combo_traslado_alcance where id in (112, 113)', 'select 1');
do $$
declare c record; r0 bigint;
begin
  for c in select * from caso order by n loop
    perform public.t_republicar();
    perform public.t_ok(public.t_vendible(), format('caso %s · ANTES: publicado y vendible', c.n));
    r0 := public.t_rev();
    execute c.muta;
    if c.n >= 8 then
      perform public.t_ok(public.t_vendible() and public.t_rev() = r0,
                          format('caso %s · %s: sigue vendible y la revisión de fuente no cambió', c.n, c.nombre));
    else
      perform public.t_ok(public.t_vis() = 0 and not public.tarifario_paquete_publicable(73) and public.t_rev() > r0,
                          format('caso %s · %s: la tarifa anterior deja de verse/venderse AL INSTANTE (visibles=%s)', c.n, c.nombre, public.t_vis()));
    end if;
    execute c.revierte;
  end loop;
  perform public.t_republicar();
  perform public.t_ok(public.t_vendible(), 'REGENERAR vuelve a publicar: el tarifario está publicado y vendible otra vez');
end $$;

select format($f$create or replace function public.t_stalta() returns bigint language sql as $x$ select %s::bigint $x$$f$, :stalta)
\gexec
-- ── B · RPC reemplazar_precios_alcance con los CUATRO rangos de un traslado, como authenticated ─────────────────────
-- Los rangos: 1-2, 3-4, 5-8, 9-15 pax. Se mide con el servicio usado por 1, 20 y 60 paquetes (cada fila del DELETE/INSERT invalida a todos ellos).
create or replace function public.t_cuatro(p_base numeric) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('alcance','trayecto','pax_desde',1,'pax_hasta',2,'precio',p_base),
    jsonb_build_object('alcance','trayecto','pax_desde',3,'pax_hasta',4,'precio',p_base - 5000),
    jsonb_build_object('alcance','trayecto','pax_desde',5,'pax_hasta',8,'precio',p_base - 10000),
    jsonb_build_object('alcance','trayecto','pax_desde',9,'pax_hasta',15,'precio',p_base - 15000)) $$;
create or replace function public.t_huella(p_st bigint) returns text language sql as $$
  select coalesce(md5(string_agg(alcance || '|' || coalesce(pax_desde::text,'-') || '|' || coalesce(pax_hasta::text,'-') || '|' || precio::text, ',' order by id)), 'vacio') from public.servicio_precio_alcance where servicio_temporada_id = p_st $$;
do $$
declare np int; t0 timestamptz; ms numeric; n int; h0 text; r0 bigint; e text; ids bigint[]; estado0 text; vis0 bigint;
begin
  foreach np in array array[1, 20, 60] loop
    delete from public.armado_servicios where servicio_id = 112 and paquete_id <> 73;
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) select g, 112, 'persona', true from generate_series(1, 80) g where g <> 73 and g <= np on conflict do nothing;
    perform public.t_republicar();
    r0 := public.t_rev();
    execute 'set local role authenticated';
    t0 := clock_timestamp();
    select public.reemplazar_precios_alcance(public.t_stalta(), public.t_cuatro(60000)) into n;
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    execute 'reset role';
    insert into public.t_med values ('rpc_4_rangos_paquetes=' || np, ms, null);
    perform public.t_ok(n = 4 and (select count(*) from public.servicio_precio_alcance where servicio_temporada_id = public.t_stalta()) = 4, format('RPC 4 rangos (%s paquetes): devuelve 4 y quedan exactamente 4 filas', np));
    perform public.t_ok(public.t_vis() = 0 and public.t_rev() > r0 and not public.tarifario_paquete_publicable(73), format('RPC 4 rangos (%s paquetes): la tarifa anterior del paquete 73 queda oculta', np));
    perform public.t_ok(not exists (select 1 from public.armado_paquetes p join public.armado_servicios a on a.paquete_id = p.id where a.servicio_id = 112 and p.tarifario_snapshot_publicable), format('RPC 4 rangos (%s paquetes): NINGÚN paquete que usa el servicio queda publicable', np));
  end loop;

  -- Atomicidad: la 3.ª fila es inválida (precio negativo) → error y TODO se deshace, incluidas la invalidación y la bitácora de cambios.
  perform public.t_republicar();
  h0 := public.t_huella(public.t_stalta()); r0 := public.t_rev();
  begin
    execute 'set local role authenticated';
    perform public.reemplazar_precios_alcance(public.t_stalta(), jsonb_set(public.t_cuatro(70000), '{2,precio}', '-1'));
    perform public.t_ok(false, 'ATOMICIDAD: la fila inválida debía lanzar error');
  exception when others then
    e := sqlstate;
    execute 'reset role';
    perform public.t_ok(e = '23514', 'ATOMICIDAD: la fila inválida lanza ' || e || ' (CHECK de precio)');
  end;
  perform public.t_ok(public.t_huella(public.t_stalta()) = h0, 'ATOMICIDAD: tras el error los precios son EXACTAMENTE los anteriores (misma huella)');
  perform public.t_ok(public.t_rev() = r0 and public.t_vendible(), 'ATOMICIDAD: el error NO dejó nada a medias: sin invalidar y sigue vendible');
  -- Rangos cruzados (1-4 y 3-6): el trigger de solape rechaza; mismo criterio.
  begin
    execute 'set local role authenticated';
    perform public.reemplazar_precios_alcance(public.t_stalta(), jsonb_build_array(
      jsonb_build_object('alcance','trayecto','pax_desde',1,'pax_hasta',4,'precio',1000), jsonb_build_object('alcance','trayecto','pax_desde',3,'pax_hasta',6,'precio',900)));
    perform public.t_ok(false, 'ATOMICIDAD: los rangos cruzados debían lanzar error');
  exception when others then
    e := sqlstate; execute 'reset role';
    perform public.t_ok(true, 'ATOMICIDAD: rangos cruzados rechazados (' || e || ')');
  end;
  perform public.t_ok(public.t_huella(public.t_stalta()) = h0 and public.t_rev() = r0 and public.t_vendible(), 'ATOMICIDAD: tras los rangos cruzados todo sigue idéntico y vendible');
  -- Rol sin permiso (venta): la RLS de la 262 lo rechaza y no deja nada.
  begin
    execute 'set local role authenticated';
    update public.usuarios set rol = 'venta' where id = '00000000-0000-0000-0000-0000000000a1';
    perform public.reemplazar_precios_alcance(public.t_stalta(), public.t_cuatro(80000));
    perform public.t_ok(false, 'ROL: venta no debía poder reemplazar');
  exception when others then
    execute 'reset role'; e := sqlstate; perform public.t_ok(true, 'ROL sin permiso rechazado (' || e || ')');
  end;
  update public.usuarios set rol = 'superadmin' where id = '00000000-0000-0000-0000-0000000000a1';
  perform public.t_ok(public.t_huella(public.t_stalta()) = h0 and public.t_rev() = r0 and public.t_vendible(), 'ROL: tras el rechazo no cambió ni se invalidó nada');
  -- Regenerar tras guardar los cuatro rangos vuelve a publicar.
  perform public.reemplazar_precios_alcance(public.t_stalta(), public.t_cuatro(60000));
  perform public.t_republicar();
  perform public.t_ok(public.t_vendible(), 'Tras guardar los 4 rangos y regenerar, el tarifario vuelve a estar publicado y vendible');
end $$;

select 'MEDICION ' || k || ' = ' || round(ms, 1) || ' ms' from public.t_med order by k;
select 'RESUMEN: ' || count(*) filter (where ok) || ' OK, ' || count(*) filter (where not ok) || ' FALLAS' from public.t_res;
