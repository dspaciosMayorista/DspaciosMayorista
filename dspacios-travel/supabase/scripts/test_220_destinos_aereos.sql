-- ─────────────────────────────────────────────────────────────────────────
-- BATERÍA SQL · #67 (migración 220, destinos aéreos alternativos).
-- SOLO bases desechables (CI o local); nunca una base remota. Corre en UNA transacción que termina en
-- ROLLBACK. Las guardas son triggers de restricción DIFERIDOS: cada caso usa
-- `set constraints all immediate` (o la transacción de la subtransacción) para evaluarlas ya.
--
-- Uso:  psql -X -q -v ON_ERROR_STOP=1 -f test_220_destinos_aereos.sql   (base con 001-220)
-- Cierre esperado: "TEST 220 SQL: TODO OK".
--
--   P  país comparable (paridad con VECTORES_PAIS de la prueba TS)
--   E  destinos efectivos (OFF / ON / país ausente / inactivo / otro país / sin comercial)
--   V  vincular vuelos: Bloqueo y Sistema, fuera de alcance, ID inexistente, lote mezclado
--   C  configuración: país distinto, inactivo, ON sin alternativas, ON sin comercial, vínculo incompatible
--   R  retiro: quitar alternativa / apagar con vuelo vinculado se rechaza; desvincular antes sí
--   G  RPC guardar_destinos_aereos_67 (dedupe, atómica, rol sin permiso)
--   I  invalidación del tarifario (181) al cambiar check, alternativas, destino de fuente, país
--   A  ACL / RLS (anon sin acceso; venta sin acceso; interno con acceso)
-- ─────────────────────────────────────────────────────────────────────────
begin;

create schema t220;
create table t220.res (nombre text, ok boolean, detalle text);

create function t220.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void
language plpgsql as $$
begin
  insert into t220.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre;
  else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;

-- Ejecuta SQL (sentencias separadas por ';' dentro de UN texto), fuerza las guardas diferidas y
-- devuelve 'ok' o 'SQLSTATE: mensaje'. Subtransacción: si falla, se deshace todo lo del intento.
create function t220.intenta(p_sql text, p_rol text default null, p_uid uuid default null) returns text
language plpgsql as $$
declare v text := 'ok';
begin
  begin
    if p_rol is null then
      -- Sin rol de la API: el dueño de la base (que salta RLS) pero con la sesión de administración, para mi_rol().
      perform set_config('request.jwt.claims', json_build_object('sub', t220.u('admin'), 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', t220.u('admin')::text, true);
    else
      perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_rol)::text end, true);
      perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
      execute format('set local role %I', p_rol);
    end if;
    execute p_sql;
    set constraints all immediate;
    set constraints all deferred;
  exception when others then
    v := sqlstate || ': ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

create function t220.rechaza(p_nombre text, p_res text, p_patron text) returns void
language plpgsql as $$
begin
  perform t220.afirma(p_nombre, p_res <> 'ok' and p_res like '%' || p_patron || '%', p_res);
end $$;
create function t220.acepta(p_nombre text, p_res text) returns void
language plpgsql as $$
begin
  perform t220.afirma(p_nombre, p_res = 'ok', p_res);
end $$;

create function t220.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000220' || case p_k
    when 'admin' then '002' when 'oper' then '004' when 'venta' then '005' else '999' end)::uuid
$$;

insert into auth.users (id, email)
select t220.u(k), 'c220-' || k || '@x.test' from unnest(array['admin','oper','venta']) k on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t220.u(k), 'c220-' || k || '@x.test', 'C220 ' || k, r::rol_usuario, true, 'mayorista'
from (values ('admin','administracion'), ('oper','operaciones'), ('venta','venta')) v(k, r)
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;

-- ── Fixtures: Juan Dolio con Santo Domingo y Punta Cana (RD), otro país, país ausente, inactivo ──
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values
  (92010, 'T220 JUAN DOLIO',     null,  'República Dominicana', true),
  (92020, 'T220 SANTO DOMINGO',  'SDQ', ' REPUBLICA   DOMINICANA ', true),
  (92030, 'T220 PUNTA CANA',     'PUJ', 'república dominicana', true),
  (92040, 'T220 CARTAGENA',      'CTG', 'Colombia', true),
  (92050, 'T220 SIN PAIS',       'XXX', null, true),
  (92060, 'T220 SAMANA INACTIVO','AZS', 'República Dominicana', false),
  (92070, 'T220 ALIAS RD',       'RD1', 'RD', true);
