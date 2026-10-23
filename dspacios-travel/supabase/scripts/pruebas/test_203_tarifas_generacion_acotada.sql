-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBA LOCAL · migración 203 (generación acotada + historial de tarifas)
-- SOLO para una base LOCAL DESECHABLE creada por
-- test_203_tarifas_generacion_acotada.sh (nunca remota): arma un esquema
-- mínimo con `auditoria` (087/108 simplificada), simula cambios ANTERIORES a
-- la 203, aplica la migración y verifica preservación, histórico, paginación,
-- reconstrucción desde auditoría y permisos. Cualquier fallo aborta.
-- ───────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- ── Esquema mínimo (solo lo que la migración usa) ─────────────────────────
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select jsonb_build_object('email', nullif(current_setting('test.email', true), '')) $$;
create or replace function public.mi_rol() returns text language sql stable as
  $$ select nullif(current_setting('test.rol', true), '') $$;

create table public.hoteles (id bigint primary key, nombre text);
create table public.hotel_temporadas (
  id bigserial primary key, hotel_id bigint not null references public.hoteles(id) on delete cascade,
  nombre text not null, tipo text not null default 'tarifa', descuento_valor numeric,
  prioridad integer not null default 1, fecha_inicio date, fecha_fin date,
  compra_inicio date, compra_fin date, regimen_restringido text
);
create table public.tarifa_hotel (
  id bigserial primary key,
  hotel_id bigint not null references public.hoteles(id) on delete cascade,
  tipo_habitacion text, alimentacion text, temporada text,
  neto_sencilla numeric(15,2), neto_doble numeric(15,2), neto_triple numeric(15,2),
  neto_multiple numeric(15,2), neto_nino numeric(15,2), neto_nino2 numeric(15,2),
  neto_infante numeric(15,2), nota_infante text, notas text,
  edad_infante_min integer, edad_infante_max integer, edad_nino_min integer, edad_nino_max integer,
  precio_final_autoritativo boolean not null default false,
  temporada_base text,
  created_at timestamptz not null default now(),
  constraint tarifa_hotel_temporada_base_solo_si_final_check check (
    (precio_final_autoritativo = false and temporada_base is null)
    or (precio_final_autoritativo = true and temporada_base is not null and btrim(temporada_base) <> '')
  )
);

-- `auditoria` como la dejan 087/108 (misma forma de registro_id/antes/despues).
create table public.auditoria (
  id bigserial primary key, creado_en timestamptz not null default now(),
  actor_id uuid, actor_email text, actor_nombre text, actor_rol text,
  accion text not null, tabla text not null, registro_id text,
  antes jsonb, despues jsonb, cambios jsonb, tenant text not null default 'mayorista'
);
create or replace function public.fn_auditoria_prueba() returns trigger language plpgsql as $$
declare v_antes jsonb; v_despues jsonb;
begin
  if tg_op <> 'INSERT' then v_antes := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_despues := to_jsonb(new); end if;
  insert into public.auditoria (actor_email, accion, tabla, registro_id, antes, despues)
  values (nullif(current_setting('test.email', true), ''), tg_op, tg_table_name,
          coalesce(v_despues->>'id', v_antes->>'id'), v_antes, v_despues);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger trg_auditoria after insert or update or delete on public.hotel_temporadas
  for each row execute function public.fn_auditoria_prueba();
create trigger trg_auditoria after insert or update or delete on public.tarifa_hotel
  for each row execute function public.fn_auditoria_prueba();

-- ── Cambios ANTERIORES a la 203 (solo quedan en `auditoria`) ──────────────
select set_config('test.email', 'antes@prueba.local', false);
insert into public.hoteles values (5, 'Hotel auditado'), (59, 'Hotel 59 de prueba');
-- V2 "BAJA" creada antes de la 087 (sin evento de alta en auditoría).
alter table public.hotel_temporadas disable trigger trg_auditoria;
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, compra_fin)
  values (502, 5, 'BAJA', '2026-01-01', '2026-03-31', null);
