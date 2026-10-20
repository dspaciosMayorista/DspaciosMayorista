-- ═════════════════════════════════════════════════════════════════════════
-- PRUEBA SQL 219 · personas de cotizaciones en el CRM (#42), sobre la migración REAL.
-- SOLO base desechable (CI). Corre en UNA transacción y termina en ROLLBACK.
--
--   psql -v ON_ERROR_STOP=1 -f test_219_personas_cotizaciones.sql <base>   (desde supabase/scripts: usa \ir)
--
-- Requiere la cadena integrada hasta la 217 (frontera de #39 ACTIVA) más la 219 aplicada. Reutiliza
-- SOLO COMO LECTURA los fixtures de la 216 (usuarios, manual por la RPC real, pago y conversión).
-- Grupos: E alta/reintento · T titular · S sello · I integridad · V visibilidad (dos lecturas)
-- · G regresiones (198, 211, 214, promover) · O orígenes.
-- Límite: el actor se fija con request.jwt.claims en una sesión psql que ya puede hacer SET ROLE;
-- prueba la LÓGICA de autorización, no la autenticación (eso lo hace el bloque H con PostgREST).
-- ═════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;

\ir test_216_fixtures.sql

do $$
begin
  if not p39_priv.frontera_activa() then
    raise exception 'test_219 exige la 216 y la 217 aplicadas (frontera activa).';
  end if;
  if to_regclass('public.cotizacion_participantes') is null then
    raise exception 'test_219 exige la 219 aplicada.';
  end if;
end $$;

create schema t219;
create table t219.ids (k text primary key, v text not null);

-- Usuarios propios (además de los de t216): dos agencias del MISMO aliado, un freelance de otro y
-- una agencia minorista.
create function t219.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000219' || case p_k
    when 'ag1' then '001' when 'ag2' then '002' when 'fl' then '003' when 'agMin' then '004' else '999' end)::uuid
$$;
do $$
declare v_aliado_a bigint; v_aliado_b bigint;
begin
  insert into public.aliados (nombre) values ('Aliado 219 A') returning id into v_aliado_a;
  insert into public.aliados (nombre) values ('Aliado 219 B') returning id into v_aliado_b;
  insert into auth.users (id, email)
  select t219.u(k), 'c219-' || k || '@x.test' from unnest(array['ag1', 'ag2', 'fl', 'agMin']) k
  on conflict do nothing;
  insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id)
  select t219.u(k), 'c219-' || k || '@x.test', 'C219 ' || k, r::rol_usuario, true, t, a
    from (values ('ag1', 'agencia', 'mayorista', v_aliado_a), ('ag2', 'agencia', 'mayorista', v_aliado_a),
                 ('fl', 'freelance', 'mayorista', v_aliado_b), ('agMin', 'agencia', 'minorista', null::bigint)) v(k, r, t, a)
  on conflict (id) do update set email = excluded.email, nombre = excluded.nombre, rol = excluded.rol,
                                 activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id;
end $$;

-- Cotización insertada por el dueño de la base (como la deja el INSERT service_role de la app, más
-- el sello si se indica).
create function t219.cot(p_tipo text, p_tenant text, p_creador uuid, p_payload jsonb,
                         p_creado_por text default null) returns bigint
language plpgsql as $$
declare v bigint;
begin
  insert into public.cotizaciones (tenant, tipo, estado, payload, detalle, cliente, cliente_documento, modulo, pax,
                                   precio_venta, moneda, vigencia_hasta, creado_por, creado_por_id)
  values (p_tenant, p_tipo, 'abierta', p_payload, jsonb_build_object('venta', jsonb_build_object('cliente', 'C219')),
          'C219', null, p_tipo, 2, 1000, 'COP', public.fecha_negocio() + 5, p_creado_por, p_creador)
  returning id into v;
  return v;
end $$;

create function t219.cli(p_tipo text, p_num text, p_nombres text, p_apellidos text default 'Prueba') returns jsonb
language sql immutable as $$
  select jsonb_build_object('nombres', p_nombres, 'apellidos', p_apellidos, 'tipoDoc', p_tipo, 'numeroDoc', p_num,
                            'telefono', '3000000219', 'email', 'p219@x.test')
$$;
create function t219.tit(p_tipo text, p_num text, p_nombres text, p_apellidos text default 'Prueba') returns jsonb
language sql immutable as $$
  select jsonb_build_object('rol', 'titular', 'tipo_doc', p_tipo, 'numero_doc', p_num,
           'observaciones', jsonb_build_array(jsonb_build_object('campo', 'nombres', 'valor', p_nombres),
                                              jsonb_build_object('campo', 'apellidos', 'valor', p_apellidos)))