-- Los ids explícitos no avanzan la secuencia: se asegura para otros inserts del esquema.
select setval(pg_get_serial_sequence('public.destinos', 'id'), greatest((select max(id) from public.destinos), 92070));

insert into public.bloqueos_vuelo (id, record, ruta, fecha_ida, fecha_regreso, cupos_total, destino_id) values
  (92101, 'T220A1', 'BOG - PUJ - BOG', current_date + 40, current_date + 44, 10, 92030),
  (92102, 'T220A2', 'BOG - PUJ - BOG', current_date + 50, current_date + 54, 10, 92030),
  (92103, 'T220A3', 'BOG - SDQ - BOG', current_date + 60, current_date + 64, 10, 92020),
  (92104, 'T220A4', 'BOG - CTG - BOG', current_date + 60, current_date + 64, 10, 92040),
  (92105, 'T220A5', 'BOG - JDO - BOG', current_date + 60, current_date + 64, 10, 92010),
  (92106, 'T220A6', 'BOG - XXX - BOG', current_date + 60, current_date + 64, 10, 92050),
  (92107, 'T220A7', 'BOG - AZS - BOG', current_date + 60, current_date + 64, 10, 92060),
  (92108, 'T220A8', 'BOG - SIN',       current_date + 60, current_date + 64, 10, null);
insert into public.empaquetados (id, record, ruta, fecha_ida, fecha_regreso, destino_id, activo) values
  (92201, 'T220E1', 'BOG - PUJ - BOG', current_date + 40, current_date + 44, 92030, true),
  (92202, 'T220E2', 'BOG - CTG - BOG', current_date + 40, current_date + 44, 92040, true),
  (92203, 'T220E3', 'BOG - SDQ - BOG', current_date + 40, current_date + 44, 92020, true);
select setval(pg_get_serial_sequence('public.bloqueos_vuelo', 'id'), greatest((select max(id) from public.bloqueos_vuelo), 92108));
select setval(pg_get_serial_sequence('public.empaquetados', 'id'), greatest((select max(id) from public.empaquetados), 92203));

-- Paquetes (se crean con el check apagado y sin alternativas: nada que validar al insertar).
insert into public.armado_paquetes (id, nombre, destino_id) values
  (92301, 'T220 Juan Dolio',     92010),
  (92302, 'T220 Cartagena',      92040),
  (92303, 'T220 Sin destino',    null),
  (92304, 'T220 Sin país',       92050),
  (92305, 'T220 Juan Dolio B',   92010);
select setval(pg_get_serial_sequence('public.armado_paquetes', 'id'), greatest((select max(id) from public.armado_paquetes), 92305));

-- ═ P · país comparable: paridad con VECTORES_PAIS ═════════════════════════
do $$
declare r record;
begin
  for r in select * from (values
    ('Colombia', 'colombia'), ('  colombia  ', 'colombia'), ('COLOMBIA', 'colombia'),
    ('República Dominicana', 'republica dominicana'), ('REPÚBLICA DOMINICANA', 'republica dominicana'),
    ('  republica   dominicana ', 'republica dominicana'), (E'República\tDominicana', 'republica dominicana'),
    ('Perú', 'peru'), ('MÉXICO', 'mexico'), ('España', 'espana'), ('Curaçao', 'curacao'),
    ('', null), ('   ', null), (null, null), ('RD', 'rd')
  ) v(entrada, esperado) loop
    perform t220.afirma('P ' || coalesce(r.entrada, '<null>'),
      public.pais_comparable_67(r.entrada) is not distinct from r.esperado,
      'obtenido=' || coalesce(public.pais_comparable_67(r.entrada), '<null>') || ' esperado=' || coalesce(r.esperado, '<null>'));
  end loop;
end $$;
select t220.afirma('P alias: "RD" no equivale a "república dominicana"',
  public.pais_comparable_67('RD') is distinct from public.pais_comparable_67('República Dominicana'));

-- ═ E · destinos efectivos ═════════════════════════════════════════════════
select t220.afirma('E1 OFF = solo el comercial',
  public.destinos_aereos_efectivos_67(92010, false, array[92020, 92030]::bigint[]) = array[92010]::bigint[]);
select t220.afirma('E2 ON = comercial + alternativas del mismo país (aunque el país tenga distinto formato)',
  public.destinos_aereos_efectivos_67(92010, true, array[92020, 92030]::bigint[]) = array[92010, 92020, 92030]::bigint[]);