alter table public.hotel_temporadas enable trigger trg_auditoria;
insert into public.hotel_temporadas (id, hotel_id, nombre, tipo, descuento_valor, prioridad, fecha_inicio, fecha_fin, compra_fin)
  values (501, 5, 'PROMO A', 'descuento_pct', 10, 5, '2026-02-01', '2026-02-28', '2026-01-31');
insert into public.tarifa_hotel (id, hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble)
  values (9001, 5, 'Std', 'PC', 'PROMO A', 100000), (9002, 5, 'Std', 'PC', 'BAJA', 200000),
         (9003, 59, 'Std', 'PAM', 'TARIFA PROMOCIONAL BAJA (NO APLICA FESTIVOS)', 300000);
update public.tarifa_hotel set neto_doble = 110000 where id = 9001;                               -- ev A: con PROMO A vigente
update public.hotel_temporadas set nombre = 'PROMO B', fecha_fin = '2026-03-15' where id = 501;   -- renombre de la vigencia
update public.tarifa_hotel set temporada = 'PROMO B' where id = 9001;                             -- ev B: cascada (vigencia ya renombrada)
delete from public.hotel_temporadas where id = 501;                                               -- se elimina la vigencia
delete from public.tarifa_hotel where id = 9001;                                                  -- ev C: tarifa de vigencia eliminada
delete from public.tarifa_hotel where id = 9002;                                                  -- ev D: BAJA aún con fechas viejas
update public.hotel_temporadas set fecha_fin = '2026-04-30' where id = 502;                       -- BAJA cambia DESPUÉS
delete from public.tarifa_hotel where id = 9003;                                                  -- ev E: hotel 59 (sin vigencia)

\ir ../../migrations/20260601000203_tarifas_generacion_acotada_historial.sql

-- ── A) Reconstrucción desde auditoría (solo lectura) ─────────────────────
do $$
declare r record;
begin
  -- No escribe: el historial nuevo sigue vacío.
  if (select count(*) from public.tarifa_hotel_historial) <> 0 then raise exception 'FALLO: la 203 escribió historial'; end if;

  select * into r from public.reconstruir_tarifas_desde_auditoria(5) where tarifa_id = 9001 and operacion = 'UPDATE' and datos->>'neto_doble' = '100000.00';
  if r.vigencia_fuente <> 'auditoria' or r.vigencia->0->>'nombre' <> 'PROMO A' or r.vigencia->0->>'fecha_fin' <> '2026-02-28' then
    raise exception 'FALLO A1: vigencia al momento de la edición %', row_to_json(r);
  end if;
  select * into r from public.reconstruir_tarifas_desde_auditoria(5) where tarifa_id = 9001 and operacion = 'UPDATE' and datos->>'temporada' = 'PROMO A' and datos->>'neto_doble' = '110000.00';
  if r.vigencia_fuente <> 'auditoria_previa' or r.vigencia->0->>'nombre' <> 'PROMO A' or r.vigencia->0->>'fecha_fin' <> '2026-02-28' then
    raise exception 'FALLO A2: renombrada antes de la cascada %', row_to_json(r);
  end if;
  select * into r from public.reconstruir_tarifas_desde_auditoria(5) where tarifa_id = 9001 and operacion = 'DELETE';
  if r.vigencia_fuente <> 'auditoria_previa' or r.vigencia->0->>'nombre' <> 'PROMO B' or r.vigencia->0->>'fecha_fin' <> '2026-03-15' then
    raise exception 'FALLO A3: vigencia eliminada antes %', row_to_json(r);
  end if;
  select * into r from public.reconstruir_tarifas_desde_auditoria(5) where tarifa_id = 9002;
  if r.vigencia_fuente <> 'auditoria' or r.vigencia->0->>'fecha_fin' <> '2026-03-31' then
    raise exception 'FALLO A4: debía usar las fechas de BAJA de ese momento, no las actuales %', row_to_json(r);
  end if;
  select * into r from public.reconstruir_tarifas_desde_auditoria(59);
  if r.vigencia_fuente <> 'no_encontrada' or r.datos->>'neto_doble' <> '300000.00' or r.existe_fila_actual or r.ya_incorporado then
    raise exception 'FALLO A5: hotel 59 %', row_to_json(r);
  end if;
  if (select count(*) from public.reconstruir_tarifas_desde_auditoria(null)) <> 5 then
    raise exception 'FALLO A6: esperaba 5 versiones recuperables en total';
  end if;
  if (select count(*) from public.tarifa_hotel where hotel_id = 59) <> 0 then
    raise exception 'FALLO A7: la consulta restauró algo';
  end if;
  raise notice 'OK    auditoría previa: reconstruye vigencias de ese momento (renombradas, eliminadas, editadas después) sin escribir nada';
