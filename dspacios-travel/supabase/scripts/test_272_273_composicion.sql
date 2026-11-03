-- Pruebas de las migraciones 272 y 273 (composición interna). SOLO base local desechable con 001-271 + test_259_semilla.sql + helpers t_* de test_260_cola.sql.
-- Lo corre test_272_273_composicion.sh, que aplica 272 y 273 en el punto indicado por :fase. Imprime «OK …» / «FALLA …».
\set ON_ERROR_STOP on
\set QUIET on
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);

-- Composición de ejemplo del tamaño real aproximado (≈1,5 KB: base con netos de 7 acomodaciones, pvps y 3 servicios).
create or replace function public.t_comp273(p_k int) returns jsonb language sql as $$
  select jsonb_build_object('version', 1, 'pctMk', 0.25, 'impuesto', 120000, 'vuelo', 350000 + p_k, 'vueloNeto', 280000, 'feeInfante', 0, 'trm', null,
    'servicios', (select jsonb_agg(jsonb_build_object('nombre', 'Servicio ' || s, 'neto', 40000 + s, 'netoMenor', 20000 + s)) from generate_series(1, 3) s),
    'netos', jsonb_build_object('sencilla', 900000 + p_k, 'doble', 700000 + p_k, 'triple', 650000 + p_k, 'multiple', 600000 + p_k, 'nino', 400000, 'nino2', 380000, 'infante', 0),
    'pvps', jsonb_build_object('sencilla', jsonb_build_object('pvp', 1500000 + p_k, 'pvpMenor2', null), 'doble', jsonb_build_object('pvp', 1200000 + p_k, 'pvpMenor2', null),
                               'triple', jsonb_build_object('pvp', 1100000 + p_k, 'pvpMenor2', null), 'multiple', jsonb_build_object('pvp', 1000000 + p_k, 'pvpMenor2', null)),
    'relleno', repeat('x', 400)) $$;

-- Hace lo que el generador: upsert por tandas de 200 con on conflict (como PostgREST). Devuelve milisegundos.
create or replace function public.t_guardar273(p_paquete bigint, p_gen bigint, p_n int) returns numeric language plpgsql as $$
declare t0 timestamptz := clock_timestamp(); i int := 0;
begin
  while i < p_n loop
    insert into public.tarifario_resultado_composicion (paquete_id, generacion, clave, composicion)
      select p_paquete, p_gen, 'b3000|2000|Cat ' || (k % 4) || '|Plan ' || (k % 3) || '|2026-12-' || lpad((1 + k % 28)::text, 2, '0') || '|' || k, public.t_comp273(k)
        from generate_series(i, least(i + 200, p_n) - 1) k
      on conflict (paquete_id, generacion, clave) do update set composicion = excluded.composicion;
    i := i + 200;
  end loop;
  return round(extract(epoch from clock_timestamp() - t0) * 1000);
end $$;

-- ── Mundo (igual que la prueba de la 260) ──
truncate public.tarifario_resultado cascade;
delete from public.tarifario_cambio_fuente; delete from public.tarifario_publicacion_cola; delete from public.armado_servicios where paquete_id = 73;
delete from public.tarifa_hotel where hotel_id = 2000; delete from public.hotel_temporadas where hotel_id = 2000; delete from public.armado_hoteles where paquete_id = 73;
update public.armado_paquetes set tarifario_por_generacion = false, tarifario_generacion_publicada = null where id = 73;

-- ── Existencia y seguridad ──
select public.t_ok(to_regclass('public.cotizacion_composicion') is not null and to_regclass('public.tarifario_resultado_composicion') is not null, 'S1 las dos tablas existen');
select public.t_ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.cotizacion_composicion'::regclass, 'public.tarifario_resultado_composicion'::regclass)), 'S2 RLS activa en ambas');
select public.t_ok((select count(*) from pg_policies where tablename in ('cotizacion_composicion', 'tarifario_resultado_composicion')) = 0, 'S3 ninguna política (ningún usuario las alcanza por la API)');
select public.t_ok(not has_table_privilege('anon', 'public.cotizacion_composicion', 'select') and not has_table_privilege('authenticated', 'public.cotizacion_composicion', 'select')
               and not has_table_privilege('anon', 'public.tarifario_resultado_composicion', 'select') and not has_table_privilege('authenticated', 'public.tarifario_resultado_composicion', 'select'),
               'S4 anon y authenticated sin SELECT en ambas');
select public.t_ok(has_table_privilege('service_role', 'public.cotizacion_composicion', 'insert') and has_table_privilege('service_role', 'public.tarifario_resultado_composicion', 'insert'), 'S5 service_role puede escribir');
do $$ declare v boolean := false; begin
  set local role authenticated; begin perform count(*) from public.tarifario_resultado_composicion; exception when insufficient_privilege then v := true; end; reset role;
  perform public.t_ok(v, 'S6 authenticated recibe «permission denied» al leer la composición del tarifario');
end $$;
do $$ declare v boolean := false; begin
  set local role anon; begin perform count(*) from public.cotizacion_composicion; exception when insufficient_privilege then v := true; end; reset role;
  perform public.t_ok(v, 'S7 anon recibe «permission denied» al leer la composición de cotizaciones');