$$;
create function t219.pas(p_ref uuid, p_orden int, p_tipo text, p_num text, p_nombres text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('rol', 'pasajero', 'ref', p_ref, 'orden', p_orden, 'tipo_doc', p_tipo, 'numero_doc', p_num,
           'observaciones', jsonb_build_array(jsonb_build_object('campo', 'nombres', 'valor', p_nombres),
                                              jsonb_build_object('campo', 'nacionalidad', 'valor', 'Colombia')))
$$;
create function t219.ref(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-e219-' || lpad(p_n::text, 12, '0'))::uuid
$$;

-- Llamadas como lo hace el servidor (service_role) o la sesión (authenticated + JWT).
create function t219.reg(p_cot bigint, p_usuario uuid, p_part jsonb) returns text language sql as $$
  select t216.escalar('service_role', null,
    format('select public.registrar_personas_cotizacion(%s, %L::uuid, %L::jsonb)::text', p_cot, p_usuario, p_part))
$$;
create function t219.edit(p_cot bigint, p_usuario uuid, p_tit jsonb, p_ver int, p_clave uuid) returns text language sql as $$
  select t216.escalar('service_role', null,
    format('select public.actualizar_titular_cotizacion(%s, %L::uuid, %L::jsonb, %s, %L::uuid)::text', p_cot, p_usuario, p_tit, coalesce(p_ver::text, 'null'), p_clave))
$$;
create function t219.sello(p_cot bigint, p_usuario uuid) returns text language sql as $$
  select t216.escalar('service_role', null, format('select public.sellar_creador_cotizacion(%s, %L::uuid)', p_cot, p_usuario))
$$;
create function t219.j(p text) returns jsonb language sql immutable as $$
  select case when p is null or p like 'ERR %' then jsonb_build_object('err', coalesce(p, 'null')) else p::jsonb end
$$;
create function t219.buscar(p_uid uuid, p_tenant text, p_tipo text, p_num text) returns jsonb language sql as $$
  select t219.j(t216.escalar('authenticated', p_uid,
    format('select public.buscar_personas_documento(%L, %L, %L, 50, 0)::text', p_tenant, p_tipo, p_num)))
$$;
create function t219.lista(p_uid uuid, p_tenant text, p_texto text default null, p_lim int default 50, p_off int default 0) returns jsonb
language sql as $$
  select t219.j(t216.escalar('authenticated', p_uid,
    format('select public.crm_personas_cotizacion_buscar(%L, %L, %s, %s)::text', p_tenant, p_texto, p_lim, p_off)))
$$;
-- Valores visibles de un campo en la respuesta de la consulta exacta (para comprobar procedencia).
create function t219.valores(r jsonb, p_campo text) returns text language sql immutable as $$
  select coalesce(string_agg(o ->> 'valor', ',' order by o ->> 'valor'), '')
    from jsonb_array_elements(coalesce(r -> 'observaciones', '[]'::jsonb)) o where o ->> 'campo' = p_campo
$$;
create function t219.conteos() returns text language sql stable as $$
  select (select count(*) from public.personas) || '/' || (select count(*) from public.persona_capturas) || '/'
         || (select count(*) from public.persona_observaciones) || '/' || (select count(*) from public.cotizacion_participantes)
$$;
create function t219.titular_de(p_cot bigint) returns public.cotizacion_participantes language sql stable as $$
  select * from public.cotizacion_participantes where cotizacion_id = p_cot and rol = 'titular' and activo
$$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- E. Alta y reintento (registrar_personas_cotizacion como service_role)'
do $$
declare
  c1 bigint; c2 bigint; r text; antes text; p jsonb;
begin
  -- Reservar (tarifario) de ventaA, sellada: titular documentado y dos pasajeros (uno vacío no viaja como puesto).
  p := jsonb_build_object('cliente', t219.cli('CC', '70.000.001', 'Ana'),
         'pasajeros', jsonb_build_array(
            jsonb_build_object('ref', t219.ref(1), 'nombres', 'Ana', 'apellidos', 'Prueba', 'tipoDoc', 'CC', 'numeroDoc', '70000001'),
            jsonb_build_object('nombres', '', 'apellidos', '', 'tipoDoc', 'CC', 'numeroDoc', ''),
            jsonb_build_object('ref', t219.ref(2), 'nombres', 'Beto', 'apellidos', 'Prueba', 'tipoDoc', 'CC', 'numeroDoc', '70000002')));
  c1 := t219.cot('tarifario', 'mayorista', t216.u('ventaA'), p, 'c216-ventaA@x.test');
  insert into t219.ids values ('c1', c1::text);
  r := t219.reg(c1, t216.u('ventaA'), jsonb_build_array(t219.tit('CC', '70.000.001', 'Ana'),
         t219.pas(t219.ref(1), 0, 'CC', '70000001', 'Ana'), t219.pas(t219.ref(2), 2, 'CC', '70000002', 'Beto')));
  perform t216.afirma('E1 alta: titular + 2 pasajeros identificados -> 3 puestos nuevos', t219.j(r) ->> 'nuevos' = '3', r);
  perform t216.afirma('E1.1 la respuesta no trae ids de persona ni si la ficha existía (D-4)',
    t219.j(r) ?& array['cotizacion_id', 'nuevos', 'reintentos', 'omitidos'] and not (t219.j(r) ? 'persona_id') and not (r like '%existente%'), r);
  perform t216.afirma('E1.2 titular y pasajero con el mismo documento = UNA persona, dos puestos (D-2)',
    (select count(distinct persona_id) from public.cotizacion_participantes where cotizacion_id = c1 and persona_id in
       (select id from public.personas where numero_norm = '70000001')) = 1
    and (select count(*) from public.cotizacion_participantes where cotizacion_id = c1) = 3);
  perform t216.afirma('E1.3 niveles N2: titular comercial, pasajeros pasajero_cotizacion; captura con su origen tipado',
    (select string_agg(c.rol || ':' || c.nivel, ',' order by c.rol) from public.persona_capturas c where c.cotizacion_id = c1 and c.rol = 'titular') = 'titular:comercial'
    and (select bool_and(c.nivel = 'pasajero_cotizacion' and c.fuente = 'cotizacion') from public.persona_capturas c where c.cotizacion_id = c1 and c.rol = 'pasajero'));
  perform t216.afirma('E1.4 el id de la captura de alta es md5(ref:alta:nivel) y el puesto la apunta',
    (select bool_and(cp.captura_id = md5(cp.id::text || ':alta:' || case cp.rol when 'titular' then 'comercial' else 'pasajero_cotizacion' end)::uuid)
       from public.cotizacion_participantes cp where cp.cotizacion_id = c1));
  perform t216.afirma('E1.5 el orden del pasajero se conserva solo para presentar (2 = tercera fila)',
    (select orden from public.cotizacion_participantes where id = t219.ref(2)) = 2);
  perform t216.afirma('E1.6 documento CRUDO en la captura (70.000.001 tal cual) y la persona documentada por la clave',
    (select documento_capturado from public.persona_capturas where cotizacion_id = c1 and rol = 'titular') = '70.000.001'
    and (select estado_doc from public.personas p join public.cotizacion_participantes cp on cp.persona_id = p.id
          where cp.cotizacion_id = c1 and cp.rol = 'titular') = 'documentada');

  antes := t219.conteos();
  r := t219.reg(c1, t216.u('ventaA'), jsonb_build_array(t219.tit('CC', '70.000.001', 'Ana'),
         t219.pas(t219.ref(1), 0, 'CC', '70000001', 'Ana'), t219.pas(t219.ref(2), 2, 'CC', '70000002', 'Beto')));
  perform t216.afirma('E2 reintento del mismo alta: 3 reintentos, nada escrito', t219.j(r) ->> 'reintentos' = '3' and t219.conteos() = antes, r);
  r := t219.reg(c1, t216.u('ventaA'), jsonb_build_array(t219.pas(t219.ref(2), 2, 'CC', '70000002', 'Otro nombre')));
  perform t216.afirma('E3 misma clave de alta con otro contenido: captura_inconsistente, nada escrito',
    r like 'ERR P0001: captura_inconsistente%' and t219.conteos() = antes, r);

  r := t219.reg(c1, t216.u('ventaA'), jsonb_build_array(t219.pas(t219.ref(3), 1, 'CC', '70000003', 'X')));
  perform t216.afirma('E4 ref que no está en el payload de la cotización: ref_inconsistente', r like 'ERR P0001: ref_inconsistente%', r);
  c2 := t219.cot('tarifario', 'mayorista', t216.u('ventaA'),
          jsonb_build_object('cliente', t219.cli('CC', '70000009', 'Otra'), 'pasajeros', jsonb_build_array(jsonb_build_object('ref', t219.ref(1), 'nombres', 'Ana'))),
          'c216-ventaA@x.test');
  r := t219.reg(c2, t216.u('ventaA'), jsonb_build_array(t219.pas(t219.ref(1), 0, 'CC', '70000001', 'Ana')));
  perform t216.afirma('E5 ref que ya pertenece a OTRA cotización: ref_inconsistente', r like 'ERR P0001: ref_inconsistente%', r);
  r := t219.reg(c2, t216.u('ventaA'), jsonb_build_array(jsonb_build_object('rol', 'titular', 'tipo_doc', 'CC', 'numero_doc', '  ',
         'observaciones', jsonb_build_array(jsonb_build_object('campo', 'telefono', 'valor', '300')))));
  perform t216.afirma('E6 puesto sin documento, nombres ni apellidos: participante_vacio (una cantidad no crea personas)',
    r like 'ERR 22023: participante_vacio%', r);
  r := t219.reg(c2, t216.u('ventaA'), jsonb_build_array(t219.tit('CC', '1', 'A') || jsonb_build_object('ref', t219.ref(9))));
  perform t216.afirma('E7 titular con ref: participantes_invalidos', r like 'ERR 22023: participantes_invalidos%', r);
  r := t219.reg(c2, t216.u('ventaA'), jsonb_build_array(t219.tit('CC', '70000009', 'Otra'), t219.tit('CC', '70000010', 'Dos')));
  perform t216.afirma('E8 dos titulares en un envío: participantes_invalidos', r like 'ERR 22023: participantes_invalidos%', r);
  r := t219.reg(c2, t216.u('ventaA'), jsonb_build_array(jsonb_build_object('rol', 'titular', 'tipo_doc', null, 'numero_doc', null,
         'observaciones', jsonb_build_array(jsonb_build_object('campo', 'nombres', 'valor', 'A'), jsonb_build_object('campo', 'nacionalidad', 'valor', 'X')))));
  perform t216.afirma('E9 campo que no corresponde al puesto (nacionalidad en titular): campo_no_admitido', r like 'ERR 22023: campo_no_admitido%', r);
  r := t219.reg(c2, t216.u('ventaA'), jsonb_build_array(jsonb_build_object('rol', 'titular', 'tipo_doc', null, 'numero_doc', repeat('1', 65),
         'observaciones', '[]'::jsonb)));
  perform t216.afirma('E10 original de 65 caracteres: original_demasiado_largo (no se trunca)', r like 'ERR 22023: original_demasiado_largo%', r);
  perform t216.afirma('E10.1 los rechazos no escribieron nada', (select count(*) from public.cotizacion_participantes where cotizacion_id = c2) = 0);

  -- Provisional y revisión: sin tipo / tipo inválido.
  c2 := t219.cot('tarifario', 'mayorista', t216.u('ventaA'), jsonb_build_object('cliente', t219.cli('', '70000011', 'Prov')), 'c216-ventaA@x.test');
  r := t219.reg(c2, t216.u('ventaA'), jsonb_build_array(t219.tit(null, '70000011', 'Prov')));
  perform t216.afirma('E11 titular sin tipo: ficha PROVISIONAL (no se deduplica)', t219.j(r) ->> 'nuevos' = '1'
    and (select p.estado_doc from public.personas p where p.id = (t219.titular_de(c2)).persona_id) = 'provisional', r);
  c2 := t219.cot('tarifario', 'mayorista', t216.u('ventaA'), jsonb_build_object('cliente', t219.cli('C.C.', '70000012', 'Rev')), 'c216-ventaA@x.test');
  r := t219.reg(c2, t216.u('ventaA'), jsonb_build_array(t219.tit('C.C.', '70000012', 'Rev')));
  perform t216.afirma('E12 tipo inválido: ficha EN REVISIÓN con el tipo crudo conservado', t219.j(r) ->> 'nuevos' = '1'
    and (select p.estado_doc || '/' || p.tipo_doc_original from public.personas p where p.id = (t219.titular_de(c2)).persona_id) = 'revision/C.C.', r);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- O. Orígenes y actores (C5: defensa en profundidad dentro de la fachada)'
do $$
declare
  c bigint; r text; p jsonb := jsonb_build_object('cliente', t219.cli('CC', '71000001', 'Orig'));
begin
  -- Checkout anónimo: carrito mayorista sin creador, propietario ni aliado.
  c := t219.cot('carrito', 'mayorista', null, jsonb_build_object('cliente', t219.cli('CC', '71000002', 'Anon')));
  r := t219.reg(c, null, jsonb_build_array(t219.tit('CC', '71000002', 'Anon')));
  perform t216.afirma('O1 anónimo con tipo: tipo_no_admitido (D-6: toda captura anónima es provisional)', r like 'ERR 22023: tipo_no_admitido%', r);
  r := t219.reg(c, null, jsonb_build_array(t219.tit(null, '71000002', 'Anon')));
  perform t216.afirma('O2 anónimo sin tipo y sin usuario: registrado como PROVISIONAL', t219.j(r) ->> 'nuevos' = '1'
    and (select estado_doc from public.personas where id = (t219.titular_de(c)).persona_id) = 'provisional', r);
  perform t216.afirma('O2.1 la captura anónima no guarda actor', (select actor_id is null and actor_rol is null from public.persona_capturas where id = (t219.titular_de(c)).captura_id));
  c := t219.cot('tarifario', 'mayorista', null, p);
  perform t216.afirma('O3 sin usuario en una cotización que NO es del checkout anónimo: no_autorizado',
    t219.reg(c, null, jsonb_build_array(t219.tit('CC', '71000001', 'Orig'))) like 'ERR 42501: no_autorizado%');
  c := t219.cot('carrito', 'minorista', null, p);
  perform t216.afirma('O4 carrito de minorista sin usuario: no es el checkout público (mayorista): no_autorizado',
    t219.reg(c, null, jsonb_build_array(t219.tit(null, '71000001', 'Orig'))) like 'ERR 42501: no_autorizado%');

  c := t219.cot('tarifario', 'mayorista', t216.u('ventaA'), p, 'c216-ventaA@x.test');
  perform t216.afirma('O5 usuario inactivo: no_autorizado', t219.reg(c, t216.u('inactivo'), jsonb_build_array(t219.tit('CC', '71000001', 'Orig'))) like 'ERR 42501: no_autorizado%');
  perform t216.afirma('O6 interno de OTRA agencia: no_autorizado', t219.reg(c, t216.u('adminMin'), jsonb_build_array(t219.tit('CC', '71000001', 'Orig'))) like 'ERR 42501: no_autorizado%');
  perform t216.afirma('O7 control_vuelo: no_autorizado', t219.reg(c, t216.u('vuelo'), jsonb_build_array(t219.tit('CC', '71000001', 'Orig'))) like 'ERR 42501: no_autorizado%');
  perform t216.afirma('O8 agencia que no creó la cotización: no_autorizado (B2B solo por creado_por_id)',
    t219.reg(c, t219.u('ag1'), jsonb_build_array(t219.tit('CC', '71000001', 'Orig'))) like 'ERR 42501: no_autorizado%');
  perform t216.afirma('O9 usuario inexistente: no_autorizado', t219.reg(c, t219.u('nadie'), jsonb_build_array(t219.tit('CC', '71000001', 'Orig'))) like 'ERR 42501: no_autorizado%');
  perform t216.afirma('O10 superadmin registra en cualquier agencia', t219.j(t219.reg(c, t216.u('super'), jsonb_build_array(t219.tit('CC', '71000001', 'Orig')))) ->> 'nuevos' = '1');

  c := t219.cot('tarifario', 'mayorista', t219.u('ag1'), p, 'c219-ag1@x.test');
  r := t219.reg(c, t219.u('ag1'), jsonb_build_array(t219.tit('CC', '71000001', 'Orig')));
  perform t216.afirma('O11 agencia creadora (creado_por_id propio): registra', t219.j(r) ->> 'nuevos' = '1', r);
  c := t219.cot('tarifario', 'mayorista', null, p, 'c219-ag1@x.test');
  perform t216.afirma('O12 agencia con su correo en creado_por pero SIN sello: no_autorizado (no se atribuye por correo)',
    t219.reg(c, t219.u('ag1'), jsonb_build_array(t219.tit('CC', '71000001', 'Orig'))) like 'ERR 42501: no_autorizado%');
  perform t216.afirma('O13 la agencia del MISMO aliado no registra en la cotización de su compañero',
    t219.reg(t219.cot('tarifario', 'mayorista', t219.u('ag1'), p, 'c219-ag1@x.test'), t219.u('ag2'),
             jsonb_build_array(t219.tit('CC', '71000001', 'Orig'))) like 'ERR 42501: no_autorizado%');

  update public.cotizaciones set estado = 'descartada' where id = c;
  perform t216.afirma('O14 cotización descartada: cotizacion_no_abierta',
    t219.reg(c, t216.u('admin'), jsonb_build_array(t219.tit('CC', '71000001', 'Orig'))) like 'ERR P0001: cotizacion_no_abierta%');
  perform t216.afirma('O15 cotización inexistente: cotizacion_inexistente',
    t219.reg(-1, t216.u('admin'), jsonb_build_array(t219.tit('CC', '71000001', 'Orig'))) like 'ERR P0001: cotizacion_inexistente%');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- T. Corrección del titular (actualizar_titular_cotizacion)'
do $$
declare
  c bigint; r text; v1 public.cotizacion_participantes; v2 public.cotizacion_participantes;
  k1 uuid := '00000000-0000-4000-f219-000000000001'; k2 uuid := '00000000-0000-4000-f219-000000000002';
  k3 uuid := '00000000-0000-4000-f219-000000000003'; antes text; rev0 int; pay jsonb;
  nuevo jsonb := jsonb_build_object('nombres', 'Ana', 'apellidos', 'Corregida', 'tipo_doc', 'CE', 'numero_doc', '7200001',
                                    'fecha_nacimiento', '1990-05-05', 'telefono', '3110000000', 'email', 'ana@x.test');
begin
  c := t216.crear('ventaA');
  insert into t219.ids values ('t_manual', c::text);
  perform t216.afirma('T0 la manual creada por la RPC de la 216 trae el sello de #39 (creado_por_id = autor)',
    (select creado_por_id from public.cotizaciones where id = c) = t216.u('ventaA'));
  r := t219.reg(c, t216.u('ventaA'), jsonb_build_array(jsonb_build_object('rol', 'titular', 'tipo_doc', 'CC', 'numero_doc', '1234567',
         'observaciones', jsonb_build_array(jsonb_build_object('campo', 'nombres', 'valor', 'Cliente'), jsonb_build_object('campo', 'apellidos', 'valor', 'Prueba')))));
  v1 := t219.titular_de(c);
  perform t216.afirma('T1 alta del titular de la manual: versión 1', v1.version = 1, r);
  rev0 := t216.rev(c);

  r := t219.edit(c, t216.u('ventaA'), nuevo, 1, k1);
  v2 := t219.titular_de(c);
  pay := (select payload from public.cotizaciones where id = c);
  perform t216.afirma('T2 corrección: actualizado, versión 2, mismo puesto, captura nueva, persona nueva por la clave nueva',
    t219.j(r) ->> 'resultado' = 'actualizado' and v2.version = 2 and v2.id = v1.id and v2.captura_id <> v1.captura_id
    and v2.persona_id <> v1.persona_id, r);
  perform t216.afirma('T2.1 la cotización ve el titular nuevo con el tipo CRUDO en la misma transacción',
    pay -> 'cliente' ->> 'tipoDoc' = 'CE' and pay -> 'cliente' ->> 'numeroDoc' = '7200001'
    and (select cliente || '|' || cliente_documento || '|' || (detalle -> 'venta' ->> 'cliente') from public.cotizaciones where id = c) = 'Ana Corregida|7200001|Ana Corregida');
  perform t216.afirma('T2.2 el titular no es económico: economico_rev intacto y servicios intactos', t216.rev(c) = rev0);
  perform t216.afirma('T2.3 la captura vieja queda como rastro (append-only)',
    exists (select 1 from public.persona_capturas where id = v1.captura_id));

  antes := t219.conteos();
  r := t219.edit(c, t216.u('ventaA'), nuevo, 1, k1);
  perform t216.afirma('T3 reintento del MISMO envío (misma clave): reintento, nada escrito', t219.j(r) ->> 'resultado' = 'reintento' and t219.conteos() = antes, r);
  r := t219.edit(c, t216.u('ventaA'), nuevo || jsonb_build_object('telefono', '3999999999'), 2, k1);
  perform t216.afirma('T4 misma clave con OTRO contenido: captura_inconsistente', r like 'ERR P0001: captura_inconsistente%', r);
  r := t219.edit(c, t216.u('ventaA'), nuevo || jsonb_build_object('telefono', '3999999999'), 1, k2);
  perform t216.afirma('T5 versión obsoleta: version_obsoleta, nada escrito', r like 'ERR P0001: version_obsoleta%' and t219.conteos() = antes, r);
  r := t219.edit(c, t216.u('ventaA'), nuevo, 2, k2);
  perform t216.afirma('T6 mismo contenido que la captura vigente con clave nueva: sin_cambios, nada escrito',
    t219.j(r) ->> 'resultado' = 'sin_cambios' and t219.conteos() = antes and (t219.titular_de(c)).version = 2, r);
  r := t219.edit(c, t216.u('ventaA'), nuevo || jsonb_build_object('tipo_doc', ''), 2, k3);
  perform t216.afirma('T7 tipo vacío: se guarda vacío (nunca "CC") y la captura nueva es provisional',
    t219.j(r) ->> 'resultado' = 'actualizado'
    and (select payload -> 'cliente' ->> 'tipoDoc' from public.cotizaciones where id = c) = ''
    and (select estado_doc from public.personas where id = (t219.titular_de(c)).persona_id) = 'provisional', r);
  perform t216.afirma('T8 interno de otra agencia: no_autorizado',
    t219.edit(c, t216.u('adminMin'), nuevo, 3, gen_random_uuid()) like 'ERR 42501: no_autorizado%');
  perform t216.afirma('T9 agencia/freelance no corrigen titulares (solo internos)',
    t219.edit(c, t219.u('ag1'), nuevo, 3, gen_random_uuid()) like 'ERR 42501: no_autorizado%');
  perform t216.afirma('T10 sin clave: clave_obligatoria', t219.edit(c, t216.u('ventaA'), nuevo, 3, null) like 'ERR 22023: clave_obligatoria%');
  perform t216.afirma('T11 titular sin nombre: titular_sin_nombre',
    t219.edit(c, t216.u('ventaA'), jsonb_build_object('nombres', ' ', 'apellidos', ''), 3, gen_random_uuid()) like 'ERR 22023: titular_sin_nombre%');
  perform t216.afirma('T12 dato de más de 200 caracteres: observaciones_invalidas (no se trunca)',
    t219.edit(c, t216.u('ventaA'), nuevo || jsonb_build_object('email', repeat('x', 201)), 3, gen_random_uuid()) like 'ERR 22023: observaciones_invalidas%');

  -- Cotización ANTERIOR a #42 (sin puesto): la corrección crea el puesto.
  c := t216.crear_legada();
  perform t216.afirma('T13 legada sin puesto con versión esperada 1: version_obsoleta',
    t219.edit(c, t216.u('admin'), nuevo, 1, gen_random_uuid()) like 'ERR P0001: version_obsoleta%');
  r := t219.edit(c, t216.u('admin'), nuevo, 0, k1);
  perform t216.afirma('T14 legada sin puesto (versión 0): la corrección CREA el puesto titular (versión 1)',
    t219.j(r) ->> 'resultado' = 'actualizado' and (t219.titular_de(c)).version = 1, r);
  r := t219.reg(c, t216.u('admin'), jsonb_build_array(t219.tit('CE', '7200001', 'Ana', 'Corregida')));
  perform t216.afirma('T15 alta posterior sobre un puesto creado por el editor: omitida (no re-apunta)',
    t219.j(r) ->> 'omitidos' = '1' and (t219.titular_de(c)).version = 1, r);

  -- Solo manuales simples.
  c := t219.cot('carrito', 'mayorista', null, jsonb_build_object('cliente', t219.cli('', '1', 'Carro')));
  perform t216.afirma('T16 carrito: cotizacion_no_editable', t219.edit(c, t216.u('admin'), nuevo, 0, gen_random_uuid()) like 'ERR P0001: cotizacion_no_editable%');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- S. Sello nuevo de autor (sellar_creador_cotizacion)'
do $$
declare c bigint; r text; p jsonb := jsonb_build_object('cliente', t219.cli('CC', '73000001', 'Sello'));
begin
  c := t219.cot('tarifario', 'mayorista', null, p, 'c219-ag1@x.test');
  r := t219.sello(c, t219.u('ag1'));
  perform t216.afirma('S1 cotización recién creada por la agencia (su correo): sellada', r = 'sellada'
    and (select creado_por_id from public.cotizaciones where id = c) = t219.u('ag1'), r);
  perform t216.afirma('S2 sellar otra vez: ya_sellada (idempotente)', t219.sello(c, t219.u('ag1')) = 'ya_sellada');
  perform t216.afirma('S3 otro usuario sobre una sellada: sello_ajeno', t219.sello(c, t219.u('ag2')) like 'ERR 42501: sello_ajeno%');
  c := t219.cot('tarifario', 'mayorista', null, p, 'c219-ag1@x.test');
  perform t216.afirma('S4 correo distinto al del usuario: sello_no_admitido', t219.sello(c, t219.u('ag2')) like 'ERR 42501: sello_no_admitido%');
  update public.cotizaciones set created_at = now() - interval '1 hour' where id = c;
  perform t216.afirma('S5 cotización de hace una hora: sello_vencido (un histórico nunca se vuelve propio)',
    t219.sello(c, t219.u('ag1')) like 'ERR 42501: sello_vencido%');
  c := t219.cot('carrito', 'mayorista', null, p, 'c216-ventaA@x.test');
  perform t216.afirma('S6 interno sobre un carrito recién creado con su correo: sellada', t219.sello(c, t216.u('ventaA')) = 'sellada');
  perform t216.afirma('S7 manual (sello propio de #39): sello_no_admitido',
    t219.sello((select v::bigint from t219.ids where k = 't_manual'), t216.u('ventaA')) in ('ya_sellada')
    and t219.sello(t216.crear_legada(), t216.u('admin')) like 'ERR 42501: sello_no_admitido%');
  c := t219.cot('tarifario', 'mayorista', null, p, 'c216-inactivo@x.test');
  perform t216.afirma('S8 usuario inactivo: no_autorizado', t219.sello(c, t216.u('inactivo')) like 'ERR 42501: no_autorizado%');
  c := t219.cot('tarifario', 'mayorista', null, p, 'c219-agMin@x.test');
  perform t216.afirma('S9 agencia de otra agencia (tenant): no_autorizado', t219.sello(c, t219.u('agMin')) like 'ERR 42501: no_autorizado%');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- I. Integridad del esquema (como dueño de la base)'
do $$
declare c1 bigint := (select v::bigint from t219.ids where k = 'c1'); e text; p1 public.cotizacion_participantes;
  otra uuid; v_p uuid;
begin
  p1 := t219.titular_de(c1);
  select id into otra from public.persona_capturas where cotizacion_id = c1 and participante_ref = t219.ref(2);
  begin
    insert into public.persona_capturas (id, persona_id, tenant, fuente, nivel, cotizacion_id) values (gen_random_uuid(), p1.persona_id, 'mayorista', 'captura_interna', 'comercial', c1);
    e := 'sin-error';
  exception when others then e := sqlstate; end;
  perform t216.afirma('I1 captura_interna con columnas de cotización: CHECK 23514', e = '23514', e);
  begin
    insert into public.persona_capturas (id, persona_id, tenant, fuente, nivel) values (gen_random_uuid(), p1.persona_id, 'mayorista', 'cotizacion', 'comercial');
    e := 'sin-error';
  exception when others then e := sqlstate; end;
  perform t216.afirma('I2 cotizacion sin su origen: CHECK 23514', e = '23514', e);
  begin
    insert into public.persona_capturas (id, persona_id, tenant, fuente, nivel, cotizacion_id, participante_ref, rol)
    values (gen_random_uuid(), p1.persona_id, 'mayorista', 'cotizacion', 'comercial', c1, t219.ref(2), 'pasajero');
    e := 'sin-error';
  exception when others then e := sqlstate; end;
  perform t216.afirma('I3 pasajero con nivel comercial (N2 exige pasajero_cotizacion): CHECK 23514', e = '23514', e);
  begin
    update public.cotizacion_participantes set captura_id = otra where id = p1.id;
    e := 'sin-error';
  exception when others then e := sqlstate; end;
  perform t216.afirma('I4 el puesto titular no puede apuntar a la captura de OTRO puesto: FK 23503', e = '23503', e);
  begin
    insert into public.cotizacion_participantes (id, cotizacion_id, tenant, rol, persona_id, captura_id)
    values (gen_random_uuid(), c1, 'mayorista', 'titular', p1.persona_id, p1.captura_id);
    e := 'sin-error';
  exception when others then e := sqlstate; end;
  perform t216.afirma('I5 segundo titular activo o puesto con captura ajena: rechazado (23505/23503)', e in ('23505', '23503'), e);
  begin
    update public.cotizacion_participantes set tenant = 'minorista' where id = p1.id;
    e := 'sin-error';
  exception when others then e := sqlstate; end;
  perform t216.afirma('I6 tenant del puesto inmutable: 23514', e = '23514', e);
  begin
    update public.cotizacion_participantes set version = 99 where id = p1.id;
    e := 'sin-error';
  exception when others then e := sqlstate; end;
  perform t216.afirma('I7 la versión no se fija a mano: 23514', e = '23514', e);
  begin
    delete from public.cotizacion_participantes where id = p1.id;
    e := 'sin-error';
  exception when others then e := sqlstate; end;
  perform t216.afirma('I8 un puesto no se borra (ni el dueño): 23514', e = '23514', e);
  begin
    delete from public.cotizaciones where id = c1;
    e := 'sin-error';
  exception when others then e := sqlstate; end;
  perform t216.afirma('I9 una cotización con puestos no se borra (FK ON DELETE RESTRICT): 23503', e = '23503', e);
  begin
    update public.persona_capturas set rol = 'pasajero' where id = p1.captura_id;
    e := 'sin-error';
  exception when others then e := sqlstate; end;
  perform t216.afirma('I10 capturas siguen append-only: 23514', e = '23514', e);
  update public.cotizacion_participantes set orden = 5 where id = p1.id;
  perform t216.afirma('I11 un cambio del puesto sube la versión sola', (t219.titular_de(c1)).version = p1.version + 1);
  perform t216.afirma('I12 la tabla de vínculo no lleva trg_auditoria ni ninguna tabla de personas',
    not exists (select 1 from pg_trigger t where t.tgname = 'trg_auditoria'
                 and t.tgrelid in ('public.cotizacion_participantes'::regclass, 'public.personas'::regclass,
                                   'public.persona_capturas'::regclass, 'public.persona_observaciones'::regclass)));
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- V. Visibilidad por rol y tenant (consulta exacta 214 y lista CRM)'
do $$
declare
  qa bigint; qb bigint; qg1 bigint; qg2 bigint; qf bigint; qanon bigint; qm bigint; r jsonb; doc text := '74000001';
  vacio jsonb := jsonb_build_object('persona', null, 'observaciones', '[]'::jsonb, 'total', 0, 'has_more', false,
                                    'divergencia', false, 'variantes', '[]'::jsonb);
  vacia_lista jsonb := jsonb_build_object('items', '[]'::jsonb, 'total', 0, 'has_more', false);
  pa jsonb; v_keys text;
begin
  -- Misma persona documentada (CC 74000001) en cotizaciones de distintos creadores.
  pa := jsonb_build_object('cliente', t219.cli('CC', doc, 'Vera'),
          'pasajeros', jsonb_build_array(jsonb_build_object('ref', t219.ref(41), 'nombres', 'Vera'), jsonb_build_object('ref', t219.ref(42), 'nombres', 'Hijo')));
  qa := t219.cot('tarifario', 'mayorista', t216.u('ventaA'), pa, 'c216-ventaA@x.test');
  perform t219.reg(qa, t216.u('ventaA'), jsonb_build_array(t219.tit('CC', doc, 'Vera', 'TitularA'), t219.pas(t219.ref(41), 0, 'CC', doc, 'PasajeraA'),
                                                          t219.pas(t219.ref(42), 1, 'TI', '1100001', 'HijoA')));
  pa := jsonb_build_object('cliente', t219.cli('CC', doc, 'Vera'), 'pasajeros', jsonb_build_array(jsonb_build_object('ref', t219.ref(43), 'nombres', 'Vera')));
  qb := t219.cot('tarifario', 'mayorista', t216.u('ventaB'), pa, 'c216-ventaB@x.test');
  perform t219.reg(qb, t216.u('ventaB'), jsonb_build_array(t219.tit('CC', doc, 'Vera', 'TitularB'), t219.pas(t219.ref(43), 0, 'CC', doc, 'PasajeraB')));
  qg1 := t219.cot('tarifario', 'mayorista', t219.u('ag1'), jsonb_build_object('cliente', t219.cli('CC', doc, 'Vera')), 'c219-ag1@x.test');
  perform t219.reg(qg1, t219.u('ag1'), jsonb_build_array(t219.tit('CC', doc, 'Vera', 'DeAgencia1')));
  qg2 := t219.cot('tarifario', 'mayorista', t219.u('ag2'), jsonb_build_object('cliente', t219.cli('CC', doc, 'Vera')), 'c219-ag2@x.test');
  perform t219.reg(qg2, t219.u('ag2'), jsonb_build_array(t219.tit('CC', doc, 'Vera', 'DeAgencia2')));
  qf := t219.cot('tarifario', 'mayorista', t219.u('fl'), jsonb_build_object('cliente', t219.cli('CC', doc, 'Vera')), 'c219-fl@x.test');
  perform t219.reg(qf, t219.u('fl'), jsonb_build_array(t219.tit('CC', doc, 'Vera', 'DeFreelance')));
  -- Anónima del checkout con el correo de la agencia en creado_por (legado): nunca es de la agencia.
  qanon := t219.cot('carrito', 'mayorista', null, jsonb_build_object('cliente', t219.cli('', doc, 'Vera')), 'c219-ag1@x.test');
  perform t219.reg(qanon, null, jsonb_build_array(t219.tit(null, doc, 'Vera', 'AnonimaLegado')));
  qm := t219.cot('tarifario', 'minorista', t216.u('ventaMin'), jsonb_build_object('cliente', t219.cli('CC', doc, 'Vera')), 'c216-ventaMin@x.test');
  perform t219.reg(qm, t216.u('ventaMin'), jsonb_build_array(t219.tit('CC', doc, 'Vera', 'Minorista')));
  insert into t219.ids values ('qa', qa::text), ('qb', qb::text), ('qg1', qg1::text);

  -- Consulta exacta (214) — internos.
  r := t219.buscar(t216.u('admin'), null, 'CC', doc);
  perform t216.afirma('V1 administración ve las 7 capturas documentadas del tenant (titulares y pasajeros), nada de minorista ni de la anónima provisional',
    t219.valores(r, 'apellidos') = 'DeAgencia1,DeAgencia2,DeFreelance,TitularA,TitularB'
    and t219.valores(r, 'nombres') like '%PasajeraA%' and t219.valores(r, 'nombres') like '%PasajeraB%'
    and r::text not like '%Minorista%' and r::text not like '%AnonimaLegado%', r::text);
  perform t216.afirma('V1.1 procedencia nueva: cotizacion_id, rol y activo; nunca payload ni precio',
    (select bool_and(o ? 'cotizacion_id' and o ? 'rol' and o ? 'activo') from jsonb_array_elements(r -> 'observaciones') o)
    and r::text not like '%precio%' and r::text not like '%payload%');
  r := t219.buscar(t216.u('ventaA'), null, 'CC', doc);
  perform t216.afirma('V2 venta (D-3=N2) ve el contacto comercial de todos los titulares del tenant y los pasajeros SOLO de su cotización',
    t219.valores(r, 'apellidos') = 'DeAgencia1,DeAgencia2,DeFreelance,TitularA,TitularB'
    and t219.valores(r, 'nombres') like '%PasajeraA%' and t219.valores(r, 'nombres') not like '%PasajeraB%', r::text);
  perform t216.afirma('V2.1 a venta, cotizacion_id solo de cotizaciones propias',
    (select bool_and(case when (o ->> 'cotizacion_id') is null then true else (o ->> 'cotizacion_id')::bigint = qa end)
       from jsonb_array_elements(r -> 'observaciones') o)
    and exists (select 1 from jsonb_array_elements(r -> 'observaciones') o where (o ->> 'cotizacion_id')::bigint = qa));
  r := t219.buscar(t219.u('ag1'), null, 'CC', doc);
  perform t216.afirma('V3 B2B: la consulta global 214 sigue cerrada (vacío idéntico)', r = vacio, r::text);
  perform t216.afirma('V4 control_vuelo e inactivo: vacío idéntico',
    t219.buscar(t216.u('vuelo'), null, 'CC', doc) = vacio and t219.buscar(t216.u('inactivo'), null, 'CC', doc) = vacio);
  perform t216.afirma('V5 gerencia sin p_tenant: vacío; con minorista explícito: solo la de minorista',
    t219.buscar(t216.u('gerencia'), null, 'CC', doc) = vacio
    and t219.valores(t219.buscar(t216.u('gerencia'), 'minorista', 'CC', doc), 'apellidos') = 'Minorista');
  perform t216.afirma('V6 administración con p_tenant falsificado (minorista): vacío',
    t219.buscar(t216.u('admin'), 'minorista', 'CC', doc) = vacio);

  -- Lista CRM.
  r := t219.lista(t219.u('ag1'), null);
  perform t216.afirma('V7 agencia: solo los puestos de SUS cotizaciones (ni su compañero del mismo aliado, ni el freelance, ni la anónima con su correo)',
    (r ->> 'total')::int >= 1
    and (select bool_and((i -> 'cotizacion' ->> 'id')::bigint in (select id from public.cotizaciones where creado_por_id = t219.u('ag1')))
           from jsonb_array_elements(r -> 'items') i)
    and exists (select 1 from jsonb_array_elements(r -> 'items') i where (i -> 'cotizacion' ->> 'id')::bigint = qg1)
    and not exists (select 1 from jsonb_array_elements(r -> 'items') i where (i -> 'cotizacion' ->> 'id')::bigint in (qg2, qf, qanon)), r::text);
  perform t216.afirma('V7.1 a B2B no se le entrega persona_id',
    (select bool_and(i -> 'persona_id' = 'null'::jsonb) from jsonb_array_elements(r -> 'items') i));
  perform t216.afirma('V7.2 la otra agencia del mismo aliado tampoco ve la de ag1', (t219.lista(t219.u('ag2'), null) ->> 'total')::int = 1
    and t219.lista(t219.u('ag2'), null) -> 'items' -> 0 -> 'cotizacion' ->> 'id' = qg2::text);
  perform t216.afirma('V7.3 agencia de minorista sin cotizaciones: vacío idéntico (0 indistinguible de sin permiso)',
    t219.lista(t219.u('agMin'), null) = vacia_lista);
  r := t219.lista(t216.u('ventaA'), null, doc);
  perform t216.afirma('V8 venta: lista solo cotizaciones propias (titular y pasajera de qa con ese documento; nada de qb, B2B ni anónima)',
    (select bool_and((i -> 'cotizacion' ->> 'id')::bigint = qa) from jsonb_array_elements(r -> 'items') i) and (r ->> 'total')::int = 2, r::text);
  r := t219.lista(t216.u('admin'), null, doc);
  perform t216.afirma('V9 administración: todos los puestos del tenant con ese documento (7 documentados + la anónima provisional)',
    (r ->> 'total')::int = 8, r::text);
  perform t216.afirma('V9.1 cada puesto trae solo la proyección acordada (sin payload, precio ni actor)',
    (select bool_and((select string_agg(k, ',' order by k) from jsonb_object_keys(i) k)
                      = 'activo,capturado_en,cotizacion,datos,estado_ficha,numero_doc,orden,participante_ref,persona_id,rol,tipo_doc')
       from jsonb_array_elements(r -> 'items') i));
  perform t216.afirma('V10 anon (sin sub), control_vuelo e inactivo: lista vacía idéntica',
    t219.lista(null, null) = vacia_lista and t219.lista(t216.u('vuelo'), null) = vacia_lista and t219.lista(t216.u('inactivo'), null) = vacia_lista);
  perform t216.afirma('V11 límite 51: 22023 con error', t219.lista(t216.u('admin'), null, null, 51) ->> 'err' like 'ERR 22023%');
  r := t219.lista(t216.u('admin'), null, doc, 2, 0);
  perform t216.afirma('V12 paginación: total 8, has_more y 2 en la página', (r ->> 'total')::int = 8 and (r ->> 'has_more')::boolean
    and jsonb_array_length(r -> 'items') = 2);
  perform t216.afirma('V13 comodines del texto escapados: "%" no ensancha la búsqueda', (t219.lista(t216.u('admin'), null, '%') ->> 'total')::int = 0);
  perform t216.afirma('V14 gerencia con p_tenant mayorista ve la lista del tenant; sin p_tenant, vacía',
    (t219.lista(t216.u('gerencia'), 'mayorista', doc) ->> 'total')::int = 8 and t219.lista(t216.u('gerencia'), null, doc) = vacia_lista);

  -- Una corrección deja de mostrar la captura anterior en las DOS lecturas.
  update public.cotizaciones set tipo = 'manual' where id = qb;
  perform t219.edit(qb, t216.u('admin'), jsonb_build_object('nombres', 'Otra', 'apellidos', 'PersonaNueva', 'tipo_doc', 'CC', 'numero_doc', '74000099'),
                    (t219.titular_de(qb)).version, gen_random_uuid());
  r := t219.buscar(t216.u('admin'), null, 'CC', doc);
  perform t216.afirma('V15 corrección: la captura vieja (TitularB) ya no aparece bajo el documento anterior',
    t219.valores(r, 'apellidos') not like '%TitularB%' and t219.valores(r, 'apellidos') like '%TitularA%', r::text);
  perform t216.afirma('V15.1 ni en la lista del CRM', t219.lista(t216.u('admin'), null, 'TitularB') = vacia_lista);
  perform t216.afirma('V15.2 la persona nueva sí aparece bajo su documento',
    t219.valores(t219.buscar(t216.u('admin'), null, 'CC', '74000099'), 'apellidos') = 'PersonaNueva');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- G. Regresiones: escritores 214, promover, madre 211 y conversión 198'
do $$
declare c bigint; r text; num text; v_madre bigint; sello_antes text; pay_antes jsonb;
begin
  r := t216.escalar('service_role', null, format(
         'select persona_id::text || %L || resultado from p214_priv.upsert_persona(%L::uuid, ''mayorista'', ''cotizacion'', ''CC'', ''1'', null, ''[]''::jsonb, null, null, null, null, 1, %L::uuid, ''titular'')',
         '|', gen_random_uuid(), gen_random_uuid()));
  perform t216.afirma('G1 la fuente cotizacion NO entra directo por service_role: fuente_solo_por_fachada (42501)', r like 'ERR 42501: fuente_solo_por_fachada%', r);
  r := t216.escalar('service_role', null, format(
         'select persona_id::text || %L || resultado from p214_priv.upsert_persona(%L::uuid, ''mayorista'', ''captura_interna'', ''CC'', ''75000001'', null, ''[{"campo":"nombres","valor":"V1"}]''::jsonb)',
         '|', gen_random_uuid()));
  perform t216.afirma('G2 V1 intacta: captura_interna por service_role sigue funcionando (creada)', r like '%|creada', r);
  r := t216.escalar('service_role', null, format(
         'select resultado from p214_priv.promover_persona((select id from public.personas where numero_norm = ''75000001''), %L::uuid, ''CC'', ''75000001'', null, ''[]''::jsonb, ''cotizacion'')',
         gen_random_uuid()));
  perform t216.afirma('G3 promover_persona no acepta la fuente cotizacion (origen_invalido)', r like 'ERR 22023: origen_invalido%', r);
  r := t216.escalar('service_role', null, format(
         'select resultado from p214_priv.upsert_persona(%L::uuid, ''mayorista'', ''captura_interna'', ''CC'', ''75000002'', null, ''[]''::jsonb, null, null, null, null, 7)',
         gen_random_uuid()));
  perform t216.afirma('G4 captura_interna con cotización: origen_invalido', r like 'ERR 22023: origen_invalido%', r);
  perform t216.afirma('G5 las fachadas no las ejecuta authenticated ni anon',
    t216.escalar('authenticated', t216.u('admin'), 'select public.registrar_personas_cotizacion(1, null, ''[]''::jsonb)::text') like 'ERR 42501%'
    and t216.escalar('anon', null, 'select public.sellar_creador_cotizacion(1, null)') like 'ERR 42501%'
    and t216.escalar('authenticated', t216.u('admin'), 'select public.actualizar_titular_cotizacion(1, null, ''{}''::jsonb, 0, null)::text') like 'ERR 42501%');
  perform t216.afirma('G6 la tabla de vínculo está cerrada a authenticated',
    t216.escalar('authenticated', t216.u('admin'), 'select count(*)::text from public.cotizacion_participantes') like 'ERR 42501%');

  -- Madre comparativa (211): su titular se registra SIN tocar su payload ni su sello.
  v_madre := (select id from public.cotizaciones where modo = 'comparativa' limit 1);
  if v_madre is null then
    insert into public.cotizaciones (tenant, tipo, modo, estado, payload, detalle, cliente, modulo, pax, precio_venta, moneda, vigencia_hasta, creado_por_id)
    values ('mayorista', 'comparativa_manual', 'comparativa', 'abierta',
            jsonb_build_object('comparativa', true, 'cliente', t219.cli('CC', '76000001', 'Madre')), '{}'::jsonb, 'Madre', 'manual', 2, null, 'COP',
            public.fecha_negocio() + 5, t216.u('admin'))
    returning id into v_madre;
    update public.cotizaciones set sello_economico = f211_priv.sello_madre(v_madre) where id = v_madre;
  end if;
  sello_antes := (select sello_economico from public.cotizaciones where id = v_madre);
  pay_antes := (select payload from public.cotizaciones where id = v_madre);
  r := t219.reg(v_madre, t216.u('admin'), jsonb_build_array(t219.tit('CC', '76000001', 'Madre')));
  perform t216.afirma('G7 titular de la MADRE registrado; su payload y su sello económico intactos',
    t219.j(r) ->> 'nuevos' = '1' and (select payload from public.cotizaciones where id = v_madre) = pay_antes
    and (select sello_economico from public.cotizaciones where id = v_madre) is not distinct from sello_antes
    and sello_antes = f211_priv.sello_madre(v_madre), r);
  perform t216.afirma('G7.1 el editor no toca una madre (cotizacion_no_editable)',
    t219.edit(v_madre, t216.u('admin'), jsonb_build_object('nombres', 'X'), 1, gen_random_uuid()) like 'ERR P0001: cotizacion_no_editable%');

  -- Conversión 198 de una manual con el titular corregido (tipo crudo), por la puerta de #39.
  c := t216.crear('admin');
  perform t219.reg(c, t216.u('admin'), jsonb_build_array(t219.tit('CC', '1234567', 'Cliente')));
  r := t219.edit(c, t216.u('admin'), jsonb_build_object('nombres', 'Conv', 'apellidos', 'Titular', 'tipo_doc', 'PAS', 'numero_doc', 'AB123456',
         'fecha_nacimiento', '1985-03-03', 'telefono', '3001', 'email', 'conv@x.test'), 1, gen_random_uuid());
  perform t216.pagar(c, 450000, 'g219-pago');
  num := t216.escalar('service_role', null, t216.convertir_sql(c));
  perform t216.afirma('G8 la 198 convierte la manual con el titular corregido (tipo crudo PAS)', num !~ '^ERR', num);
  perform t216.afirma('G8.1 el contrato tomó el titular corregido',
    exists (select 1 from public.contrato_pasajeros cp where cp.numero_contrato = num and cp.tipo_id = 'PAS' and cp.identificacion = 'AB123456'), num);
  perform t216.afirma('G9 convertida: registrar y editar devuelven cotizacion_no_abierta; los vínculos quedan como historia',
    t219.reg(c, t216.u('admin'), jsonb_build_array(t219.tit('PAS', 'AB123456', 'Conv'))) like 'ERR P0001: cotizacion_no_abierta%'
    and t219.edit(c, t216.u('admin'), jsonb_build_object('nombres', 'Y'), 2, gen_random_uuid()) like 'ERR P0001: cotizacion_no_abierta%'
    and (t219.titular_de(c)).version = 2);
  perform t216.afirma('G10 la conversión no agrega personas al registro central (D-5)',
    not exists (select 1 from public.persona_capturas where fuente = 'contrato_pasajero' and contrato_numero = num));
end $$;

-- Cierre: ningún FALLO registrado.
do $$
declare n int; m int;
begin
  select count(*) filter (where not ok), count(*) into n, m from t216.res;
  if n > 0 then
    raise exception 'TEST 219 SQL: % FALLO(S) de % comprobaciones', n, m;
  end if;
  raise notice 'INFO  TEST 219 SQL: % comprobaciones', m;
end $$;

\echo 'TEST 219 SQL: TODO OK'
rollback;