end $$;

-- ── Datos para la parte nueva ─────────────────────────────────────────────
insert into public.hoteles values (1, 'Hotel prueba'), (2, 'Otro hotel'), (3, 'Hotel con muchas versiones');
insert into public.hotel_temporadas (hotel_id, nombre, compra_fin, fecha_inicio, fecha_fin) values
  (1, 'BAJA 2026', null, '2026-10-01', '2026-12-14'),
  (1, 'SUNSALE1', current_date + 30, '2026-10-05', '2026-11-30'),
  (1, 'PROMO VIEJA', current_date - 1, '2026-09-01', '2026-11-30'),
  (1, 'BAJA 2027', null, '2027-01-01', '2027-03-31');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino) values
  (1, 'Estandar', 'FULL', 'BAJA 2026',   514000, 454000, 454000, 454000, 227000),
  (1, 'Estandar', 'FULL', 'PROMO VIEJA', 500000, 440000, 440000, 440000, 220000),
  (1, 'Estandar', 'PC',   'BAJA 2026',   300000, 250000, 250000, 250000, 120000),
  (1, 'Suite',    'FULL', 'BAJA 2026',   900000, 800000, 800000, 800000, 400000),
  -- Caso de la captura: SUNSALE1 escrita a mano con los valores de la base.
  (1, 'Estandar', 'FULL', 'SUNSALE1',    514000, 454000, 454000, 454000, 227000),
  (1, 'Superior', 'FULL', 'SUNSALE1',    600000, 500000, 500000, 500000, 250000),
  (2, 'Estandar', 'FULL', 'BAJA 2026',   111000, 111000, 111000, 111000, 111000);
-- Niño 2 e infante de la base y de la SUNSALE escrita a mano (regla de infante, #15).
update public.tarifa_hotel set neto_nino2 = 150000, neto_infante = 50000
 where hotel_id = 1 and tipo_habitacion = 'Estandar' and alimentacion = 'FULL' and temporada in ('BAJA 2026', 'SUNSALE1');

select set_config('test.rol', 'operaciones', false);
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('test.email', 'ops@prueba.local', false);

-- ── 1) Agregar: solo toca las claves del lote ─────────────────────────────
do $$
declare r jsonb;
begin
  r := public.generar_tarifas_hotel_calculadora(1, jsonb_build_array(
    jsonb_build_object('tipo_habitacion','Estandar','alimentacion','FULL','temporada','BAJA 2027',
      'neto_sencilla',520000,'neto_doble',460000,'neto_triple',460000,'neto_multiple',460000,'neto_nino',230000,
      'neto_infante',0)
  ), false);
  if (r->>'borradas')::int <> 0 or (r->>'insertadas')::int <> 1 then
    raise exception 'FALLO agregar: esperaba 0 borradas/1 insertada, obtuvo %', r;
  end if;
  -- Infante 0 (gratis) se guarda como 0; sin valor de Niño 2 queda vacío (no se inventa).
  if not exists (select 1 from public.tarifa_hotel where hotel_id = 1 and temporada = 'BAJA 2027'
                 and neto_infante = 0 and neto_nino2 is null) then
    raise exception 'FALLO agregar: infante 0 / Niño 2 vacío no se persistieron tal cual';
  end if;
  if (select count(*) from public.tarifa_hotel where hotel_id = 1) <> 7 then
    raise exception 'FALLO preservación: el hotel 1 debería tener 7 filas';
  end if;
  if not exists (select 1 from public.tarifa_hotel where temporada = 'SUNSALE1' and tipo_habitacion = 'Estandar' and neto_doble = 454000 and not precio_final_autoritativo) then
    raise exception 'FALLO: generar otra temporada tocó SUNSALE1 escrita a mano';
  end if;
  raise notice 'OK    agregar conserva otras temporadas, regímenes, categorías, hoteles y la promo escrita a mano';