end $$;
select public.t_ok(not exists (select 1 from information_schema.columns where table_name = 'tarifario_resultado' and column_name ilike '%composicion%'), 'S8 tarifario_resultado NO ganó ninguna columna (la vista pública sigue sin netos)');
select public.t_ok(not exists (select 1 from pg_get_viewdef('public.tarifario_resultado_publicable'::regclass) v where v ilike '%composicion%'), 'S9 la vista pública no menciona la composición');

-- ── Publicador MONOLÍTICO con composición guardada antes (orden real del generador) ──
select public.iniciar_generacion_tarifario(73) as _ \gset
select generacion as g1, revision_capturada as r1 from public.iniciar_generacion_tarifario(73) \gset
select public.t_guardar273(73, :g1, 1810) as ms_guardar \gset
select public.t_ok((select count(*) from public.tarifario_resultado_composicion where paquete_id = 73 and generacion = :g1) = 1810, 'M1 se guardaron 1.810 composiciones (≈ paquete de 12.669 filas) en ' || :'ms_guardar' || ' ms');
do $$ declare ok boolean; t0 timestamptz; g bigint; r bigint; begin
  select generacion, revision_capturada into g, r from public.iniciar_generacion_tarifario(73);
  perform public.t_guardar273(73, g, 1810);
  t0 := clock_timestamp();
  ok := public.publicar_tarifario_resultado(73, g, r, 'COP', public.bench_filas(12669, 73));
  perform public.t_ok(ok, 'M2 el publicador monolítico publica 12.669 filas con la composición ya guardada en ' || round(extract(epoch from clock_timestamp() - t0) * 1000) || ' ms');
  perform public.t_ok((select count(*) from public.tarifario_resultado_composicion where paquete_id = 73 and generacion = g) = 1810, 'M3 publicar no tocó la composición de su generación');
  perform public.t_ok((select tarifario_generacion_publicada from public.armado_paquetes where id = 73) = g, 'M4 la generación publicada es la de la composición');
end $$;
select public.t_ok((select count(*) from public.tarifario_resultado_publicable where paquete_id = 73) > 12000, 'M5 la vista pública ve las filas publicadas');

-- ── Publicador POR LOTES ──
select public.t_preparar260('l1', 2500, 1000);
select public.t_publicar260('l1') as g2 \gset
select public.t_guardar273(73, :g2, 1810) as ms_lotes \gset
select public.t_avanzar260(:g2, 400) as sec \gset
select public.t_ok(:'sec' like '%listo', 'L1 el publicador por lotes termina («' || :'sec' || '») con la composición guardada');
select public.t_ok((select tarifario_generacion_publicada from public.armado_paquetes where id = 73) = :g2 and public.t_vis260('l1') = 2500, 'L2 la generación por lotes quedó publicada y visible (2.500 filas)');
select public.t_ok((select count(*) from public.tarifario_resultado_composicion where paquete_id = 73 and generacion = :g2) = 1810, 'L3 la limpieza de la publicación por lotes no tocó la composición de su generación');

-- ── Limpieza de generaciones viejas (lo que hace el generador) y cascada ──
delete from public.tarifario_resultado_composicion where paquete_id = 73 and generacion < :g2;
select public.t_ok((select count(*) from public.tarifario_resultado_composicion where paquete_id = 73) = 1810 and (select count(distinct generacion) from public.tarifario_resultado_composicion) = 1, 'C1 borrar generaciones < vigente deja solo la vigente');
select public.t_ok(public.t_vis260('l1') = 2500, 'C2 …y no altera lo que ve el público');
-- Idempotencia del upsert (regenerar la misma generación no duplica)
select public.t_guardar273(73, :g2, 1810) as _ \gset
select public.t_ok((select count(*) from public.tarifario_resultado_composicion where paquete_id = 73 and generacion = :g2) = 1810, 'C3 el upsert es idempotente');
-- Cascada: borrar el paquete borra su composición
insert into public.armado_paquetes (id, nombre, tipo, activo) overriding system value values (900, 'p900', 'bloqueo', true);
insert into public.tarifario_resultado_composicion values (900, 1, 'k', '{}'::jsonb);
delete from public.armado_paquetes where id = 900;
select public.t_ok((select count(*) from public.tarifario_resultado_composicion where paquete_id = 900) = 0, 'C4 borrar el paquete borra su composición (cascada)');
-- Restricciones
do $$ declare v boolean := false; begin begin insert into public.tarifario_resultado_composicion values (73, 99, 'x', '[]'::jsonb); exception when check_violation then v := true; end; perform public.t_ok(v, 'C5 la composición debe ser un objeto JSON'); end $$;

-- ── Cotización: composición por cotización ──
do $$ declare c bigint; v boolean := false; begin
  select id into c from public.cotizaciones limit 1;
  if c is null then perform public.t_ok(true, 'Q1 (sin cotizaciones en la semilla: se prueba con una creada)'); end if;
end $$;
select public.t_ok(exists (select 1 from pg_constraint where conrelid = 'public.cotizacion_composicion'::regclass and contype = 'f' and confdeltype = 'c'), 'Q2 cotizacion_composicion cae en cascada con la cotización');

-- ── Resumen ──
select case when count(*) filter (where not ok) = 0 then 'RESUMEN: todo OK (' || count(*) || ' comprobaciones)' else 'RESUMEN: ' || count(*) filter (where not ok) || ' FALLAS de ' || count(*) end from public.t_res;