select t220.afirma('E3 ON excluye otro país',
  public.destinos_aereos_efectivos_67(92010, true, array[92020, 92040]::bigint[]) = array[92010, 92020]::bigint[]);
select t220.afirma('E4 ON excluye inactivo',
  public.destinos_aereos_efectivos_67(92010, true, array[92060, 92030]::bigint[]) = array[92010, 92030]::bigint[]);
select t220.afirma('E5 ON excluye país ausente de la alternativa',
  public.destinos_aereos_efectivos_67(92010, true, array[92050]::bigint[]) = array[92010]::bigint[]);
select t220.afirma('E6 comercial sin país: ON no autoriza alternativas',
  public.destinos_aereos_efectivos_67(92050, true, array[92020]::bigint[]) = array[92050]::bigint[]);
select t220.afirma('E7 sin destino comercial = nada (no hay respaldo "todos")',
  public.destinos_aereos_efectivos_67(null, true, array[92020]::bigint[]) = '{}'::bigint[]
  and public.destinos_aereos_efectivos_67(null, false, null) = '{}'::bigint[]);
select t220.afirma('E8 alias "RD" no se une a República Dominicana',
  public.destinos_aereos_efectivos_67(92010, true, array[92070]::bigint[]) = array[92010]::bigint[]);
select t220.afirma('E9 el comercial dentro de las alternativas no se duplica',
  public.destinos_aereos_efectivos_67(92010, true, array[92010, 92030]::bigint[]) = array[92010, 92030]::bigint[]);

-- ═ V · vincular vuelos ════════════════════════════════════════════════════
-- Paquete 92301 (Juan Dolio) con el check APAGADO: solo vuelos a Juan Dolio.
select t220.acepta('V1 OFF: vuelo al destino comercial',
  t220.intenta('insert into public.armado_vuelos (paquete_id, bloqueo_id) values (92301, 92105)'));
select t220.rechaza('V2 OFF: vuelo a Punta Cana rechazado',
  t220.intenta('insert into public.armado_vuelos (paquete_id, bloqueo_id) values (92301, 92101)'), 'destino_aereo_no_permitido');
select t220.rechaza('V3 OFF: empaquetado Sistema a Punta Cana rechazado',
  t220.intenta('insert into public.armado_empaquetados (paquete_id, empaquetado_id) values (92301, 92201)'), 'destino_aereo_no_permitido');
select t220.rechaza('V4 vuelo sin destino registrado rechazado',
  t220.intenta('insert into public.armado_vuelos (paquete_id, bloqueo_id) values (92301, 92108)'), 'destino_aereo_no_permitido');
select t220.rechaza('V5 paquete sin destino comercial: ningún vuelo',
  t220.intenta('insert into public.armado_vuelos (paquete_id, bloqueo_id) values (92303, 92105)'), 'destino_aereo_no_permitido');
select t220.afirma('V6 nada quedó vinculado por los rechazos',
  (select count(*) from public.armado_vuelos where paquete_id = 92301) = 1
  and (select count(*) from public.armado_empaquetados where paquete_id = 92301) = 0
  and (select count(*) from public.armado_vuelos where paquete_id = 92303) = 0);
select t220.rechaza('V7 ID de fuente inexistente (forjado)',
  t220.intenta('insert into public.armado_empaquetados (paquete_id, empaquetado_id) values (92301, 999999999)'), 'violates foreign key');

-- Lote mezclado: un vuelo válido y uno inválido en la MISMA sentencia -> todo o nada.
select t220.rechaza('V8 lote mezclado: se rechaza completo',
  t220.intenta('insert into public.armado_vuelos (paquete_id, bloqueo_id) values (92301, 92105), (92301, 92104)'), 'destino_aereo_no_permitido');
select t220.afirma('V9 lote mezclado: no quedó ningún vínculo parcial nuevo',
  (select count(*) from public.armado_vuelos where paquete_id = 92301) = 1);

-- Configuración ON con alternativas por la RPC (como lo hace el servidor).
select t220.acepta('G1 RPC guarda destino + check + alternativas',
  t220.intenta('select public.guardar_destinos_aereos_67(92301, 92010, true, array[92020, 92030]::bigint[])'));
select t220.afirma('G2 quedó el check y las dos alternativas',
  (select destinos_aereos_alternativos from public.armado_paquetes where id = 92301)
  and (select array_agg(destino_id order by destino_id) from public.armado_paquete_destinos_aereos where paquete_id = 92301) = array[92020, 92030]::bigint[]);