end $$;

-- ── 2) Sustitución explícita (caso de la captura) ────────────────────────
do $$
declare r jsonb; h record;
begin
  r := public.generar_tarifas_hotel_calculadora(1, jsonb_build_array(
    jsonb_build_object('tipo_habitacion','Estandar','alimentacion','FULL','temporada','SUNSALE1',
      'neto_sencilla',483160,'neto_doble',426760,'neto_triple',426760,'neto_multiple',426760,'neto_nino',213380,
      'neto_nino2',141000,'neto_infante',50000,   -- lo que envía la calculadora: Niño 2 −6 %, infante de la base sin descuento
      'precio_final_autoritativo',true,'temporada_base','BAJA 2026')
  ), false, 'calculadora_sustituir_manual');
  if (r->>'borradas')::int <> 1 then raise exception 'FALLO sustituir: debía reemplazar 1 fila %', r; end if;
  if not exists (select 1 from public.tarifa_hotel where temporada = 'SUNSALE1' and tipo_habitacion = 'Estandar'
                 and neto_sencilla = 483160 and neto_doble = 426760 and neto_nino = 213380 and neto_nino2 = 141000
                 and neto_infante = 50000 and precio_final_autoritativo and temporada_base = 'BAJA 2026') then
    raise exception 'FALLO sustituir: valores finales (incluye Niño 2 −6 %% e infante intacto)';
  end if;
  if not exists (select 1 from public.tarifa_hotel where temporada = 'BAJA 2026' and tipo_habitacion = 'Estandar' and alimentacion = 'FULL'
                 and neto_nino2 = 150000 and neto_infante = 50000) then
    raise exception 'FALLO sustituir: tocó la base';
  end if;
  if not exists (select 1 from public.tarifa_hotel where temporada = 'SUNSALE1' and tipo_habitacion = 'Superior' and neto_doble = 500000) then
    raise exception 'FALLO sustituir: tocó otra categoría';
  end if;
  if not exists (select 1 from public.tarifa_hotel where temporada = 'BAJA 2026' and alimentacion = 'PC' and neto_doble = 250000) then
    raise exception 'FALLO sustituir: tocó otro régimen';
  end if;
  select * into h from public.tarifa_hotel_historial where datos->>'temporada' = 'SUNSALE1' order by id desc limit 1;
  if h.motivo <> 'calculadora_sustituir_manual' or h.operacion <> 'DELETE' or (h.datos->>'neto_doble')::numeric <> 454000
     or (h.datos->>'neto_nino2')::numeric <> 150000 or (h.datos->>'neto_infante')::numeric <> 50000
     or h.autor_id is distinct from '00000000-0000-0000-0000-000000000001'::uuid or h.autor_email is distinct from 'ops@prueba.local'
     or h.vigencia_fuente <> 'actual' or h.vigencia->0->>'nombre' <> 'SUNSALE1' then
    raise exception 'FALLO sustituir: historial %', row_to_json(h);
  end if;
  begin
    perform public.generar_tarifas_hotel_calculadora(1, jsonb_build_array(jsonb_build_object('tipo_habitacion','A','alimentacion','PC','temporada','BAJA 2027')), false, 'restaurar');
    raise exception 'FALLO: aceptó un motivo no permitido';
  exception when others then if sqlerrm not like '%motivo no permitido%' then raise; end if; end;
  begin
    perform public.generar_tarifas_hotel_calculadora(1, jsonb_build_array(jsonb_build_object('tipo_habitacion','A','alimentacion','PC','temporada','BAJA 2027')), true, 'calculadora_sustituir_manual');
    raise exception 'FALLO: reemplazar todo con motivo de sustitución';
  exception when others then if sqlerrm not like '%solo admite%' then raise; end if; end;
  raise notice 'OK    sustitución explícita: solo esa categoría/régimen, motivo propio en el historial con la foto de la vigencia';
