-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBA 214 · registro central de personas (#32), sobre la migración REAL.
--
-- Base LOCAL DESECHABLE con el esquema vigente y la 214 aplicada (lo hace
-- test_214_personas_carreras.sh, que además prueba carreras, aislamiento, API con JWT y
-- rollback). Todo corre en UNA transacción que TERMINA EN ROLLBACK.
--
-- Uso (lo invoca el runner): el archivo de vectores debe estar en el contenedor en
--   /tmp/personasIdentidad.vectores.json   y se ejecuta como superusuario local:
--   psql -v ON_ERROR_STOP=1 -f test_214_personas_identidad.sql
--
-- Límite que se registra: aquí la identidad del actor se fija con request.jwt.claims dentro de
-- una sesión psql que ya puede hacer SET ROLE. Eso prueba la LÓGICA DE AUTORIZACIÓN de la
-- función dado un contexto de claims, no la seguridad de la autenticación (cualquiera con SQL
-- como authenticated puede fijar esos GUC). La autenticación se prueba por HTTP con JWT
-- firmados contra PostgREST en el runner.
-- ───────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP on
\set vectores `cat /tmp/personasIdentidad.vectores.json`

begin;

create temp table t214_vectores as select (:'vectores')::jsonb as j;

create function pg_temp.esperar(p_nombre text, p_ok boolean) returns void language plpgsql as $f$
begin
  if p_ok is not true then
    raise exception 'FALLO: %', p_nombre;
  end if;
  raise notice 'OK    %', p_nombre;
end $f$;

create function pg_temp.vacio() returns jsonb language sql immutable as $f$
  select jsonb_build_object('persona', null, 'observaciones', '[]'::jsonb, 'total', 0,
                            'has_more', false, 'divergencia', false, 'variantes', '[]'::jsonb)
$f$;

-- ═══ V · Vectores compartidos (mismo JSON que la prueba TypeScript) ═══════════════════════
do $$
declare
  v jsonb;
  r record;
  n integer := 0;
  fallos text := '';
  e text;
begin
  for v in select x.value from t214_vectores, jsonb_array_elements(j -> 'gramatica') x loop
    select g.* into r
      from p214_priv.norm_documento(v ->> 'tipo', v ->> 'numero', (v ->> 'marca')::boolean, v ->> 'modo') g;
    if r.tipo_doc is distinct from (v -> 'esperado' ->> 'tipo_doc')
       or r.numero_norm is distinct from (v -> 'esperado' ->> 'numero_norm')
       or r.estado is distinct from (v -> 'esperado' ->> 'estado')
       or r.motivo is distinct from (v -> 'esperado' ->> 'motivo') then
      fallos := fallos || (v ->> 'id') || format(' [%s|%s|%s|%s] ', r.tipo_doc, r.numero_norm, r.estado, r.motivo);
    end if;
    n := n + 1;
  end loop;
  perform pg_temp.esperar(format('V1 gramática SQL: %s vectores con salida idéntica a la esperada %s', n, fallos), fallos = '' and n = 65);

  n := 0;
  for v in select x.value from t214_vectores, jsonb_array_elements(j -> 'errores_de_llamada') x loop
    begin
      perform p214_priv.norm_documento(v ->> 'tipo', v ->> 'numero', (v ->> 'marca')::boolean, v ->> 'modo');
      e := 'sin-error';
    exception when others then
      e := sqlstate;
    end;
    if e <> '22023' then
      fallos := fallos || (v ->> 'id') || ':' || e || ' ';
    end if;
    n := n + 1;
  end loop;
  perform pg_temp.esperar(format('V2 llamadas mal formadas rechazadas con 22023: %s %s', n, fallos), fallos = '' and n = 3);

  n := 0;
  for v in select x.value from t214_vectores, jsonb_array_elements(j -> 'dv') x loop
    if p214_priv.dv_nit_valido(v ->> 'dv') is distinct from (v ->> 'esperado')::boolean then
      fallos := fallos || (v ->> 'id') || ' ';
    end if;
    n := n + 1;
  end loop;
  perform pg_temp.esperar(format('V3 dv_nit_valido: %s vectores %s', n, fallos), fallos = '' and n = 14);

  n := 0;
  for v in select x.value from t214_vectores, jsonb_array_elements(j -> 'longitud_original') x loop
    if (char_length(repeat(v ->> 'unidad', (v ->> 'veces')::integer)) <= 64) is distinct from (v ->> 'cabe')::boolean then
      fallos := fallos || (v ->> 'id') || ' ';
    end if;
    n := n + 1;
  end loop;
  perform pg_temp.esperar(format('V4 longitud de originales en puntos de código: %s vectores %s', n, fallos), fallos = '' and n = 5);

  n := 0;
  for v in select x.value from t214_vectores, jsonb_array_elements(j -> 'gramatica') x
            where x.value -> 'esperado' ->> 'estado' = 'documentada' and x.value -> 'esperado' ->> 'tipo_doc' <> 'NIT' loop
    if public.crm_lead_normalizar_documento(v ->> 'numero') is distinct from (v -> 'esperado' ->> 'numero_norm') then
      fallos := fallos || (v ->> 'id') || ' ';
    end if;
    n := n + 1;
  end loop;
  perform pg_temp.esperar(format('V5 coincide con la 202 en %s entradas válidas no NIT %s', n, fallos), fallos = '' and n = 14);
  raise notice 'INFO  solo_ts: % vectores (NUL y surrogates sueltos) no aplican a SQL', (select jsonb_array_length(j -> 'solo_ts') from t214_vectores);
end $$;

-- ═══ Datos: usuarios, contratos y pasajeros ═══════════════════════════════════════════════
create temp table t214_ids (clave text primary key, valor text not null);

do $$
declare
  u record;
begin
  for u in select * from (values
      ('u_sa', '00000000-0000-4000-a000-000000000001', 'superadmin',     'mayorista', true,  'Sara Admin'),
      ('u_ge', '00000000-0000-4000-a000-000000000002', 'gerencia',       'mayorista', true,  'Gina Gerente'),
      ('u_ad', '00000000-0000-4000-a000-000000000003', 'administracion', 'mayorista', true,  'Adan Admin'),
      ('u_op', '00000000-0000-4000-a000-000000000004', 'operaciones',    'mayorista', true,  'Olga Ops'),
      ('u_va', '00000000-0000-4000-a000-000000000005', 'venta',          'mayorista', true,  'Ana Ruiz'),
      ('u_vl', '00000000-0000-4000-a000-000000000006', 'venta',          'mayorista', true,  'Luis Mora'),
      ('u_vm', '00000000-0000-4000-a000-000000000007', 'venta',          'minorista', true,  'Luis Mora'),
      ('u_am', '00000000-0000-4000-a000-000000000008', 'administracion', 'minorista', true,  'Marta Min'),
      ('u_ag', '00000000-0000-4000-a000-000000000009', 'agencia',        'mayorista', true,  'Agencia Uno'),
      ('u_cv', '00000000-0000-4000-a000-000000000010', 'control_vuelo',  'mayorista', true,  'Carlos Vuelo'),
      ('u_in', '00000000-0000-4000-a000-000000000011', 'venta',          'mayorista', false, 'Ines Inactiva')
    ) t(clave, id, rol, tenant, activo, nombre) loop
    insert into auth.users (id, email) values (u.id::uuid, 't214_' || u.clave || '@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant)
    values (u.id::uuid, 't214_' || u.clave || '@x.test', u.nombre, u.rol::rol_usuario, u.activo, u.tenant)
    on conflict (id) do update set email = excluded.email, nombre = excluded.nombre, rol = excluded.rol,
                                   activo = excluded.activo, tenant = excluded.tenant;
    insert into t214_ids values (u.clave, u.id);
  end loop;
  insert into t214_ids values ('u_nf', '00000000-0000-4000-a000-000000000099');

  insert into public.ventas (numero_contrato, cliente, asesor, tenant) values
    ('DTM-92141', 'Cliente prueba', 'Ana Ruiz', 'mayorista'),
    ('DTM-92142', 'Cliente prueba', 'Pedro Diaz', 'mayorista'),
    ('MIN-T214-01', 'Cliente prueba', 'Luis Mora', 'minorista');
end $$;

-- Ids de pasajeros (un insert por contrato para conservar cada id).
with i as (insert into public.contrato_pasajeros (numero_contrato, nombre) values ('DTM-92141', 'Pasajero 1') returning id)
insert into t214_ids select 'cp_t214_m_01', id::text from i;
with i as (insert into public.contrato_pasajeros (numero_contrato, nombre) values ('DTM-92142', 'Pasajero 2') returning id)
insert into t214_ids select 'cp_t214_m_02', id::text from i;
with i as (insert into public.contrato_pasajeros (numero_contrato, nombre) values ('MIN-T214-01', 'Pasajero 3') returning id)
insert into t214_ids select 'cp_t214_n_01', id::text from i;

create function pg_temp.id(p text) returns text language sql stable as $f$ select valor from t214_ids where clave = p $f$;
create function pg_temp.captura(p_n integer) returns uuid language sql immutable as $f$
  select ('00000000-0000-4000-b000-' || lpad(p_n::text, 12, '0'))::uuid
$f$;

-- Escritor: siempre como service_role (la ruta real de #42). Devuelve 'persona_id|resultado' o 'ERR sqlstate mensaje'.
create function pg_temp.alta(p_captura integer, p_tenant text, p_fuente text, p_tipo text, p_numero text,
                             p_dv text, p_obs jsonb, p_contrato text, p_pasajero text) returns text
language plpgsql as $f$
declare
  r record;
  v text;
begin
  set local role service_role;
  begin
    select * into r from p214_priv.upsert_persona(pg_temp.captura(p_captura), p_tenant, p_fuente, p_tipo, p_numero,
                                                  p_dv, p_obs, p_contrato, p_pasajero::bigint, null, 'operaciones');
    v := r.persona_id::text || '|' || r.resultado;
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  return v;
end $f$;

create function pg_temp.promover(p_persona text, p_captura integer, p_tipo text, p_numero text, p_dv text, p_obs jsonb)
returns text language plpgsql as $f$
declare
  r record;
  v text;
begin
  set local role service_role;
  begin
    select * into r from p214_priv.promover_persona(p_persona::uuid, pg_temp.captura(p_captura), p_tipo, p_numero, p_dv, p_obs);
    v := coalesce(r.persona_id::text, 'null') || '|' || r.resultado;
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  return v;
end $f$;

-- Consulta como un usuario (claims de sesión local) con el rol `authenticated`.
create function pg_temp.buscar(p_usuario text, p_tenant text, p_tipo text, p_numero text,
                               p_limite integer default 20, p_offset integer default 0) returns jsonb
language plpgsql as $f$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(p_usuario), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    v := public.buscar_personas_documento(p_tenant, p_tipo, p_numero, p_limite, p_offset);
  exception when others then
    v := jsonb_build_object('sqlstate', sqlstate, 'mensaje', sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  return v;
end $f$;

create function pg_temp.conteos() returns text language sql stable as $f$
  select (select count(*) from public.personas) || '/' || (select count(*) from public.persona_capturas) || '/'
         || (select count(*) from public.persona_observaciones)
$f$;

-- ═══ E · Escritores (como service_role) ════════════════════════════════════════════════════
do $$
declare
  a text; b text; c text; d text; p1 text; p2 text; antes text; v_dv text;
  r record;
begin
  -- E1 alta, reintento, captura inconsistente y otra captura de la misma clave.
  a := pg_temp.alta(1, 'mayorista', 'captura_interna', 'CC', '1.020.304.050', null,
                    '[{"campo":"nombres","valor":"Ana"},{"campo":"apellidos","valor":"Gomez"},{"campo":"telefono","valor":"3001112233"}]', null, null);
  perform pg_temp.esperar('E1a alta documentada CC: ' || a, a like '%|creada');
  p1 := split_part(a, '|', 1);
  insert into t214_ids values ('p1', p1);
  b := pg_temp.alta(1, 'mayorista', 'captura_interna', 'CC', '1.020.304.050', null,
                    '[{"campo":"telefono","valor":"3001112233"},{"campo":"nombres","valor":"Ana"},{"campo":"apellidos","valor":"Gomez"}]', null, null);
  perform pg_temp.esperar('E1b reintento de la MISMA captura (observaciones en otro orden): misma persona, resultado reintento', b = p1 || '|reintento');
  antes := pg_temp.conteos();
  c := pg_temp.alta(1, 'mayorista', 'captura_interna', 'CC', '1.020.304.050', null, '[{"campo":"nombres","valor":"Otra"}]', null, null);
  perform pg_temp.esperar('E1c mismo id de captura con otra carga: captura_inconsistente, nada escrito', c like 'ERR P0001 captura_inconsistente%' and pg_temp.conteos() = antes);
  d := pg_temp.alta(2, 'mayorista', 'contrato_pasajero', 'cc', '1020304050', null,
                    '[{"campo":"nombres","valor":"Ana Maria"},{"campo":"fecha_nacimiento","valor":"1990-01-01"}]', 'DTM-92141', pg_temp.id('cp_t214_m_01'));
  perform pg_temp.esperar('E1d otra captura de la misma clave en otro formato: existente, misma persona', d = p1 || '|existente');
  perform pg_temp.esperar('E1e la captura conserva el documento tal como lo afirmó (cc / 1020304050)',
    (select tipo_doc_capturado || '/' || documento_capturado from public.persona_capturas where id = pg_temp.captura(2)) = 'cc/1020304050'
    and (select documento_original from public.personas where id = p1::uuid) = '1.020.304.050');
  c := pg_temp.alta(3, 'mayorista', 'contrato_pasajero', 'CC', '1020304050', null,
                    '[{"campo":"fecha_nacimiento","valor":"1991-02-02"},{"campo":"nacionalidad","valor":"XX-AJENA"}]', 'DTM-92142', pg_temp.id('cp_t214_m_02'));
  perform pg_temp.esperar('E1f captura de un contrato del colega: existente', c = p1 || '|existente');

  -- E2 dos capturas independientes con el mismo campo y valor no se colapsan.
  c := pg_temp.alta(4, 'mayorista', 'captura_interna', 'CC', '1020304050', null, '[{"campo":"nombres","valor":"Ana"}]', null, null);
  perform pg_temp.esperar('E2 dos capturas independientes con nombres=Ana: 2 observaciones de 2 capturas',
    c = p1 || '|existente'
    and (select count(*) from public.persona_observaciones where persona_id = p1::uuid and campo = 'nombres' and valor = 'Ana') = 2
    and (select count(distinct captura_id) from public.persona_observaciones where persona_id = p1::uuid and campo = 'nombres' and valor = 'Ana') = 2);

  -- Misma clave en la otra agencia: persona distinta.
  p2 := split_part(pg_temp.alta(5, 'minorista', 'captura_interna', 'CC', '1020304050', null, '[{"campo":"nombres","valor":"Ana Min"}]', null, null), '|', 1);
  insert into t214_ids values ('p2', p2);
  c := pg_temp.alta(6, 'minorista', 'contrato_pasajero', 'CC', '1020304050', null, '[{"campo":"nombres","valor":"Ana N"}]', 'MIN-T214-01', pg_temp.id('cp_t214_n_01'));
  perform pg_temp.esperar('E2b mismo tipo y número en minorista: otra persona (aislamiento por tenant)', p2 <> p1 and c = p2 || '|existente');

  -- E3 provisional: idempotente por id de captura, sin deduplicar entre capturas distintas.
  a := pg_temp.alta(10, 'mayorista', 'captura_interna', null, '123456', null, '[{"campo":"nombres","valor":"Sin tipo"}]', null, null);
  b := pg_temp.alta(10, 'mayorista', 'captura_interna', null, '123456', null, '[{"campo":"nombres","valor":"Sin tipo"}]', null, null);
  c := pg_temp.alta(11, 'mayorista', 'captura_interna', null, '123456', null, '[{"campo":"nombres","valor":"Sin tipo"}]', null, null);
  perform pg_temp.esperar('E3 provisional: creada, reintento con la misma captura, y otra captura = otra ficha',
    a like '%|creada' and b = split_part(a, '|', 1) || '|reintento' and c like '%|creada'
    and split_part(c, '|', 1) <> split_part(a, '|', 1)
    and (select estado_doc || '/' || (clave_alta = pg_temp.captura(10))::text from public.personas where id = split_part(a, '|', 1)::uuid) = 'provisional/true');
  insert into t214_ids values ('prov_a', split_part(a, '|', 1)), ('prov_c', split_part(c, '|', 1));

  -- E4 clave de alta reutilizada con otros originales (estado visible de una carrera K3).
  insert into public.personas (tenant, tipo_doc_original, documento_original, clave_alta)
  values ('mayorista', null, '999999', pg_temp.captura(12));
  antes := pg_temp.conteos();
  c := pg_temp.alta(12, 'mayorista', 'captura_interna', null, '888888', null, '[]', null, null);
  perform pg_temp.esperar('E4 misma clave de alta con otros originales: clave_alta_reutilizada, nada escrito',
    c like 'ERR P0001 clave_alta_reutilizada%' and pg_temp.conteos() = antes);

  -- E5 NIT: estructurado, DV inválido, DV sin NIT, NIT libre y NIT sin DV.
  a := pg_temp.alta(20, 'mayorista', 'captura_interna', 'NIT', '900.123.456', '7', '[{"campo":"nombres","valor":"Empresa SAS"}]', null, null);
  insert into t214_ids values ('p_nit', split_part(a, '|', 1));
  perform pg_temp.esperar('E5a NIT base+DV estructurados: documentada, marca true y observación nit_dv=7 de esa captura',
    a like '%|creada'
    and (select estado_doc || '/' || numero_norm || '/' || nit_dv_estructurado::text from public.personas where id = split_part(a, '|', 1)::uuid) = 'documentada/900123456/true'
    and exists (select 1 from public.persona_observaciones where captura_id = pg_temp.captura(20) and campo = 'nit_dv' and valor = '7'));
  set constraints personas_nit_dv_observado immediate;
  set constraints personas_nit_dv_observado deferred;
  perform pg_temp.esperar('E5b disparador diferido satisfecho al forzarlo (hay observación nit_dv)', true);
  antes := pg_temp.conteos();
  foreach v_dv in array array['K', '77', '', ' ', E'７'] loop
    c := pg_temp.alta(21, 'mayorista', 'captura_interna', 'NIT', '900123456', v_dv, '[]', null, null);
    perform pg_temp.esperar(format('E5c DV %L: nit_dv_invalido antes de escribir', v_dv), c like 'ERR 22023 nit_dv_invalido%');
  end loop;
  c := pg_temp.alta(22, 'mayorista', 'captura_interna', 'CC', '123456', '7', '[]', null, null);
  perform pg_temp.esperar('E5d DV con tipo CC: nit_dv_sin_nit; conteos intactos', c like 'ERR 22023 nit_dv_sin_nit%' and pg_temp.conteos() = antes);
  a := pg_temp.alta(23, 'mayorista', 'captura_interna', 'NIT', '900123456-7', null, '[]', null, null);
  b := pg_temp.alta(24, 'mayorista', 'captura_interna', 'NIT', '900123456', null, '[]', null, null);
  perform pg_temp.esperar('E5e NIT libre y NIT sin DV: fichas aparte en revisión, sin nit_dv y sin tocar la documentada',
    (select estado_doc || '/' || motivo_revision from public.personas where id = split_part(a, '|', 1)::uuid) = 'revision/numero_invalido'
    and (select estado_doc || '/' || motivo_revision from public.personas where id = split_part(b, '|', 1)::uuid) = 'revision/nit_sin_dv_estructurado'
    and split_part(a, '|', 1) <> pg_temp.id('p_nit') and split_part(b, '|', 1) <> pg_temp.id('p_nit')
    and not exists (select 1 from public.persona_observaciones where captura_id in (pg_temp.captura(23), pg_temp.captura(24)) and campo = 'nit_dv')
    and (select count(*) from public.persona_capturas where persona_id = pg_temp.id('p_nit')::uuid) = 1);

  -- E6 divergencia de DV: otra captura con DV 8 agrega una observación, no sobrescribe.
  c := pg_temp.alta(25, 'mayorista', 'captura_interna', 'NIT', '900123456', '8', '[]', null, null);
  perform pg_temp.esperar('E6 segunda captura con DV 8: existente; dos observaciones nit_dv (7 y 8) con su captura',
    c = pg_temp.id('p_nit') || '|existente'
    and (select string_agg(valor, ',' order by valor) from public.persona_observaciones where persona_id = pg_temp.id('p_nit')::uuid and campo = 'nit_dv') = '7,8');

  -- E7 promoción.
  a := pg_temp.alta(30, 'mayorista', 'captura_interna', null, '4444444', null, '[{"campo":"nombres","valor":"Prov A"}]', null, null);
  b := pg_temp.alta(31, 'mayorista', 'captura_interna', '', '4444444', null, '[{"campo":"nombres","valor":"Prov B"}]', null, null);
  insert into t214_ids values ('pp_a', split_part(a, '|', 1)), ('pp_b', split_part(b, '|', 1));
  c := pg_temp.promover(pg_temp.id('pp_a'), 32, 'CC', '4444444', null, '[{"campo":"apellidos","valor":"Promovida"}]');
  perform pg_temp.esperar('E7a promover provisional a CC 4444444: promovida y generadas recalculadas',
    c = pg_temp.id('pp_a') || '|promovida'
    and (select estado_doc || '/' || tipo_doc || '/' || numero_norm from public.personas where id = pg_temp.id('pp_a')::uuid) = 'documentada/CC/4444444');
  perform pg_temp.esperar('E7b la captura original conserva lo que afirmó (sin tipo); la nueva queda registrada',
    (select coalesce(tipo_doc_capturado, '(nulo)') from public.persona_capturas where id = pg_temp.captura(30)) = '(nulo)'
    and exists (select 1 from public.persona_capturas where id = pg_temp.captura(32) and persona_id = pg_temp.id('pp_a')::uuid));
  antes := (select to_jsonb(p) - 'updated_at' from public.personas p where id = pg_temp.id('pp_b')::uuid)::text
           || '#' || (select count(*) from public.persona_capturas where persona_id = pg_temp.id('pp_b')::uuid)
           || '#' || (select count(*) from public.persona_observaciones where persona_id = pg_temp.id('pp_b')::uuid);
  c := pg_temp.promover(pg_temp.id('pp_b'), 33, 'CC', '4.444.444', null, '[]');
  perform pg_temp.esperar('E7c promover OTRA ficha a la misma clave: conflicto con el id ganador; la ficha queda intacta',
    c = pg_temp.id('pp_a') || '|conflicto'
    and antes = (select to_jsonb(p) - 'updated_at' from public.personas p where id = pg_temp.id('pp_b')::uuid)::text
               || '#' || (select count(*) from public.persona_capturas where persona_id = pg_temp.id('pp_b')::uuid)
               || '#' || (select count(*) from public.persona_observaciones where persona_id = pg_temp.id('pp_b')::uuid)
    and not exists (select 1 from public.persona_capturas where id = pg_temp.captura(33)));
  c := pg_temp.promover(pg_temp.id('pp_a'), 34, 'CC', '4444444', null, '[]');
  d := pg_temp.promover(pg_temp.id('pp_a'), 35, 'CC', '5555000', null, '[]');
  perform pg_temp.esperar('E7d ya documentada con la misma clave / con otra: ya_documentada / clave_distinta',
    c = pg_temp.id('pp_a') || '|ya_documentada' and d = pg_temp.id('pp_a') || '|clave_distinta');
  c := pg_temp.promover(pg_temp.id('pp_b'), 36, 'CC', '12', null, '[]');
  perform pg_temp.esperar('E7e destino no documentable: 22023 destino_no_documentable', c like 'ERR 22023 destino_no_documentable%');
  c := pg_temp.promover(pg_temp.id('pp_a'), 32, 'CC', '4444444', null, '[{"campo":"apellidos","valor":"Promovida"}]');
  perform pg_temp.esperar('E7f reintento de la misma promoción (misma captura): reintento', c = pg_temp.id('pp_a') || '|reintento');

  -- E8 entradas inválidas: error explícito y nada escrito.
  antes := pg_temp.conteos();
  perform pg_temp.esperar('E8a campo nit_dv en observaciones', pg_temp.alta(40, 'mayorista', 'captura_interna', 'CC', '7654321', null, '[{"campo":"nit_dv","valor":"7"}]', null, null) like 'ERR 22023 observaciones_invalidas%');
  perform pg_temp.esperar('E8b campo desconocido', pg_temp.alta(40, 'mayorista', 'captura_interna', 'CC', '7654321', null, '[{"campo":"foto","valor":"x"}]', null, null) like 'ERR 22023 observaciones_invalidas%');
  perform pg_temp.esperar('E8c valor vacío', pg_temp.alta(40, 'mayorista', 'captura_interna', 'CC', '7654321', null, '[{"campo":"nombres","valor":""}]', null, null) like 'ERR 22023 observaciones_invalidas%');
  perform pg_temp.esperar('E8d valor de 201', pg_temp.alta(40, 'mayorista', 'captura_interna', 'CC', '7654321', null, jsonb_build_array(jsonb_build_object('campo', 'nombres', 'valor', repeat('x', 201))), null, null) like 'ERR 22023 observaciones_invalidas%');
  perform pg_temp.esperar('E8e observaciones que no son arreglo', pg_temp.alta(40, 'mayorista', 'captura_interna', 'CC', '7654321', null, '{"campo":"nombres"}', null, null) like 'ERR 22023 observaciones_invalidas%');
  perform pg_temp.esperar('E8f tenant inválido', pg_temp.alta(40, 'otro', 'captura_interna', 'CC', '7654321', null, '[]', null, null) like 'ERR 22023 tenant_invalido%');
  perform pg_temp.esperar('E8g fuente de #42 aún inexistente', pg_temp.alta(40, 'mayorista', 'cotizacion', 'CC', '7654321', null, '[]', null, null) like 'ERR 22023 fuente_invalida%');
  perform pg_temp.esperar('E8h captura interna con contrato', pg_temp.alta(40, 'mayorista', 'captura_interna', 'CC', '7654321', null, '[]', 'DTM-92141', null) like 'ERR 22023 origen_invalido%');
  perform pg_temp.esperar('E8i contrato_pasajero sin pasajero', pg_temp.alta(40, 'mayorista', 'contrato_pasajero', 'CC', '7654321', null, '[]', 'DTM-92141', null) like 'ERR 22023 origen_invalido%');
  perform pg_temp.esperar('E8j original de 65 puntos de código', pg_temp.alta(40, 'mayorista', 'captura_interna', 'CC', repeat('1', 65), null, '[]', null, null) like 'ERR 22023 original_demasiado_largo%');
  perform pg_temp.esperar('E8k pasajero que no es del contrato', pg_temp.alta(40, 'mayorista', 'contrato_pasajero', 'CC', '7654321', null, '[]', 'DTM-92141', pg_temp.id('cp_t214_m_02')) like 'ERR 23514%');
  perform pg_temp.esperar('E8l contrato de la otra agencia', pg_temp.alta(40, 'mayorista', 'contrato_pasajero', 'CC', '7654321', null, '[]', 'MIN-T214-01', pg_temp.id('cp_t214_n_01')) like 'ERR 23514%');
  perform pg_temp.esperar('E8m conteos intactos tras los 12 rechazos: ' || antes, pg_temp.conteos() = antes);
  begin
    perform p214_priv.upsert_persona(null, 'mayorista', 'captura_interna', 'CC', '7654321');
    perform pg_temp.esperar('E8n captura nula', false);
  exception when others then
    perform pg_temp.esperar('E8n captura nula: captura_id_obligatorio', sqlerrm = 'captura_id_obligatorio');
  end;
end $$;

-- Datos de visibilidad que faltan: persona solo visible por contrato ajeno, y paginación.
do $$
declare
  i integer;
  a text;
begin
  a := pg_temp.alta(50, 'mayorista', 'contrato_pasajero', 'CC', '5555555', null, '[{"campo":"nombres","valor":"Solo Colega"}]', 'DTM-92142', pg_temp.id('cp_t214_m_02'));
  insert into t214_ids values ('p_colega', split_part(a, '|', 1));
  for i in 1..60 loop
    perform pg_temp.alta(100 + i, 'mayorista', 'captura_interna', 'CC', '7777777', null,
                         jsonb_build_array(jsonb_build_object('campo', 'nombres', 'valor', 'Nombre ' || lpad(i::text, 2, '0'))), null, null);
  end loop;
  for i in 1..10 loop
    perform pg_temp.alta(200 + i, 'mayorista', 'contrato_pasajero', 'CC', '7777777', null,
                         jsonb_build_array(jsonb_build_object('campo', 'nombres', 'valor', 'AJENO ' || lpad(i::text, 2, '0'))), 'DTM-92142', pg_temp.id('cp_t214_m_02'));
  end loop;
  perform pg_temp.esperar('Datos de paginación: 70 capturas sobre CC 7777777',
    (select count(*) from public.persona_capturas c join public.personas p on p.id = c.persona_id where p.numero_norm = '7777777') = 70);
end $$;

-- ═══ I · Integridad: la base rechaza los estados inválidos (escritura directa) ═════════════
do $$
declare
  p1 uuid := pg_temp.id('p1')::uuid;
  pp uuid := pg_temp.id('prov_a')::uuid;
  k uuid := pg_temp.captura(1);
  e text;
begin
  begin insert into public.persona_capturas (id, persona_id, tenant, fuente, nivel, contrato_pasajero_id)
        values (gen_random_uuid(), p1, 'mayorista', 'contrato_pasajero', 'pasajero_contrato', 5); e := 'ok';
  exception when others then e := sqlstate; end;
  -- Lo rechaza primero el disparador BEFORE (sin número no hay pasajero que validar); el CHECK
  -- nulo-seguro lo respalda si el disparador faltara.
  perform pg_temp.esperar('I1 contrato_pasajero sin contrato_numero: 23514', e = '23514');
  begin insert into public.persona_capturas (id, persona_id, tenant, fuente, nivel, contrato_numero, contrato_pasajero_id)
        values (gen_random_uuid(), p1, 'mayorista', 'contrato_pasajero', null, 'DTM-92141', pg_temp.id('cp_t214_m_01')::bigint); e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I2 nivel NULL: 23502', e = '23502');
  begin insert into public.persona_capturas (id, persona_id, tenant, fuente, nivel)
        values (gen_random_uuid(), p1, 'mayorista', null, 'comercial'); e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I3 fuente NULL: 23502', e = '23502');
  begin insert into public.persona_capturas (id, persona_id, tenant, fuente, nivel, contrato_numero, contrato_pasajero_id)
        values (gen_random_uuid(), p1, 'mayorista', 'captura_interna', 'comercial', 'DTM-92141', 5); e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I4 captura interna con contrato: 23514', e = '23514');
  begin insert into public.persona_capturas (id, persona_id, tenant, fuente, nivel)
        values (gen_random_uuid(), p1, 'mayorista', 'captura_interna', 'pasajero_contrato'); e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I5 nivel incoherente con la fuente: 23514', e = '23514');
  begin insert into public.persona_capturas (id, persona_id, tenant, fuente, nivel)
        values (gen_random_uuid(), p1, 'minorista', 'captura_interna', 'comercial'); e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I6 captura con otro tenant que su persona: 23503', e = '23503');
  begin insert into public.persona_observaciones (captura_id, persona_id, tenant, campo, valor) values (k, p1, 'mayorista', null, 'x'); e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I7 observación con campo NULL: 23502', e = '23502');
  begin insert into public.persona_observaciones (captura_id, persona_id, tenant, campo, valor) values (k, p1, 'mayorista', 'nombres', null); e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I8 observación con valor NULL: 23502', e = '23502');
  begin insert into public.persona_observaciones (captura_id, persona_id, tenant, campo, valor) values (k, p1, 'mayorista', 'nit_dv', 'X'); e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I9a nit_dv que no es dígito: 23514', e = '23514');
  begin insert into public.persona_observaciones (captura_id, persona_id, tenant, campo, valor) values (k, p1, 'mayorista', 'nit_dv', E'７'); e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I9b nit_dv de ancho completo: 23514', e = '23514');
  begin insert into public.persona_observaciones (captura_id, persona_id, tenant, campo, valor) values (k, pp, 'mayorista', 'nombres', 'x'); e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I10 observación sobre la captura de otra persona: 23503', e = '23503');
  begin insert into public.persona_observaciones (captura_id, persona_id, tenant, campo, valor) values (k, p1, 'minorista', 'nombres', 'x'); e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I11 observación con otro tenant que su captura: 23503', e = '23503');
  begin insert into public.persona_capturas (id, persona_id, tenant, fuente, nivel) values (k, pp, 'mayorista', 'captura_interna', 'comercial'); e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I15 id de captura reutilizado para otra persona: 23505', e = '23505');
  begin insert into public.personas (tenant, tipo_doc_original, documento_original, nit_dv_estructurado) values ('mayorista', 'CC', '31313131', true); e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I16 marca NIT con tipo CC (CHECK sobre la generada): 23514', e = '23514');
  begin
    insert into public.personas (tenant, tipo_doc_original, documento_original, nit_dv_estructurado) values ('mayorista', 'NIT', '811222333', true);
    set constraints personas_nit_dv_observado immediate;
    e := 'ok';
  exception when others then e := sqlstate; end;
  set constraints personas_nit_dv_observado deferred;
  perform pg_temp.esperar('I17 marca NIT sin observación nit_dv al confirmar (disparador diferido): 23514', e = '23514');
  begin insert into public.personas (tenant, tipo_doc_original, documento_original) values ('mayorista', 'CC', repeat('1', 65)); e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I18 original de 65 caracteres: 23514', e = '23514');
  begin update public.personas set tenant = 'minorista' where id = p1; e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I19 cambiar el tenant de una persona: 23514', e = '23514');
  begin update public.personas set documento_original = '1020304051' where id = p1; e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I20 cambiar la clave de una documentada: 23514', e = '23514');
  begin delete from public.personas where id = pp; e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I21 borrar una persona: 23514 (sin borrado; ni el dueño)', e = '23514');
  begin update public.persona_capturas set actor_rol = 'x' where id = k; e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I22 editar una captura: 23514 (append-only)', e = '23514');
  begin delete from public.persona_observaciones where captura_id = k; e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I23 borrar observaciones: 23514 (append-only)', e = '23514');
  begin truncate public.persona_observaciones; e := 'ok';
  exception when others then e := sqlstate; end;
  perform pg_temp.esperar('I24 TRUNCATE de observaciones: 23514', e = '23514');
end $$;

-- ═══ A · Permisos por llamada directa (lógica de autorización) ════════════════════════════
do $$
declare
  e text;
  t text;
begin
  foreach t in array array['personas', 'persona_capturas', 'persona_observaciones'] loop
    set local role anon;
    begin execute format('select count(*) from public.%I', t); e := 'ok'; exception when others then e := sqlstate; end;
    reset role;
    perform pg_temp.esperar(format('A1 anon SELECT %s: 42501', t), e = '42501');
    set local role anon;
    begin execute format('delete from public.%I', t); e := 'ok'; exception when others then e := sqlstate; end;
    reset role;
    perform pg_temp.esperar(format('A2 anon DELETE %s: 42501', t), e = '42501');
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('u_ad'), 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin execute format('select count(*) from public.%I', t); e := 'ok'; exception when others then e := sqlstate; end;
    reset role;
    perform pg_temp.esperar(format('A3 authenticated (administración) SELECT %s: 42501', t), e = '42501');
    set local role authenticated;
    begin execute format('update public.%I set tenant = tenant', t); e := 'ok'; exception when others then e := sqlstate; end;
    reset role;
    perform pg_temp.esperar(format('A4 authenticated UPDATE %s: 42501', t), e = '42501');
  end loop;
  set local role authenticated;
  begin insert into public.personas (tenant, tipo_doc_original, documento_original) values ('mayorista', 'CC', '1212121'); e := 'ok';
  exception when others then e := sqlstate; end;
  reset role;
  perform pg_temp.esperar('A5 authenticated INSERT personas: 42501', e = '42501');
  set local role authenticated;
  begin perform p214_priv.norm_documento('CC', '123', false, 'alta'); e := 'ok'; exception when others then e := sqlstate; end;
  reset role;
  perform pg_temp.esperar('A6 authenticated no ejecuta p214_priv (sin USAGE): 42501', e = '42501');
  set local role authenticated;
  begin perform p214_priv.upsert_persona(gen_random_uuid(), 'mayorista', 'captura_interna', 'CC', '1212121'); e := 'ok';
  exception when others then e := sqlstate; end;
  reset role;
  perform pg_temp.esperar('A7 authenticated no ejecuta el escritor: 42501', e = '42501');
  set local role anon;
  begin perform public.buscar_personas_documento('mayorista', 'CC', '1020304050'); e := 'ok'; exception when others then e := sqlstate; end;
  reset role;
  perform pg_temp.esperar('A8 anon no ejecuta la consulta: 42501', e = '42501');
  set local role service_role;
  begin perform public.buscar_personas_documento('mayorista', 'CC', '1020304050'); e := 'ok'; exception when others then e := sqlstate; end;
  reset role;
  perform pg_temp.esperar('A9 service_role no ejecuta la consulta: 42501', e = '42501');
  set local role service_role;
  begin delete from public.personas where false; e := 'ok'; exception when others then e := sqlstate; end;
  reset role;
  perform pg_temp.esperar('A10 service_role sin DELETE en personas: 42501', e = '42501');
  set local role service_role;
  begin truncate public.persona_capturas; e := 'ok'; exception when others then e := sqlstate; end;
  reset role;
  perform pg_temp.esperar('A11 service_role sin TRUNCATE: 42501', e = '42501');
  set local role service_role;
  begin update public.persona_observaciones set valor = valor where false; e := 'ok'; exception when others then e := sqlstate; end;
  reset role;
  perform pg_temp.esperar('A12 service_role sin UPDATE en observaciones: 42501', e = '42501');
  set local role service_role;
  begin execute 'select count(*) from public.personas'; e := 'ok'; exception when others then e := sqlstate; end;
  reset role;
  perform pg_temp.esperar('A13 service_role sí lee personas (escritor de #42)', e = 'ok');
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- ═══ R · Consulta por rol y tenant (lógica de autorización vía claims) ═════════════════════
do $$
declare
  r jsonb;
  vacio jsonb := pg_temp.vacio();
  u text;
begin
  r := pg_temp.buscar('u_va', null, 'CC', '1020304050');
  perform pg_temp.esperar('R1 venta (asesora de DTM-92141): comercial + su contrato; total 6 y nada del colega',
    (r ->> 'total')::int = 6
    and r::text like '%Ana Maria%' and r::text not like '%XX-AJENA%' and r::text not like '%1991-02-02%'
    and r::text like '%DTM-92141%' and r::text not like '%DTM-92142%'
    and not exists (select 1 from jsonb_array_elements(r -> 'observaciones') o where o.value ->> 'actor_rol' is not null));
  r := pg_temp.buscar('u_vl', null, 'CC', '1020304050');
  perform pg_temp.esperar('R2 venta sin contratos de esa persona: solo capturas internas (total 4)',
    (r ->> 'total')::int = 4 and r::text not like '%Ana Maria%' and r::text not like '%XX-AJENA%');
  foreach u in array array['u_ad', 'u_op'] loop
    r := pg_temp.buscar(u, null, 'CC', '1.020.304.050');
    perform pg_temp.esperar(format('R3 %s: todas las capturas de su tenant (total 8), con actor_rol', u),
      (r ->> 'total')::int = 8 and r::text like '%XX-AJENA%'
      and exists (select 1 from jsonb_array_elements(r -> 'observaciones') o where o.value ->> 'actor_rol' = 'operaciones'));
  end loop;
  r := pg_temp.buscar('u_ad', 'minorista', 'CC', '1020304050');
  perform pg_temp.esperar('R4 administración de mayorista pidiendo minorista: vacío idéntico', r = vacio);
  r := pg_temp.buscar('u_am', null, 'CC', '1020304050');
  perform pg_temp.esperar('R5 administración de minorista: su persona (total 2), sin datos de mayorista',
    (r ->> 'total')::int = 2 and r -> 'persona' ->> 'tenant' = 'minorista' and r::text not like '%Ana Maria%');
  r := pg_temp.buscar('u_vm', null, 'CC', '1020304050');
  perform pg_temp.esperar('R6 venta de minorista asesor de MIN-T214-01: total 2',
    (r ->> 'total')::int = 2 and r::text like '%Ana N%');
  foreach u in array array['u_ge', 'u_sa'] loop
    r := pg_temp.buscar(u, 'mayorista', 'CC', '1020304050');
    perform pg_temp.esperar(format('R7 %s con p_tenant mayorista: total 8', u), (r ->> 'total')::int = 8 and r -> 'persona' ->> 'tenant' = 'mayorista');
    r := pg_temp.buscar(u, 'minorista', 'CC', '1020304050');
    perform pg_temp.esperar(format('R8 %s con p_tenant minorista: total 2', u), (r ->> 'total')::int = 2 and r -> 'persona' ->> 'tenant' = 'minorista');
    r := pg_temp.buscar(u, null, 'CC', '1020304050');
    perform pg_temp.esperar(format('R9 %s sin p_tenant: vacío (no hay "ambos a la vez")', u), r = vacio);
  end loop;
  foreach u in array array['u_ag', 'u_cv', 'u_in', 'u_nf'] loop
    r := pg_temp.buscar(u, null, 'CC', '1020304050');
    perform pg_temp.esperar(format('R10 %s (B2B / control_vuelo / inactivo / sin fila): vacío idéntico', u), r = vacio);
    r := pg_temp.buscar(u, null, 'CC2', '1020304050');
    perform pg_temp.esperar(format('R11 %s con formato inválido: vacío idéntico (sin error)', u), r = vacio);
  end loop;
  r := pg_temp.buscar('u_ad', null, 'CC2', '1020304050');
  perform pg_temp.esperar('R12 administración con tipo inválido: formato_no_admitido', r = vacio || jsonb_build_object('error', 'formato_no_admitido'));
  r := pg_temp.buscar('u_ad', null, 'CC', '1234-5');
  perform pg_temp.esperar('R13 administración con número inválido: formato_no_admitido', r ->> 'error' = 'formato_no_admitido');
  r := pg_temp.buscar('u_ad', null, '', '1020304050');
  perform pg_temp.esperar('R14 sin tipo: el número solo no confirma nada', r ->> 'error' = 'formato_no_admitido');
  r := pg_temp.buscar('u_ad', null, 'CC', '9999999999');
  perform pg_temp.esperar('R15 clave inexistente: vacío', r = vacio);
  r := pg_temp.buscar('u_va', null, 'CC', '5555555');
  perform pg_temp.esperar('R16 venta ante una persona cuyas capturas son todas de un colega: IDÉNTICO a no existe',
    r = pg_temp.buscar('u_va', null, 'CC', '9999999999') and r = vacio);
  r := pg_temp.buscar('u_ad', null, 'CC', '5555555');
  perform pg_temp.esperar('R17 administración sí la ve (total 1)', (r ->> 'total')::int = 1);
  r := pg_temp.buscar('u_va', null, 'CC', '123456');
  perform pg_temp.esperar('R18 fichas provisionales nunca aparecen', r = vacio);
  r := pg_temp.buscar('u_ad', null, 'NIT', '900.123.456');
  perform pg_temp.esperar('R19 NIT por base sin DV: divergencia de DV (7 y 8) en variantes',
    (r ->> 'divergencia')::boolean
    and exists (select 1 from jsonb_array_elements(r -> 'variantes') v
                 where v.value ->> 'campo' = 'nit_dv' and (v.value ->> 'n_valores')::int = 2
                   and (v.value ->> 'divergencia')::boolean));
  r := pg_temp.buscar('u_ad', null, 'NIT', '900123456-7');
  perform pg_temp.esperar('R20 NIT con guion en la consulta: formato_no_admitido (no se recorta)', r ->> 'error' = 'formato_no_admitido');
  r := pg_temp.buscar('u_ad', null, 'NIT', '9001234567');
  perform pg_temp.esperar('R21 NIT de 10 dígitos se busca tal cual: no encuentra la base de 9', r = vacio);
  r := pg_temp.buscar('u_ad', null, 'CC', '1020304050', 51, 0);
  perform pg_temp.esperar('R22 p_limite 51: 22023 limite_invalido', r ->> 'sqlstate' = '22023' and r ->> 'mensaje' = 'limite_invalido');
  r := pg_temp.buscar('u_ad', null, 'CC', '1020304050', 0, 0);
  perform pg_temp.esperar('R23 p_limite 0: 22023', r ->> 'sqlstate' = '22023');
  r := pg_temp.buscar('u_ad', null, 'CC', '1020304050', null, 0);
  perform pg_temp.esperar('R24 p_limite nulo: 22023', r ->> 'sqlstate' = '22023');
  r := pg_temp.buscar('u_ad', null, 'CC', '1020304050', 20, -1);
  perform pg_temp.esperar('R25 p_offset -1: 22023 offset_invalido', r ->> 'sqlstate' = '22023' and r ->> 'mensaje' = 'offset_invalido');
  r := pg_temp.buscar('u_ag', null, 'CC', '1020304050', 51, 0);
  perform pg_temp.esperar('R26 el error de parámetro no depende del actor ni de los datos (B2B también recibe 22023)', r ->> 'sqlstate' = '22023');
end $$;

-- ═══ P · Paginación y variantes acotadas con más de 50 valores autorizados ═════════════════
do $$
declare
  r jsonb;
  r2 jsonb;
  v jsonb;
begin
  r := pg_temp.buscar('u_va', null, 'CC', '7777777', 50, 0);
  v := (select x.value from jsonb_array_elements(r -> 'variantes') x where x.value ->> 'campo' = 'nombres');
  perform pg_temp.esperar('P1 venta: 60 autorizadas; página de 50; has_more; total sobre todo A',
    (r ->> 'total')::int = 60 and jsonb_array_length(r -> 'observaciones') = 50 and (r ->> 'has_more')::boolean);
  perform pg_temp.esperar('P2 variantes acotadas: n_valores 60, solo 10 valores detallados, 50 omitidos, divergencia',
    (v ->> 'n_valores')::int = 60 and jsonb_array_length(v -> 'valores') = 10 and (v ->> 'valores_omitidos')::int = 50
    and (v ->> 'divergencia')::boolean and (r ->> 'divergencia')::boolean);
  perform pg_temp.esperar('P3 ninguna observación ajena en la respuesta (ni en página ni en variantes)',
    r::text not like '%AJENO%' and r::text not like '%DTM-92142%');
  r2 := pg_temp.buscar('u_va', null, 'CC', '7777777', 50, 50);
  perform pg_temp.esperar('P4 página 2: 10 filas, has_more false, misma variante, nada ajeno',
    jsonb_array_length(r2 -> 'observaciones') = 10 and not (r2 ->> 'has_more')::boolean
    and (r2 ->> 'total')::int = 60 and r2 -> 'variantes' = r -> 'variantes' and r2::text not like '%AJENO%');
  perform pg_temp.esperar('P5 las dos páginas no se solapan y cubren las 60',
    (select count(distinct o ->> 'captura_id') from (select jsonb_array_elements(r -> 'observaciones') o
                                                     union all select jsonb_array_elements(r2 -> 'observaciones')) s) = 60);
  r := pg_temp.buscar('u_ad', null, 'CC', '7777777', 50, 0);
  v := (select x.value from jsonb_array_elements(r -> 'variantes') x where x.value ->> 'campo' = 'nombres');
  perform pg_temp.esperar('P6 administración: 70 autorizadas, 10 detalladas, 60 omitidas',
    (r ->> 'total')::int = 70 and jsonb_array_length(r -> 'observaciones') = 50
    and (v ->> 'n_valores')::int = 70 and jsonb_array_length(v -> 'valores') = 10 and (v ->> 'valores_omitidos')::int = 60);
  perform pg_temp.esperar('P7 tamaño acotado: < 64 KiB con 70 observaciones autorizadas', octet_length(r::text) < 65536);
  r := pg_temp.buscar('u_va', null, 'CC', '7777777', 50, 500);
  perform pg_temp.esperar('P8 desplazamiento más allá del total: página vacía, total intacto, has_more false',
    jsonb_array_length(r -> 'observaciones') = 0 and (r ->> 'total')::int = 60 and not (r ->> 'has_more')::boolean);
end $$;

-- ═══ S · search_path hostil: objetos homónimos no alteran la consulta ═══════════════════════
do $$
declare
  r jsonb;
  v_sp text := current_setting('search_path');
begin
  create schema t214_hostil;
  create table t214_hostil.usuarios (id uuid, rol text, tenant text, activo boolean);
  insert into t214_hostil.usuarios values (pg_temp.id('u_ag')::uuid, 'superadmin', 'mayorista', true);
  create table t214_hostil.ventas (numero_contrato text, tenant text, asesor text);
  grant usage on schema t214_hostil to authenticated;
  grant select on all tables in schema t214_hostil to authenticated;
  perform set_config('search_path', 't214_hostil, public', true);
  r := pg_temp.buscar('u_ag', 'mayorista', 'CC', '1020304050');
  perform set_config('search_path', v_sp, true);
  perform pg_temp.esperar('S1 tablas homónimas en el search_path del llamador: B2B sigue en vacío', r = pg_temp.vacio());
end $$;

-- ═══ R28 · Contrato renumerado después de la captura (función real de la 115) ══════════════
-- Datos propios (contrato y documento dedicados) para no mover los conteos de otras pruebas. La
-- renumeración mueve las hijas con FK (contrato_pasajeros); la captura guarda el número sin FK y
-- deja de corresponder a una fila de ventas: oculta para todos, superadmin incluido.
do $$
declare
  r jsonb;
  u text;
  a text;
begin
  insert into public.ventas (numero_contrato, cliente, asesor, tenant) values ('DTM-92145', 'Cliente prueba', 'Ana Ruiz', 'mayorista');
  with i as (insert into public.contrato_pasajeros (numero_contrato, nombre) values ('DTM-92145', 'Pasajero renumerado') returning id)
  insert into t214_ids select 'cp_renum', id::text from i;
  a := pg_temp.alta(401, 'mayorista', 'contrato_pasajero', 'CC', '4141414', null, '[{"campo":"nombres","valor":"Renumerada"}]',
                    'DTM-92145', pg_temp.id('cp_renum'));
  perform pg_temp.esperar('R28a captura ligada a DTM-92145: ' || split_part(a, '|', 2), a like '%|creada');
  r := pg_temp.buscar('u_va', null, 'CC', '4141414');
  perform pg_temp.esperar('R28b antes: la asesora la ve', (r ->> 'total')::int = 1);
  r := pg_temp.buscar('u_sa', 'mayorista', 'CC', '4141414');
  perform pg_temp.esperar('R28c antes: superadmin la ve', (r ->> 'total')::int = 1);

  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('u_sa'), 'role', 'authenticated')::text, true);
  perform public.fn_renumerar_contrato('DTM-92145', 'DTM-92146');
  perform set_config('request.jwt.claims', '{}', true);
  perform pg_temp.esperar('R28d fn_renumerar_contrato movió el pasajero (FK) y no tocó la captura (sin FK)',
    (select numero_contrato from public.contrato_pasajeros where id = pg_temp.id('cp_renum')::bigint) = 'DTM-92146'
    and (select contrato_numero from public.persona_capturas where id = pg_temp.captura(401)) = 'DTM-92145'
    and not exists (select 1 from public.ventas where numero_contrato = 'DTM-92145'));
  foreach u in array array['u_va', 'u_ad', 'u_sa'] loop
    r := pg_temp.buscar(u, case when u = 'u_sa' then 'mayorista' end, 'CC', '4141414');
    perform pg_temp.esperar('R28e después: ' || u || ' recibe el vacío idéntico (la captura ya no corresponde a un contrato)',
      r = pg_temp.vacio());
  end loop;
end $$;

-- ═══ V3 · Número de contrato repetido entre agencias (defensa en profundidad) ══════════════
do $$
declare
  e text;
  r jsonb;
  vieja boolean;
begin
  begin
    insert into public.ventas (numero_contrato, cliente, asesor, tenant) values ('DTM-92141', 'Dup', 'Luis Mora', 'minorista');
    e := 'ok';
  exception when others then e := sqlstate; end;
  -- Hoy lo impiden dos candados: el formato por agencia de la 160 (23514, se evalúa antes) y la
  -- PK global (23505). La prueba los retira a ambos para simular el futuro que 1.3.1 contempla.
  perform pg_temp.esperar('V3a hoy un número repetido entre agencias es imposible (formato 160 / PK global): ' || e,
    e in ('23514', '23505'));

  alter table public.ventas drop constraint ventas_numero_contrato_formato_por_tenant;
  alter table public.ventas drop constraint ventas_pkey cascade;
  insert into public.ventas (numero_contrato, cliente, asesor, tenant) values
    ('DTM-92149', 'Dup', 'Ana Ruiz', 'mayorista'),
    ('DTM-92149', 'Dup', 'Luis Mora', 'minorista');
  with i as (insert into public.contrato_pasajeros (numero_contrato, nombre) values ('DTM-92149', 'Pasajero dup') returning id)
  insert into t214_ids select 'cp_dup', id::text from i;
  perform pg_temp.esperar('V3b captura pasajero_contrato de mayorista ligada a DTM-92149',
    pg_temp.alta(300, 'mayorista', 'contrato_pasajero', 'CC', '6666666', null, '[{"campo":"nombres","valor":"Dup Ana"}]', 'DTM-92149', pg_temp.id('cp_dup')) like '%|creada');

  -- El patrón de la v2 (EXISTS por tenant + soy_asesor_del_contrato aparte) filtraría: el EXISTS
  -- se evalúa como lo haría la función privilegiada (sin RLS) y el asesor con el actor de la sesión.
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('u_vl'), 'role', 'authenticated')::text, true);
  vieja := exists (select 1 from public.ventas v where v.numero_contrato = 'DTM-92149' and v.tenant = 'mayorista')
           and public.soy_asesor_del_contrato('DTM-92149');
  perform set_config('request.jwt.claims', '{}', true);
  perform pg_temp.esperar('V3c con el número repetido, soy_asesor_del_contrato da true al homónimo de la otra agencia (la fuga que evita 1.3.1)', vieja);

  r := pg_temp.buscar('u_vl', null, 'CC', '6666666');
  perform pg_temp.esperar('V3d venta mayorista homónimo del asesor minorista: NO la ve (vacío idéntico)', r = pg_temp.vacio());
  r := pg_temp.buscar('u_va', null, 'CC', '6666666');
  perform pg_temp.esperar('V3e la asesora real (misma fila, mismo tenant) sí la ve', (r ->> 'total')::int = 1 and r::text like '%Dup Ana%');
  r := pg_temp.buscar('u_vm', null, 'CC', '6666666');
  perform pg_temp.esperar('V3f venta minorista homónimo: no la ve (otro tenant)', r = pg_temp.vacio());

  -- Contrato eliminado después de la captura: la observación queda oculta para todos.
  delete from public.contrato_pasajeros where numero_contrato = 'DTM-92141';
  delete from public.ventas where numero_contrato = 'DTM-92141';
  r := pg_temp.buscar('u_ad', null, 'CC', '1020304050');
  perform pg_temp.esperar('R27 contrato eliminado: su captura se oculta para todos (total 8 -> 6)',
    (r ->> 'total')::int = 6 and r::text not like '%Ana Maria%');
  r := pg_temp.buscar('u_sa', 'mayorista', 'CC', '1020304050');
  perform pg_temp.esperar('R27b también para superadmin (total 6, sin la captura del contrato eliminado)',
    (r ->> 'total')::int = 6 and r::text not like '%Ana Maria%');
end $$;

\echo 'TEST 214 SQL: TODO OK'
rollback;