select t220.acepta('V10 ON: vuelo a Punta Cana',
  t220.intenta('insert into public.armado_vuelos (paquete_id, bloqueo_id) values (92301, 92101)'));
select t220.acepta('V11 ON: VARIOS vuelos al mismo destino alternativo (Punta Cana)',
  t220.intenta('insert into public.armado_vuelos (paquete_id, bloqueo_id) values (92301, 92102)'));
select t220.acepta('V12 ON: vuelo a Santo Domingo',
  t220.intenta('insert into public.armado_vuelos (paquete_id, bloqueo_id) values (92301, 92103)'));
select t220.acepta('V13 ON: empaquetado Sistema a Punta Cana y a Santo Domingo',
  t220.intenta('insert into public.armado_empaquetados (paquete_id, empaquetado_id) values (92301, 92201), (92301, 92203)'));
select t220.rechaza('V14 ON: otro país sigue rechazado (Cartagena)',
  t220.intenta('insert into public.armado_vuelos (paquete_id, bloqueo_id) values (92301, 92104)'), 'destino_aereo_no_permitido');
select t220.rechaza('V15 ON: destino sin país sigue rechazado',
  t220.intenta('insert into public.armado_vuelos (paquete_id, bloqueo_id) values (92301, 92106)'), 'destino_aereo_no_permitido');
select t220.rechaza('V16 ON: destino inactivo no es alternativa válida',
  t220.intenta('insert into public.armado_vuelos (paquete_id, bloqueo_id) values (92301, 92107)'), 'destino_aereo_no_permitido');
select t220.rechaza('V17 ON: empaquetado a otro país rechazado',
  t220.intenta('insert into public.armado_empaquetados (paquete_id, empaquetado_id) values (92301, 92202)'), 'destino_aereo_no_permitido');
select t220.afirma('V18 dedupe: reinsertar el mismo vínculo no duplica (upsert)',
  t220.intenta('insert into public.armado_vuelos (paquete_id, bloqueo_id) values (92301, 92101) on conflict (paquete_id, bloqueo_id) do update set ta = 0') = 'ok'
  and (select count(*) from public.armado_vuelos where paquete_id = 92301 and bloqueo_id = 92101) = 1);

-- Cambiar el destino de la FUENTE de un vínculo existente a algo no permitido se rechaza al mover el vínculo.
select t220.rechaza('V19 mover un vínculo a otro bloqueo no permitido',
  t220.intenta('update public.armado_vuelos set bloqueo_id = 92104 where paquete_id = 92301 and bloqueo_id = 92101'), 'destino_aereo_no_permitido');

-- ═ C · configuración ═══════════════════════════════════════════════════════
select t220.rechaza('C1 alternativa de OTRO país rechazada',
  t220.intenta('select public.guardar_destinos_aereos_67(92305, 92010, true, array[92040]::bigint[])'), 'destino_aereo_config');
select t220.rechaza('C2 alternativa INACTIVA rechazada',
  t220.intenta('select public.guardar_destinos_aereos_67(92305, 92010, true, array[92060]::bigint[])'), 'destino_aereo_config');
select t220.rechaza('C3 alternativa SIN PAÍS rechazada',
  t220.intenta('select public.guardar_destinos_aereos_67(92305, 92010, true, array[92050]::bigint[])'), 'destino_aereo_config');
select t220.rechaza('C4 alias RD no comparable rechazado',
  t220.intenta('select public.guardar_destinos_aereos_67(92305, 92010, true, array[92070]::bigint[])'), 'destino_aereo_config');
select t220.rechaza('C5 ID de destino inexistente (forjado)',
  t220.intenta('select public.guardar_destinos_aereos_67(92305, 92010, true, array[999999999]::bigint[])'), 'destino_aereo_config');
select t220.rechaza('C6 ON sin ninguna alternativa',
  t220.intenta('select public.guardar_destinos_aereos_67(92305, 92010, true, ''{}''::bigint[])'), 'al menos uno');
select t220.rechaza('C7 ON con solo el comercial como "alternativa" (se descarta, queda vacío)',
  t220.intenta('select public.guardar_destinos_aereos_67(92305, 92010, true, array[92010]::bigint[])'), 'al menos uno');
select t220.rechaza('C8 ON sin destino comercial',
  t220.intenta('select public.guardar_destinos_aereos_67(92305, null, true, array[92020]::bigint[])'), 'destino_aereo_config');