end $$;

-- ── 3) Vigencia con compra cerrada: se rechaza el lote, nada cambia ──────
do $$
declare antes bigint := (select count(*) from public.tarifa_hotel);
begin
  begin
    perform public.generar_tarifas_hotel_calculadora(1, jsonb_build_array(
      jsonb_build_object('tipo_habitacion','Estandar','alimentacion','FULL','temporada','PROMO VIEJA',
        'neto_sencilla',1,'neto_doble',1,'neto_triple',1,'neto_multiple',1,'neto_nino',1)
    ), false);
    raise exception 'FALLO: aceptó reescribir una vigencia vencida';
  exception when others then
    if sqlerrm not like '%compra cerrada%' then raise; end if;
  end;
  if (select count(*) from public.tarifa_hotel) <> antes
     or not exists (select 1 from public.tarifa_hotel where temporada = 'PROMO VIEJA' and neto_doble = 440000) then
    raise exception 'FALLO: el rechazo modificó datos';
  end if;
  raise notice 'OK    una vigencia con compra cerrada no se reescribe ni se recrea';
end $$;

-- ── 4) Fotos de vigencia: editada después, renombrada y eliminada ────────
do $$
declare h record; tid bigint;
begin
  -- Edición de la tarifa con la vigencia vigente; luego cambian las fechas de la vigencia.
  update public.tarifa_hotel set neto_doble = 455000 where hotel_id = 1 and temporada = 'BAJA 2026' and alimentacion = 'FULL' and tipo_habitacion = 'Estandar';
  update public.hotel_temporadas set fecha_fin = '2026-12-31' where hotel_id = 1 and nombre = 'BAJA 2026';
  select * into h from public.tarifa_hotel_historial where operacion = 'UPDATE' and datos->>'temporada' = 'BAJA 2026' order by id desc limit 1;
  if h.vigencia_fuente <> 'actual' or h.vigencia->0->>'fecha_fin' <> '2026-12-14' then
    raise exception 'FALLO 4a: la foto debía conservar las fechas de ese momento %', row_to_json(h);
  end if;
  if not exists (select 1 from public.hotel_temporadas_historial where datos->>'nombre' = 'BAJA 2026' and datos->>'fecha_fin' = '2026-12-14') then
    raise exception 'FALLO 4b: la edición de la vigencia no quedó versionada';
  end if;

  -- Renombre como lo hace la app: primero la vigencia, después la cascada a la tarifa.
  update public.hotel_temporadas set nombre = 'BAJA 2027 B', fecha_inicio = '2027-01-15' where hotel_id = 1 and nombre = 'BAJA 2027';
  update public.tarifa_hotel set temporada = 'BAJA 2027 B' where hotel_id = 1 and temporada = 'BAJA 2027';
  select * into h from public.tarifa_hotel_historial where datos->>'temporada' = 'BAJA 2027' order by id desc limit 1;
  if h.vigencia_fuente <> 'historial' or h.vigencia->0->>'nombre' <> 'BAJA 2027' or h.vigencia->0->>'fecha_inicio' <> '2027-01-01' then
    raise exception 'FALLO 4c: renombrada — debía usar la versión con el nombre viejo %', row_to_json(h);
  end if;

  -- Vigencia eliminada y luego su tarifa.
  delete from public.hotel_temporadas where hotel_id = 1 and nombre = 'BAJA 2027 B';
  delete from public.tarifa_hotel where hotel_id = 1 and temporada = 'BAJA 2027 B' returning id into tid;
  select * into h from public.tarifa_hotel_historial where tarifa_id = tid and operacion = 'DELETE';
  if h.vigencia_fuente <> 'historial' or h.vigencia->0->>'nombre' <> 'BAJA 2027 B' or h.vigencia->0->>'fecha_inicio' <> '2027-01-15' then
    raise exception 'FALLO 4d: eliminada — debía usar su última versión %', row_to_json(h);
  end if;

  -- Sin rastro de vigencia.
  insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble) values (1, 'Std', 'PC', 'SIN VIGENCIA', 1) returning id into tid;
  delete from public.tarifa_hotel where id = tid;
  select * into h from public.tarifa_hotel_historial where tarifa_id = tid;
  if h.vigencia_fuente <> 'no_encontrada' or jsonb_array_length(h.vigencia) <> 0 then
    raise exception 'FALLO 4e: sin vigencia %', row_to_json(h);
  end if;
  raise notice 'OK    cada versión guarda la vigencia de ESE momento: editada después, renombrada, eliminada o inexistente';
end $$;

-- ── 5) Reemplazar todo conserva las vencidas ─────────────────────────────
do $$
declare n_borrar bigint := (select count(*) from public.tarifa_hotel where hotel_id = 1 and temporada <> 'PROMO VIEJA');
begin
  perform public.generar_tarifas_hotel_calculadora(1, jsonb_build_array(
    jsonb_build_object('tipo_habitacion','Estandar','alimentacion','PAM','temporada','BAJA 2026',
      'neto_sencilla',400000,'neto_doble',350000,'neto_triple',350000,'neto_multiple',350000,'neto_nino',170000)
  ), true);
  if (select array_agg(temporada || '/' || alimentacion order by temporada, alimentacion) from public.tarifa_hotel where hotel_id = 1)
     <> array['BAJA 2026/PAM', 'PROMO VIEJA/FULL'] then
    raise exception 'FALLO reemplazar todo: filas finales inesperadas';
  end if;
  if (select count(*) from public.tarifa_hotel where hotel_id = 2) <> 1 then
    raise exception 'FALLO reemplazar todo: tocó otro hotel';
  end if;
  if (select count(*) from public.tarifa_hotel_historial where motivo = 'calculadora_reemplazar_todo') <> n_borrar then
    raise exception 'FALLO reemplazar todo: el historial debía guardar las % filas borradas', n_borrar;
  end if;
  raise notice 'OK    reemplazar todo borra solo vigentes del hotel, conserva las vencidas y versiona lo borrado';
end $$;