select t220.rechaza('C9 comercial sin país: las alternativas no se admiten',
  t220.intenta('select public.guardar_destinos_aereos_67(92304, 92050, true, array[92020]::bigint[])'), 'país');
select t220.afirma('C10 los rechazos no dejaron cambios parciales en el paquete 92305',
  not (select destinos_aereos_alternativos from public.armado_paquetes where id = 92305)
  and not exists (select 1 from public.armado_paquete_destinos_aereos where paquete_id = 92305));
select t220.rechaza('C11 inserción directa de una alternativa de otro país (sin RPC)',
  t220.intenta('insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id) values (92305, 92040)'), 'destino_aereo_config');
select t220.rechaza('C12 update directo del check a true sin alternativas',
  t220.intenta('update public.armado_paquetes set destinos_aereos_alternativos = true where id = 92305'), 'al menos uno');
select t220.acepta('C13 apagado con alternativas válidas guardadas es consistente',
  t220.intenta('insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id) values (92305, 92030)'));

-- ═ R · retiro con vuelos vinculados ════════════════════════════════════════
-- 92301 tiene vuelos a Punta Cana (92101, 92102), Santo Domingo (92103), Juan Dolio (92105) y empaquetados PUJ/SDQ.
select t220.rechaza('R1 quitar Punta Cana mientras hay vuelos a Punta Cana',
  t220.intenta('select public.guardar_destinos_aereos_67(92301, 92010, true, array[92020]::bigint[])'), 'destino_aereo_vinculos');
select t220.rechaza('R2 apagar el check mientras hay vuelos alternativos',
  t220.intenta('select public.guardar_destinos_aereos_67(92301, 92010, false, array[92020, 92030]::bigint[])'), 'destino_aereo_vinculos');
select t220.rechaza('R3 cambiar el destino comercial dejando vuelos incompatibles',
  t220.intenta('update public.armado_paquetes set destino_id = 92040 where id = 92301'), 'destino_aereo_config');
select t220.afirma('R4 los rechazos no cambiaron nada (config y vínculos intactos)',
  (select destinos_aereos_alternativos from public.armado_paquetes where id = 92301)
  and (select count(*) from public.armado_paquete_destinos_aereos where paquete_id = 92301) = 2
  and (select count(*) from public.armado_vuelos where paquete_id = 92301) = 4
  and (select count(*) from public.armado_empaquetados where paquete_id = 92301) = 2);