-- ── 6) Validaciones del lote y permisos de escritura ─────────────────────
do $$
begin
  begin
    perform public.generar_tarifas_hotel_calculadora(1, jsonb_build_array(
      jsonb_build_object('tipo_habitacion','A','alimentacion','PC','temporada','BAJA 2026','neto_doble',1),
      jsonb_build_object('tipo_habitacion','A','alimentacion','PC','temporada','BAJA 2026','neto_doble',2)), false);
    raise exception 'FALLO: aceptó claves repetidas';
  exception when others then if sqlerrm not like '%repetida%' then raise; end if; end;
  begin
    perform public.generar_tarifas_hotel_calculadora(1, '[]'::jsonb, true);
    raise exception 'FALLO: aceptó lote vacío';
  exception when others then if sqlerrm not like '%vacío%' then raise; end if; end;
  begin
    perform public.generar_tarifas_hotel_calculadora(1, jsonb_build_array(jsonb_build_object('tipo_habitacion','A','alimentacion','','temporada','X')), false);
    raise exception 'FALLO: aceptó régimen vacío';
  exception when others then if sqlerrm not like '%categoría, régimen y temporada%' then raise; end if; end;
  perform set_config('test.rol', 'venta', false);
  begin
    perform public.generar_tarifas_hotel_calculadora(1, jsonb_build_array(jsonb_build_object('tipo_habitacion','A','alimentacion','PC','temporada','BAJA 2026')), false);
    raise exception 'FALLO: venta pudo generar';
  exception when others then if sqlerrm not like '%sin permiso%' then raise; end if; end;
  perform set_config('test.rol', '', false);
  begin
    perform public.generar_tarifas_hotel_calculadora(1, jsonb_build_array(jsonb_build_object('tipo_habitacion','A','alimentacion','PC','temporada','BAJA 2026')), false);
    raise exception 'FALLO: rol nulo pudo generar';
  exception when others then if sqlerrm not like '%sin permiso%' then raise; end if; end;
  perform set_config('test.rol', 'operaciones', false);
  raise notice 'OK    rechaza claves repetidas, lote vacío, claves en blanco, rol venta y rol nulo';
end $$;

-- ── 7) Paginación y búsqueda en servidor: hotel con 1.200 versiones ──────
do $$
declare
  a bigint; b bigint; i int;
  pag jsonb; cur_r timestamptz; cur_i bigint;
  vistos bigint[] := '{}'; prev_r timestamptz; prev_id bigint; fila jsonb; paginas int := 0;
begin
  insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble) values (3, 'Std', 'PC', 'BAJA', 1) returning id into a;
  insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble) values (3, 'Std', 'PC', 'Promo X_50%', 1) returning id into b;
  for i in 1..900 loop update public.tarifa_hotel set neto_doble = neto_doble + 1 where id = a; end loop;
  for i in 1..300 loop update public.tarifa_hotel set neto_doble = neto_doble + 1 where id = b; end loop;

  -- Recorre TODO con cursor; entre páginas entran versiones nuevas (no deben repetirse ni colarse).
  loop
    pag := public.consultar_historial_tarifas(3, null, cur_r, cur_i, 200);
    if paginas = 0 and (pag->>'total')::int <> 1200 then raise exception 'FALLO 7a: total %', pag->>'total'; end if;
    paginas := paginas + 1;
    for fila in select * from jsonb_array_elements(pag->'filas') loop
      if (fila->>'id')::bigint = any(vistos) then raise exception 'FALLO 7b: fila repetida %', fila->>'id'; end if;
      if prev_id is not null and ((fila->>'registrado_en')::timestamptz, (fila->>'id')::bigint) >= (prev_r, prev_id) then
        raise exception 'FALLO 7c: orden no estable';
      end if;
      prev_r := (fila->>'registrado_en')::timestamptz;
      prev_id := (fila->>'id')::bigint;
      vistos := vistos || (fila->>'id')::bigint;
    end loop;
    exit when pag->'siguiente' is null or pag->'siguiente' = 'null'::jsonb;
    cur_r := (pag->'siguiente'->>'registrado_en')::timestamptz;
    cur_i := (pag->'siguiente'->>'id')::bigint;
    update public.tarifa_hotel set neto_doble = neto_doble + 1 where id = a; -- versión nueva a mitad de la paginación
    if paginas > 20 then raise exception 'FALLO 7d: no termina'; end if;
  end loop;
  if array_length(vistos, 1) <> 1200 or paginas <> 6 then
    raise exception 'FALLO 7e: recorrió % filas en % páginas', array_length(vistos, 1), paginas;
  end if;

  -- Búsqueda: % y _ literales, sin distinguir mayúsculas; la página respeta el límite.
  pag := public.consultar_historial_tarifas(3, 'x_50%', null, null, 50);
  if (pag->>'total')::int <> 300 or jsonb_array_length(pag->'filas') <> 50 then raise exception 'FALLO 7f: búsqueda %', pag->>'total'; end if;
  if (public.consultar_historial_tarifas(3, '_', null, null, 10)->>'total')::int <> 300 then raise exception 'FALLO 7g: _ debe ser literal'; end if;
  if (public.consultar_historial_tarifas(3, 'no existe', null, null, 10)->>'total')::int <> 0 then raise exception 'FALLO 7h'; end if;
  begin
    perform public.consultar_historial_tarifas(3, null, now(), null, 10);
    raise exception 'FALLO 7i: aceptó cursor incompleto';
  exception when others then if sqlerrm not like '%cursor%' then raise; end if; end;
  raise notice 'OK    paginación por cursor en servidor: 1.200 versiones en 6 páginas, sin repetidos ni saltos aunque entren versiones nuevas; búsqueda con %% y _ literales';
end $$;

-- ── 8) Privilegios: historial inmutable por la API; funciones cerradas a anon
do $$
begin
  if has_table_privilege('authenticated', 'public.tarifa_hotel_historial', 'INSERT')
     or has_table_privilege('authenticated', 'public.tarifa_hotel_historial', 'UPDATE')
     or has_table_privilege('authenticated', 'public.tarifa_hotel_historial', 'DELETE')
     or has_table_privilege('authenticated', 'public.hotel_temporadas_historial', 'INSERT')
     or has_table_privilege('authenticated', 'public.hotel_temporadas_historial', 'DELETE')
     or has_table_privilege('anon', 'public.tarifa_hotel_historial', 'SELECT')
     or has_table_privilege('anon', 'public.hotel_temporadas_historial', 'SELECT') then
    raise exception 'FALLO: privilegios de escritura/anon en el historial';
  end if;
  if has_function_privilege('anon', 'public.generar_tarifas_hotel_calculadora(bigint, jsonb, boolean, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.consultar_historial_tarifas(bigint, text, timestamptz, bigint, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.reconstruir_tarifas_desde_auditoria(bigint)', 'EXECUTE') then
    raise exception 'FALLO: anon puede ejecutar funciones de la 203';
  end if;
  raise notice 'OK    historiales sin escritura por la API ni lectura anónima; funciones cerradas a anon';
end $$;

-- RLS de lectura vía la consulta paginada (SECURITY INVOKER).
grant usage on schema public, auth to authenticated;
grant execute on function public.mi_rol() to authenticated;
set role authenticated;
select set_config('test.rol', 'venta', false);
do $$ begin
  if (public.consultar_historial_tarifas(3, null, null, null, 10)->>'total')::int <> 0 then raise exception 'FALLO RLS: venta ve el historial'; end if;
  if (select count(*) from public.hotel_temporadas_historial) <> 0 then raise exception 'FALLO RLS: venta ve vigencias históricas'; end if;
end $$;
select set_config('test.rol', 'operaciones', false);
do $$ begin
  if (public.consultar_historial_tarifas(3, null, null, null, 10)->>'total')::int < 1200 then raise exception 'FALLO RLS: operaciones no ve el historial'; end if;
  raise notice 'OK    RLS: venta no ve el historial (ni por la consulta paginada); operaciones sí';
end $$;
reset role;

-- ── 9) Borrar el hotel no falla y el historial sobrevive ─────────────────
do $$
declare n bigint := (select count(*) from public.tarifa_hotel_historial where hotel_id = 2);
begin
  delete from public.hoteles where id = 2;
  if (select count(*) from public.tarifa_hotel_historial where hotel_id = 2) <> n + 1 then
    raise exception 'FALLO: el borrado en cascada no quedó en el historial';
  end if;
  raise notice 'OK    borrar un hotel versiona sus tarifas y el historial sobrevive';
end $$;

\echo 'TODAS LAS PRUEBAS DE LA 203 PASARON'