select t220.acepta('R5 desvincular explícitamente y apagar en UNA transacción',
  t220.intenta('delete from public.armado_vuelos where paquete_id = 92301 and bloqueo_id <> 92105;
                delete from public.armado_empaquetados where paquete_id = 92301;
                select public.guardar_destinos_aereos_67(92301, 92010, false, ''{}''::bigint[])'));
select t220.afirma('R6 quedó solo el vuelo al comercial y sin alternativas',
  not (select destinos_aereos_alternativos from public.armado_paquetes where id = 92301)
  and (select count(*) from public.armado_vuelos where paquete_id = 92301) = 1
  and (select count(*) from public.armado_paquete_destinos_aereos where paquete_id = 92301) = 0);
select t220.acepta('R7 desvincular siempre se permite aunque el vuelo sea incompatible',
  t220.intenta('delete from public.armado_vuelos where paquete_id = 92301'));

-- Vuelo incompatible YA vinculado (dato antiguo): editar otra cosa del paquete no lo valida; tocar la config sí.
alter table public.armado_vuelos disable trigger tr_vinculo_aereo_67;
insert into public.armado_vuelos (paquete_id, bloqueo_id) values (92305, 92104);   -- Cartagena en un paquete de Juan Dolio
alter table public.armado_vuelos enable trigger tr_vinculo_aereo_67;
select t220.acepta('R8 renombrar el paquete con un vínculo antiguo incompatible no se bloquea',
  t220.intenta('update public.armado_paquetes set nombre = nombre || '' x'' where id = 92305'));
select t220.rechaza('R9 pero tocar la config con ese vínculo incompatible exige desvincular',
  t220.intenta('select public.guardar_destinos_aereos_67(92305, 92010, true, array[92030]::bigint[])'), 'destino_aereo_vinculos');
delete from public.armado_vuelos where paquete_id = 92305;

-- ═ G · RPC ═════════════════════════════════════════════════════════════════
select t220.acepta('G3 dedupe de la lista y descarte del comercial y de nulls',
  t220.intenta('select public.guardar_destinos_aereos_67(92305, 92010, true, array[92030, 92030, 92010, null, 92020]::bigint[])'));
select t220.afirma('G4 quedaron exactamente 2 filas, sin duplicados',
  (select array_agg(destino_id order by destino_id) from public.armado_paquete_destinos_aereos where paquete_id = 92305) = array[92020, 92030]::bigint[]);
select t220.rechaza('G5 paquete inexistente',
  t220.intenta('select public.guardar_destinos_aereos_67(999999, 92010, false, ''{}''::bigint[])'), 'no existe');
select t220.rechaza('G6 rol venta sin permiso',
  t220.intenta('select public.guardar_destinos_aereos_67(92305, 92010, false, ''{}''::bigint[])', 'authenticated', t220.u('venta')), 'sin permiso');
select t220.acepta('G7 rol operaciones con permiso',
  t220.intenta('select public.guardar_destinos_aereos_67(92305, 92010, false, ''{}''::bigint[])', 'authenticated', t220.u('oper')));
select t220.rechaza('G8 anon no ejecuta la RPC',
  t220.intenta('select public.guardar_destinos_aereos_67(92305, 92010, false, ''{}''::bigint[])', 'anon', null), 'permission denied');

-- ═ I · invalidación del tarifario (181) ════════════════════════════════════
create function t220.rev(p_id bigint) returns text language plpgsql as $$
declare v text;
begin
  select tarifario_revision_fuente::text into v from public.armado_paquetes where id = p_id;
  return v;
exception when undefined_column then return null; end $$;
do $$
declare v_antes text; v_despues text;
begin
  if t220.rev(92305) is null then
    perform t220.afirma('I0 la columna de revisión de la 181 no existe en este esquema (se omite I)', true);
    return;
  end if;
  v_antes := t220.rev(92305);
  perform set_config('request.jwt.claim.sub', t220.u('admin')::text, true);
  perform public.guardar_destinos_aereos_67(92305, 92010, true, array[92020]::bigint[]);
  set constraints all immediate; set constraints all deferred;
  perform set_config('request.jwt.claim.sub', '', true);
  v_despues := t220.rev(92305);
  perform t220.afirma('I1 cambiar check y alternativas registra una revisión nueva', v_despues is distinct from v_antes, v_antes || ' -> ' || v_despues);
  v_antes := v_despues;
  update public.destinos set pais = 'Otro País' where id = 92020;
  v_despues := t220.rev(92305);
  perform t220.afirma('I2 cambiar el país de una alternativa registra revisión', v_despues is distinct from v_antes, v_antes || ' -> ' || v_despues);
end $$;

-- ═ A · ACL y RLS ════════════════════════════════════════════════════════════
select t220.rechaza('A1 anon no lee la tabla de alternativas',
  t220.intenta('select * from public.armado_paquete_destinos_aereos', 'anon', null), 'permission denied');
select t220.afirma('A2 control: hay filas de alternativas para el interno',
  (select count(*) from public.armado_paquete_destinos_aereos) > 0);
select t220.acepta('A2b venta no ve ninguna fila de alternativas (RLS)',
  t220.intenta('do $x$ begin if (select count(*) from public.armado_paquete_destinos_aereos) > 0 then raise exception ''visible''; end if; end $x$',
               'authenticated', t220.u('venta')));
select t220.rechaza('A3 venta no escribe alternativas',
  t220.intenta('insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id) values (92305, 92030)', 'authenticated', t220.u('venta')), 'row-level security');
select t220.rechaza('A4 authenticated no ejecuta las funciones internas',
  t220.intenta('select public.validar_config_destinos_aereos_67(92301)', 'authenticated', t220.u('admin')), 'permission denied');
select t220.rechaza('A5 anon no ejecuta pais_comparable_67',
  t220.intenta('select public.pais_comparable_67(''x'')', 'anon', null), 'permission denied');
select t220.acepta('A6 administración sí inserta alternativas válidas',
  t220.intenta('insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id) values (92301, 92030) on conflict do nothing', 'authenticated', t220.u('admin')));

-- ═ Cierre ═══════════════════════════════════════════════════════════════════
do $$
declare v_mal int; v_total int;
begin
  select count(*) filter (where not ok), count(*) into v_mal, v_total from t220.res;
  if v_mal > 0 then
    raise exception 'TEST 220 SQL: % de % comprobaciones fallaron', v_mal, v_total;
  end if;
  raise notice 'TEST 220 SQL: TODO OK (% comprobaciones)', v_total;
end $$;

rollback;
