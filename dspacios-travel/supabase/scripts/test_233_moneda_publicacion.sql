-- ─────────────────────────────────────────────────────────────────────────
-- BATERÍA SQL · 233 (#90 D / #93): moneda de publicación elegida + TRM condicional en el modo cop_trm_63. SOLO bases desechables.
-- Corre en UNA transacción que termina en ROLLBACK, sobre una base con 001-232 y la 233 aplicada.
-- Uso:  psql -X -q -v ON_ERROR_STOP=1 -f test_233_moneda_publicacion.sql      Cierre esperado: "TEST 233 SQL: TODO OK".
--
--   A  columna y CHECK: moneda_publicacion COP|USD, el modo 63 solo COP, el modo 63 YA NO exige TRM (todo COP), TRM positiva si existe
--   B  p63_requiere_trm: hotel/servicio/salida manual/salida vinculada en USD; inactiva y modelo por unidad no cuentan; ACL
--   C  publicar_tarifario_resultado_63: todo COP sin TRM publica; con USD y sin TRM se niega; TRM cambiada descarta; TRM inválida y moneda USD
--   D  invalidación: cambiar moneda_publicacion invalida; el mismo valor no; la moneda de una fuente sube la revisión
--   E  cotizar y aceptar sin TRM; cambio posterior COP→USD y TRM configurada después protegen la oferta ya cotizada
--   F  CxP aceptadas sin TRM: solo COP e igual a su valor; USD sin TRM se rechaza; CHECK de la obligación
--   G  el mundo 63 con TRM (USD convertido) sigue funcionando; ofertas con TRM no cambian
--   Z  conclusión: las pruebas fueron concluyentes (conteos de las propias fixtures)
-- ─────────────────────────────────────────────────────────────────────────
begin;

create schema t233;
create table t233.res (nombre text, ok boolean, detalle text);

create function t233.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void
language plpgsql as $$
begin
  insert into t233.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre;
  else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;

create function t233.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000233' || case p_k
    when 'super' then '001' when 'gere' then '002' when 'admi' then '003' when 'oper' then '004'
    when 'vent' then '006' else '999' end)::uuid
$$;

-- Ejecuta UNA consulta que devuelve un texto como el usuario `p_k` (NULL = sin sesión) con el rol de Postgres `p_rol`.
-- Devuelve el texto o 'ERR <sqlstate> <mensaje>'. `set local role` es imprescindible: un superusuario SE SALTA la RLS.
create function t233.q(p_sql text, p_k text, p_rol text default 'authenticated') returns text
language plpgsql as $$
declare v_res text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_k is null then '' else json_build_object('sub', t233.u(p_k), 'role', p_rol)::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(t233.u(p_k)::text, ''), true);
    execute format('set local role %I', p_rol);
    execute p_sql into v_res;
  exception when others then
    v_res := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_res;
end $$;

create function t233.msg(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function t233.try(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, 'OK');
exception when others then
  return 'ERR ' || sqlstate || ' ' || sqlerrm;
end $$;

insert into auth.users (id, email)
select t233.u(k), 'c233-' || k || '@x.test' from unnest(array['super','gere','admi','oper','vent']) k on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t233.u(v.k), 'c233-' || v.k || '@x.test', 'C233 ' || v.k, v.r::rol_usuario, true, 'mayorista'
from (values ('super','superadmin'), ('gere','gerencia'), ('admi','administracion'), ('oper','operaciones'), ('vent','venta')) v(k, r)
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (233010, 'T233 CARTAGENA', 'CTG', 'Colombia', true);
insert into public.proveedores (id, nombre, aplica_retencion, pct_retencion) values (233700, 'T233 PROV', false, 0);
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) values
  (233600, 233010, 'T233 HOTEL COP', 233700, 'COP'),
  (233601, 233010, 'T233 HOTEL USD', 233700, 'USD'),
  (233602, 233010, 'T233 HOTEL UNIDAD USD', 233700, 'USD');
update public.hoteles set modelo_tarifario = 'unidad' where id = 233602;
insert into public.servicios_adicionales (id, nombre, proveedor_id, moneda) values
  (233650, 'T233 TOUR COP', 233700, 'COP'),
  (233651, 'T233 TOUR USD', 233700, 'USD');
insert into public.empaquetados (id, record, aerolinea, ruta, destino_id, fecha_ida, fecha_regreso, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo, proveedor_id, moneda) values
  (233507, null, 'AEROTEST', 'BOG - CTG - BOG', 233010, current_date + 60, current_date + 63, 1000000, 1130000, 80500, true, 233700, 'COP'),
  (233508, null, 'AEROTEST', 'MDE - CTG - MDE', 233010, current_date + 61, current_date + 64, 250, 290, 20, true, 233700, 'USD');

-- Paquetes: 233301 (todo COP, modo 63 SIN TRM) · 233302 (con USD, modo 63 CON TRM) · 233303 (legacy) · 233304 (modo 63, requisito de TRM)
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id, modo_oferta, trm_oferta, moneda_publicacion) values
  (233301, 'T233 63 todo COP sin TRM', 'dinamico', true, 233010, 'cop_trm_63', null, 'COP'),
  (233302, 'T233 63 con USD y TRM', 'dinamico', true, 233010, 'cop_trm_63', 4000, 'COP'),
  (233303, 'T233 legacy', 'dinamico', true, 233010, 'legacy', null, 'COP'),
  (233304, 'T233 63 requisito de TRM', 'dinamico', true, 233010, 'cop_trm_63', null, 'COP');
select setval(pg_get_serial_sequence('public.armado_paquetes', 'id'), greatest((select max(id) from public.armado_paquetes), 233304));

insert into public.armado_hoteles (paquete_id, hotel_id) values (233301, 233600), (233302, 233601), (233304, 233600);
insert into public.armado_servicios (paquete_id, servicio_id) values (233301, 233650), (233302, 233650), (233304, 233650);
insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, fee_infante, aplica_mk, ta, moneda) values
  (233301, 233507, current_date + 60, current_date + 63, 'BOG - CTG - BOG', 'AEROTEST', 1130000, 80500, false, 0, 'COP'),
  (233302, 233507, current_date + 60, current_date + 63, 'BOG - CTG - BOG', 'AEROTEST', 1130000, 80500, false, 0, 'COP'),
  (233304, 233507, current_date + 60, current_date + 63, 'BOG - CTG - BOG', 'AEROTEST', 1130000, 80500, false, 0, 'COP');

create function t233.publicar(p_paquete bigint, p_k text, p_trm text default 'null', p_moneda text default 'COP', p_modo text default 'cop_trm_63') returns text
language plpgsql as $$
declare v_gen bigint; v_rev bigint;
begin
  select tarifario_generacion, tarifario_revision_fuente into v_gen, v_rev from public.armado_paquetes where id = p_paquete;
  return t233.q(format('select public.publicar_tarifario_resultado_63(%s, %s, %s, %L, ''[]''::jsonb, %L, %s)::text', p_paquete, v_gen, v_rev, p_moneda, p_modo, p_trm), p_k);
end $$;

create function t233.rev(p_paquete bigint) returns bigint language sql stable as $$
  select tarifario_revision_fuente from public.armado_paquetes where id = p_paquete
$$;

-- ═ A · columna y CHECK ═══════════════════════════════════════════════════════════════════
do $$
declare v_m text;
begin
  perform t233.afirma('A1 la columna moneda_publicacion existe y es nullable',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'moneda_publicacion' and is_nullable = 'YES'));
  perform t233.afirma('A2 un paquete en modo 63 SIN TRM (todo COP) ya es válido (#93)',
    (select count(*) from public.armado_paquetes where id in (233301, 233304) and modo_oferta = 'cop_trm_63' and trm_oferta is null) = 2);
  v_m := t233.msg('update public.armado_paquetes set moneda_publicacion = ''EUR'' where id = 233303');
  perform t233.afirma('A3 moneda_publicacion fuera de (COP, USD) rechazada', v_m like '23514%', v_m);
  v_m := t233.msg('update public.armado_paquetes set moneda_publicacion = ''USD'' where id = 233301');
  perform t233.afirma('A4 el modo 63 no puede elegir USD', v_m like '23514%', v_m);
  v_m := t233.msg('update public.armado_paquetes set moneda_publicacion = ''USD'' where id = 233303');
  perform t233.afirma('A5 un paquete de siempre sí puede elegir USD', v_m = 'OK', v_m);
  update public.armado_paquetes set moneda_publicacion = 'COP' where id = 233303;
  v_m := t233.msg('update public.armado_paquetes set trm_oferta = 0 where id = 233302');
  perform t233.afirma('A6 una TRM cero sigue rechazada (nunca 1 ni 0 implícitas)', v_m like '23514%', v_m);
  v_m := t233.msg('update public.armado_paquetes set trm_oferta = -3 where id = 233302');
  perform t233.afirma('A7 una TRM negativa sigue rechazada', v_m like '23514%', v_m);
  v_m := t233.msg('update public.armado_paquetes set modo_oferta = ''cop_trm_63'' where id = 233303');
  perform t233.afirma('A8 pasar un legacy a modo 63 sin TRM es válido si luego no hay USD (la guarda es de publicar/cotizar)', v_m = 'OK', v_m);
  update public.armado_paquetes set modo_oferta = 'legacy', trm_oferta = null where id = 233303;
end $$;

-- ═ B · p63_requiere_trm ══════════════════════════════════════════════════════════════════
do $$
declare v_sal bigint;
begin
  perform t233.afirma('B1 todo COP (hotel, servicio, salida vinculada COP) no requiere TRM', not public.p63_requiere_trm(233301));
  perform t233.afirma('B2 un hotel en USD requiere TRM', public.p63_requiere_trm(233302));
  insert into public.armado_servicios (paquete_id, servicio_id) values (233301, 233651);
  perform t233.afirma('B3 un servicio en USD requiere TRM', public.p63_requiere_trm(233301));
  delete from public.armado_servicios where paquete_id = 233301 and servicio_id = 233651;
  perform t233.afirma('B4 quitar el servicio USD lo devuelve a "no requiere"', not public.p63_requiere_trm(233301));
  insert into public.salidas_dinamicas (paquete_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, aplica_mk, ta, moneda)
    values (233301, current_date + 70, current_date + 73, 'MDE - CTG', 'AEROTEST', 250, false, 0, 'USD') returning id into v_sal;
  perform t233.afirma('B5 una salida MANUAL en USD requiere TRM', public.p63_requiere_trm(233301));
  update public.salidas_dinamicas set activo = false where id = v_sal;
  perform t233.afirma('B6 una salida inactiva en USD no cuenta', not public.p63_requiere_trm(233301));
  delete from public.salidas_dinamicas where id = v_sal;
  insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, fee_infante, aplica_mk, ta, moneda)
    values (233301, 233508, current_date + 61, current_date + 64, 'MDE - CTG - MDE', 'AEROTEST', 290, 20, false, 0, 'USD') returning id into v_sal;
  perform t233.afirma('B7 una salida VINCULADA a un vuelo en USD requiere TRM (toma la moneda de su vuelo)', public.p63_requiere_trm(233301));
  delete from public.salidas_dinamicas where id = v_sal;
  insert into public.armado_hoteles (paquete_id, hotel_id) values (233301, 233602);
  perform t233.afirma('B8 un hotel por unidad en USD no entra al tarifario clásico: no cuenta', not public.p63_requiere_trm(233301));
  delete from public.armado_hoteles where paquete_id = 233301 and hotel_id = 233602;
  perform t233.afirma('B9 un paquete sin fuentes no requiere TRM', not public.p63_requiere_trm(999999));
  perform t233.afirma('B10 la función no la ejecutan anon ni authenticated',
    not has_function_privilege('anon', 'public.p63_requiere_trm(bigint)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.p63_requiere_trm(bigint)', 'EXECUTE'));
  perform t233.afirma('B11 las tablas privadas aceptan trm NULL (oferta sin conversión)',
    (select not attnotnull from pg_attribute where attrelid = 'public.p63_oferta'::regclass and attname = 'trm')
    and (select not attnotnull from pg_attribute where attrelid = 'public.tarifario_oferta_63'::regclass and attname = 'trm'));
end $$;

-- ═ B2 · fuentes que el generador DESCARTA no exigen TRM (y las que aporta sí) ═══════════════════
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (233011, 'T233 OTRO DESTINO', 'SMR', 'Colombia', true);
do $$
declare v_id bigint; v_req boolean;
begin
  -- Salidas MANUALES en USD: incluida vs descartada por cada criterio del generador.
  insert into public.salidas_dinamicas (paquete_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, aplica_mk, ta, moneda)
    values (233301, current_date + 80, current_date + 83, 'X', 'A', 250, false, 0, 'USD') returning id into v_id;
  perform t233.afirma('B12 (incluida) salida manual USD vigente, con noches y compra abierta: exige TRM', public.p63_requiere_trm(233301));
  update public.salidas_dinamicas set compra_fin = current_date - 1 where id = v_id;
  perform t233.afirma('B13 (descartada) salida USD con la compra vencida: NO exige TRM', not public.p63_requiere_trm(233301));
  update public.salidas_dinamicas set compra_fin = null, compra_inicio = current_date + 5 where id = v_id;
  perform t233.afirma('B14 (descartada) salida USD cuya compra aún no abre: NO exige TRM', not public.p63_requiere_trm(233301));
  update public.salidas_dinamicas set compra_inicio = null, fecha_ida = current_date - 3, fecha_regreso = current_date - 1 where id = v_id;
  perform t233.afirma('B15 (descartada) salida USD con el viaje ya pasado: NO exige TRM', not public.p63_requiere_trm(233301));
  update public.salidas_dinamicas set fecha_ida = current_date + 80, fecha_regreso = null where id = v_id;
  perform t233.afirma('B16 (descartada) salida USD sin fecha de regreso: NO exige TRM', not public.p63_requiere_trm(233301));
  update public.salidas_dinamicas set fecha_regreso = current_date + 80 where id = v_id;
  perform t233.afirma('B17 (descartada) salida USD sin noches (regreso = ida): NO exige TRM', not public.p63_requiere_trm(233301));
  update public.salidas_dinamicas set fecha_regreso = current_date + 83 where id = v_id;
  perform t233.afirma('B18 al corregirla vuelve a aportar y exige TRM', public.p63_requiere_trm(233301));
  delete from public.salidas_dinamicas where id = v_id;
  perform t233.afirma('B19 (precondición) sin salidas USD vuelve a no exigir', not public.p63_requiere_trm(233301));

  -- Salida VINCULADA a un vuelo en USD (233508): incluida y luego descartada por cada criterio.
  insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, fee_infante, aplica_mk, ta, moneda)
    values (233301, 233508, current_date + 61, current_date + 64, 'MDE - CTG - MDE', 'AEROTEST', 290, 20, false, 0, 'USD') returning id into v_id;
  perform t233.afirma('B20 (incluida) vinculada USD elegible, permitida y con la copia al día: exige TRM', public.p63_requiere_trm(233301));
  update public.empaquetados set record = 'ABC123' where id = 233508;
  perform t233.afirma('B21 (descartada) la fuente ya tiene record (PNR): NO exige TRM', not public.p63_requiere_trm(233301));
  update public.empaquetados set record = null, activo = false where id = 233508;
  perform t233.afirma('B22 (descartada) la fuente fue desactivada: NO exige TRM', not public.p63_requiere_trm(233301));
  update public.empaquetados set activo = true, compra_fin = current_date - 1 where id = 233508;
  perform t233.afirma('B23 (descartada) la compra de la fuente venció: NO exige TRM', not public.p63_requiere_trm(233301));
  update public.empaquetados set compra_fin = null, destino_id = 233011 where id = 233508;
  perform t233.afirma('B24 (descartada) el destino aéreo de la fuente no está permitido: NO exige TRM', not public.p63_requiere_trm(233301));
  update public.empaquetados set destino_id = 233010, tarifa_para_empaquetar = 300 where id = 233508;
  perform t233.afirma('B25 (descartada) la copia de la salida quedó vieja (cambió R): NO exige TRM', not public.p63_requiere_trm(233301));
  update public.empaquetados set tarifa_para_empaquetar = 290 where id = 233508;
  perform t233.afirma('B26 restaurada la fuente, vuelve a aportar y exige TRM', public.p63_requiere_trm(233301));
  update public.empaquetados set destino_id = 233011 where id = 233508;
  update public.armado_paquetes set destinos_aereos_alternativos = true where id = 233301;
  insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id) values (233301, 233011);
  perform t233.afirma('B27 con el destino alternativo permitido (#67) la vinculada vuelve a aportar', public.p63_requiere_trm(233301));
  delete from public.armado_paquete_destinos_aereos where paquete_id = 233301;
  update public.armado_paquetes set destinos_aereos_alternativos = false where id = 233301;
  update public.empaquetados set destino_id = 233010 where id = 233508;
  delete from public.salidas_dinamicas where id = v_id;
end $$;

-- Publicar con una salida USD descartada y SIN TRM: se permite (no aporta); con la salida vigente, se niega.
do $$
declare v_id bigint; v_r text;
begin
  insert into public.salidas_dinamicas (paquete_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, aplica_mk, ta, moneda, compra_fin)
    values (233301, current_date + 80, current_date + 83, 'X', 'A', 250, false, 0, 'USD', current_date - 1) returning id into v_id;
  v_r := t233.publicar(233301, 'oper');
  perform t233.afirma('B28 publicar sin TRM con una salida USD descartada (compra vencida): publica', v_r = 'true', v_r);
  update public.salidas_dinamicas set compra_fin = null where id = v_id;
  v_r := t233.publicar(233301, 'oper');
  perform t233.afirma('B29 la misma salida vigente exige TRM: se niega (p63_trm_requerida)', v_r like 'ERR%p63_trm_requerida%', v_r);
  delete from public.salidas_dinamicas where id = v_id;
end $$;

-- ═ C · publicar_tarifario_resultado_63 ═══════════════════════════════════════════════════
do $$
declare v_r text; v_trm numeric;
begin
  v_r := t233.publicar(233301, 'oper');
  perform t233.afirma('C1 todo COP SIN TRM publica (devuelve true)', v_r = 'true', v_r);
  select trm into v_trm from public.tarifario_oferta_63 where paquete_id = 233301;
  perform t233.afirma('C2 la publicación guarda trm NULL (nunca 1)', exists (select 1 from public.tarifario_oferta_63 where paquete_id = 233301) and v_trm is null);
  v_r := t233.publicar(233304, 'oper');
  perform t233.afirma('C3 otro paquete todo COP sin TRM también publica', v_r = 'true', v_r);
  insert into public.armado_servicios (paquete_id, servicio_id) values (233304, 233651);
  v_r := t233.publicar(233304, 'oper');
  perform t233.afirma('C4 con un servicio USD y SIN TRM se niega con p63_trm_requerida', v_r like 'ERR%p63_trm_requerida%', v_r);
  v_r := t233.publicar(233304, 'oper', '4000');
  perform t233.afirma('C5 enviar una TRM que el paquete no tiene descarta la publicación (false)', v_r = 'false', v_r);
  update public.armado_paquetes set trm_oferta = 4000 where id = 233304;
  v_r := t233.publicar(233304, 'oper', '4000');
  perform t233.afirma('C6 con la TRM configurada y USD publica', v_r = 'true', v_r);
  perform t233.afirma('C7 y guarda esa TRM', (select trm from public.tarifario_oferta_63 where paquete_id = 233304) = 4000);
  v_r := t233.publicar(233304, 'oper', 'null');
  perform t233.afirma('C8 la TRM del paquete (4000) distinta de la enviada (null) descarta (false)', v_r = 'false', v_r);
  v_r := t233.publicar(233304, 'oper', '-5');
  perform t233.afirma('C9 una TRM negativa se rechaza', v_r like 'ERR%', v_r);
  v_r := t233.publicar(233304, 'oper', '4000', 'USD');
  perform t233.afirma('C10 el modo 63 sigue publicando solo en COP', v_r like 'ERR%publica en COP%', v_r);
  v_r := t233.publicar(233301, 'vent');
  perform t233.afirma('C11 un rol sin permiso (venta) no publica', v_r like 'ERR%rol sin permiso%', v_r);
  v_r := t233.q('select public.publicar_tarifario_resultado_63(233301, 1, 1, ''COP'', ''[]''::jsonb, ''cop_trm_63'', null)::text', null, 'anon');
  perform t233.afirma('C12 anon no ejecuta la publicación', v_r like 'ERR%', v_r);
  delete from public.armado_servicios where paquete_id = 233304 and servicio_id = 233651;
  update public.armado_paquetes set trm_oferta = null where id = 233304;
end $$;

-- ═ D · invalidación ══════════════════════════════════════════════════════════════════════
do $$
declare r0 bigint; r1 bigint;
begin
  r0 := t233.rev(233303);
  update public.armado_paquetes set moneda_publicacion = 'USD' where id = 233303;
  r1 := t233.rev(233303);
  perform t233.afirma('D1 cambiar la moneda de publicación sube la revisión de fuente (invalida)', r1 > r0, r0 || ' → ' || r1);
  perform t233.afirma('D2 y bloquea el snapshot', (select tarifario_snapshot_publicable from public.armado_paquetes where id = 233303) is not true);
  update public.armado_paquetes set moneda_publicacion = 'USD' where id = 233303;
  perform t233.afirma('D3 reescribir el mismo valor NO invalida', t233.rev(233303) = r1);
  update public.armado_paquetes set moneda_publicacion = 'COP' where id = 233303;
  r0 := t233.rev(233301);
  update public.hoteles set moneda = 'USD' where id = 233600;
  r1 := t233.rev(233301);
  perform t233.afirma('D4 la moneda de un hotel del paquete sube la revisión (invalida lo cotizado)', r1 > r0, r0 || ' → ' || r1);
  update public.hoteles set moneda = 'COP' where id = 233600;
  r0 := t233.rev(233301);
  update public.servicios_adicionales set moneda = 'USD' where id = 233650;
  perform t233.afirma('D5 la moneda de un servicio del paquete sube la revisión', t233.rev(233301) > r0);
  update public.servicios_adicionales set moneda = 'COP' where id = 233650;
  r0 := t233.rev(233301);
  update public.armado_paquetes set trm_oferta = 3900 where id = 233301;
  perform t233.afirma('D6 configurar una TRM sube la revisión', t233.rev(233301) > r0);
  update public.armado_paquetes set trm_oferta = null where id = 233301;
end $$;

-- ═ E · cotizar y aceptar sin TRM ═════════════════════════════════════════════════════════
create function t233.t0(p_paquete bigint) returns jsonb language sql stable as $$
  select jsonb_build_object('rev_fuente', tarifario_revision_fuente, 'rev_publicada', tarifario_revision_publicada,
                            'gen_publicada', tarifario_generacion_publicada, 'rev_costos', p63_rev_costos)
    from public.armado_paquetes where id = p_paquete
$$;

create function t233.snap(p_paquete bigint, p_trm numeric, p_cxp jsonb default null) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'v', 1, 'paquete_id', p_paquete, 'salida_id', (select id from public.salidas_dinamicas where paquete_id = p_paquete order by id limit 1),
    'empaquetado_id', 233507, 'trm', p_trm, 'moneda', 'COP',
    'cabecera', jsonb_build_object('tipo_paquete', 'dinamico', 'moneda', 'COP', 'fecha_salida', (current_date + 60)::text,
        'fecha_regreso', (current_date + 63)::text, 'pax', 2, 'destino', 'T233 CARTAGENA', 'hotel', 'T233 HOTEL COP',
        'precio_venta', 3360000, 'impuesto', 2260000, 'costo_aereo', 2080500, 'aerolinea', 'AEROTEST',
        'plan_nombre', 'ESTANDAR · PC', 'paquete_armado_id', p_paquete, 'n_tramos', 2, 'n_items', 1, 'n_hoteles', 1,
        'tipo_asesor', 'interno', 'canal', 'B2C'),
    'b2b', null, 'vigencias', '[]'::jsonb,
    'financiero', jsonb_build_object(
      'costos', jsonb_build_object('costo_hotel', 840000, 'costo_aereo', 2080500),
      'cxp', coalesce(p_cxp, jsonb_build_array(
        jsonb_build_object('obligacion', 'aereo:0', 'tipo_proveedor', 'aereo', 'proveedor', 'AEROTEST', 'servicio', 'Aéreo AEROTEST',
          'valor_total', 2080500, 'moneda', 'COP', 'valor_cop', 2080500, 'trm', p_trm, 'aplica_retencion', false, 'pct_retencion', 0,
          'observaciones', 'Generado automáticamente desde el tarifario', 'servicio_id', null),
        jsonb_build_object('obligacion', 'hotel:0', 'tipo_proveedor', 'hotel', 'proveedor', 'T233 PROV', 'servicio', 'Hotel T233',
          'valor_total', 840000, 'moneda', 'COP', 'valor_cop', 840000, 'trm', p_trm, 'aplica_retencion', false, 'pct_retencion', 0,
          'observaciones', 'Generado automáticamente desde el tarifario', 'servicio_id', null)))))
$$;

create function t233.cotizar(p_paquete bigint, p_trm numeric, p_h text default 'h1', p_cxp jsonb default null, p_t0 jsonb default null) returns text language plpgsql as $$
declare v_cot jsonb; v_snap jsonb;
begin
  v_snap := t233.snap(p_paquete, p_trm, p_cxp);
  v_cot := jsonb_build_object('tenant', 'mayorista', 'payload', jsonb_build_object('x', 1), 'detalle', '{}'::jsonb, 'cliente', 'Cliente 233',
    'destino', 'T233 CARTAGENA', 'hotel', 'T233 HOTEL COP', 'modulo', 'dinamico', 'plan_nombre', 'ESTANDAR · PC', 'pax', 2, 'precio_venta', 3360000,
    'moneda', 'COP', 'fecha_salida', (current_date + 60)::text, 'fecha_regreso', (current_date + 63)::text, 'vigencia_hasta', (current_date + 1)::text,
    'paquete_armado_id', p_paquete, 'asesor', 'Asesor 233', 'creado_por', 'c233@x.test');
  return t233.try(format('select public.crear_cotizacion_oferta_63(%L::uuid, ''mayorista'', %L::jsonb, %L::jsonb, %L, %L, %L::jsonb)::text',
    t233.u('vent'), v_cot::text, v_snap::text, p_h, 'f1', coalesce(p_t0, t233.t0(p_paquete))::text));
end $$;

create function t233.aceptar(p_cot text, p_h text default 'h1') returns text language plpgsql as $$
begin
  return t233.try(format('select public.aceptar_oferta_63(%s, ''mayorista'', %L::uuid, %L, ''f1'')::text', p_cot, t233.u('vent'), p_h));
end $$;

do $$
declare v_cot text; v_a text; v_j jsonb;
begin
  -- E1-E3: oferta todo COP, sin TRM, de punta a punta.
  perform t233.publicar(233301, 'oper');
  v_cot := t233.cotizar(233301, null);
  perform t233.afirma('E1 cotizar SIN TRM (todo COP) crea la cotización y su oferta', v_cot ~ '^[0-9]+$', v_cot);
  perform t233.afirma('E2 la oferta privada guarda trm NULL', (select trm from public.p63_oferta where cotizacion_id = v_cot::bigint) is null
    and exists (select 1 from public.p63_oferta where cotizacion_id = v_cot::bigint));
  v_a := t233.aceptar(v_cot);
  perform t233.afirma('E3 aceptar la oferta sin TRM reserva el número y congela el snapshot', v_a like '%numero_contrato%', v_a);

  -- E4: cotizar con USD y sin TRM se rechaza.
  insert into public.armado_servicios (paquete_id, servicio_id) values (233301, 233651);
  v_cot := t233.cotizar(233301, null);
  perform t233.afirma('E4 con un servicio USD y sin TRM no se puede cotizar (p63_trm_requerida)', v_cot like 'ERR%p63_trm_requerida%', v_cot);
  delete from public.armado_servicios where paquete_id = 233301 and servicio_id = 233651;
  perform t233.publicar(233301, 'oper');

  -- E5: oferta cotizada sin TRM; luego un hotel pasa a USD → no se acepta.
  v_cot := t233.cotizar(233301, null, 'h2');
  perform t233.afirma('E5a (precondición) segunda oferta sin TRM cotizada', v_cot ~ '^[0-9]+$', v_cot);
  update public.hoteles set moneda = 'USD' where id = 233600;
  v_a := t233.aceptar(v_cot, 'h2');
  perform t233.afirma('E5 cambio COP→USD después de cotizar: la oferta NO se acepta (p63_oferta_cambio)', v_a like 'ERR%p63_oferta_cambio%', v_a);
  update public.hoteles set moneda = 'COP' where id = 233600;
  perform t233.publicar(233301, 'oper');

  -- E6: oferta sin TRM; luego se configura una TRM → no se acepta.
  v_cot := t233.cotizar(233301, null, 'h3');
  update public.armado_paquetes set trm_oferta = 4100 where id = 233301;
  v_a := t233.aceptar(v_cot, 'h3');
  perform t233.afirma('E6 configurar una TRM después de cotizar sin ella: la oferta NO se acepta', v_a like 'ERR%p63_oferta_cambio%', v_a);
  update public.armado_paquetes set trm_oferta = null where id = 233301;
  perform t233.publicar(233301, 'oper');

  -- E7: cotizar SIN TRM en el snapshot mientras el paquete SÍ tiene una → "cambiaron mientras se cotizaba".
  update public.armado_paquetes set trm_oferta = 4100 where id = 233301;
  v_cot := t233.cotizar(233301, null, 'h4');
  perform t233.afirma('E7 el snapshot sin TRM no coincide con un paquete que tiene TRM', v_cot like 'ERR%p63_oferta_cambio%', v_cot);
  update public.armado_paquetes set trm_oferta = null where id = 233301;
  perform t233.publicar(233301, 'oper');

  -- E8: una TRM no positiva en el snapshot se rechaza.
  v_cot := t233.cotizar(233301, 0);
  perform t233.afirma('E8 una TRM cero en el snapshot se rechaza', v_cot like 'ERR%p63_invalida%', v_cot);
end $$;

-- E9: una salida MANUAL vigente pasa de COP a USD DESPUÉS de cotizar sin TRM → la oferta no se acepta (protección de la oferta obsoleta).
do $$
declare v_cot text; v_a text; v_sal bigint;
begin
  insert into public.salidas_dinamicas (paquete_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, aplica_mk, ta, moneda)
    values (233301, current_date + 90, current_date + 93, 'MDE - MIA', 'AEROTEST', 1000000, false, 0, 'COP') returning id into v_sal;
  perform t233.publicar(233301, 'oper');
  v_cot := t233.cotizar(233301, null, 'hE9');
  perform t233.afirma('E9a (precondición) con la salida manual en COP se cotiza sin TRM', v_cot ~ '^[0-9]+$', v_cot);
  update public.salidas_dinamicas set moneda = 'USD' where id = v_sal;
  v_a := t233.aceptar(v_cot, 'hE9');
  perform t233.afirma('E9 la salida pasó de COP a USD después de cotizar: la oferta NO se acepta (p63_oferta_cambio)', v_a like 'ERR%p63_oferta_cambio%', v_a);
  perform t233.afirma('E9b y el paquete ya exige TRM para volver a publicar o cotizar', public.p63_requiere_trm(233301));
  v_cot := t233.cotizar(233301, null, 'hE9b');
  perform t233.afirma('E9c cotizar de nuevo sin TRM se rechaza (p63_trm_requerida)', v_cot like 'ERR%p63_trm_requerida%', v_cot);
  -- Una salida que pasa a USD pero está DESCARTADA (inactiva) no exige TRM aunque la oferta anterior igual quedó obsoleta.
  update public.salidas_dinamicas set activo = false where id = v_sal;
  perform t233.afirma('E9d con la salida USD inactiva (descartada) el paquete vuelve a no exigir TRM', not public.p63_requiere_trm(233301));
  delete from public.salidas_dinamicas where id = v_sal;
  perform t233.publicar(233301, 'oper');
end $$;

-- ═ F · obligaciones aceptadas sin TRM ═════════════════════════════════════════════════════
create function t233.cabecera(p_numero text, p_acep bigint, p_paquete bigint) returns text language plpgsql as $$
begin
  return t233.try(format($f$insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, fecha_salida, fecha_regreso, pax, hotel, destino,
      precio_venta, impuesto, costo_aereo, aerolinea, estado, financiero_estado, plan_nombre, paquete_armado_id, aceptacion_63_id, tipo_asesor, canal)
    values (%L, 'mayorista', 'Cliente 233', 'dinamico', 'COP', current_date + 60, current_date + 63, 2, 'T233 HOTEL COP', 'T233 CARTAGENA',
      3360000, 2260000, 2080500, 'AEROTEST', 'pendiente', 'pendiente', 'ESTANDAR · PC', %s, %s, 'interno', 'B2C') returning 'OK'$f$, p_numero, p_paquete, p_acep));
end $$;

create function t233.hijos(p_numero text) returns void language plpgsql as $$
begin
  insert into public.contrato_vuelos (numero_contrato) select p_numero from generate_series(1, 2);
  insert into public.contrato_items (numero_contrato, descripcion) values (p_numero, 'item');
  insert into public.contrato_hoteles (numero_contrato, nombre) values (p_numero, 'T233 HOTEL COP');
end $$;

create function t233.pendiente(p_acep bigint, p_numero text) returns text language plpgsql as $$
declare v_der jsonb := public.p63_financiero_derivado(p_acep);
begin
  return t233.try(format($f$insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values (%L, 'mayorista', %L::jsonb, %L::jsonb) returning 'OK'$f$,
    p_numero, (v_der->'costos')::text, (v_der->'cxp')::text));
end $$;

create function t233.finalizar(p_acep bigint, p_numero text) returns text language plpgsql as $$
declare v_der jsonb := public.p63_financiero_derivado(p_acep);
begin
  return t233.try(format($f$select public.registrar_financiero_contrato(%L, 'mayorista', %L::jsonb, %L::jsonb)::text$f$,
    p_numero, (v_der->'costos')::text, (v_der->'cxp')::text));
end $$;

do $$
declare v_cot text; v_a jsonb; v_acep bigint; v_num text; v_r text; v_cxp jsonb;
begin
  perform t233.publicar(233301, 'oper');
  -- F1-F4: oferta todo COP sin TRM → contrato completo con CxP sin TRM.
  v_cot := t233.cotizar(233301, null, 'hF1');
  v_a := (t233.aceptar(v_cot, 'hF1'))::jsonb;
  v_acep := (v_a ->> 'aceptacion_id')::bigint; v_num := v_a ->> 'numero_contrato';
  v_r := t233.cabecera(v_num, v_acep, 233301);
  perform t233.afirma('F1 la cabecera del contrato aceptado sin TRM se inserta', v_r = 'OK', v_r);
  perform t233.hijos(v_num);
  v_r := t233.pendiente(v_acep, v_num);
  perform t233.afirma('F2 el payload aceptado se guarda como pendiente', v_r = 'OK', v_r);
  v_r := t233.finalizar(v_acep, v_num);
  perform t233.afirma('F3 la RPC financiera escribe las obligaciones COP sin TRM', v_r like '%creadas%', v_r);
  perform t233.afirma('F4 las CxP quedan con trm_63 NULL y valor_cop_63 = valor_total (COP)',
    (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num and trm_63 is null and moneda = 'COP' and valor_cop_63 = valor_total and aceptacion_63_id = v_acep) = 2);
  perform t233.afirma('F5 la aceptación queda completa', (select estado from public.p63_aceptacion where id = v_acep) = 'completa');

  -- F6-F8: una oferta aceptada SIN TRM que trae una obligación en USD se rechaza (no hay con qué convertirla).
  v_cxp := jsonb_build_array(jsonb_build_object('obligacion', 'hotel:0', 'tipo_proveedor', 'hotel', 'proveedor', 'T233 PROV', 'servicio', 'Hotel T233',
          'valor_total', 210, 'moneda', 'USD', 'valor_cop', 840000, 'trm', null, 'aplica_retencion', false, 'pct_retencion', 0,
          'observaciones', 'Generado automáticamente desde el tarifario', 'servicio_id', null));
  v_cot := t233.cotizar(233301, null, 'hF2', v_cxp);
  v_a := (t233.aceptar(v_cot, 'hF2'))::jsonb;
  v_acep := (v_a ->> 'aceptacion_id')::bigint; v_num := v_a ->> 'numero_contrato';
  perform t233.cabecera(v_num, v_acep, 233301);
  perform t233.hijos(v_num);
  perform t233.pendiente(v_acep, v_num);
  v_r := t233.finalizar(v_acep, v_num);
  perform t233.afirma('F6 una obligación USD en una oferta sin TRM se rechaza al escribir lo financiero', v_r like 'ERR%está en USD y la oferta aceptada no tiene TRM%', v_r);
  perform t233.afirma('F7 no queda ninguna CxP de ese intento', (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num) = 0);
end $$;

-- Contrato simple (sin aceptación #63) que cuelga las CxP de las pruebas de CHECK.
insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, estado, financiero_estado)
values ('DTM-9331', 'mayorista', 'Cliente 233', 'dinamico', 'COP', 'pendiente', 'pendiente');

do $$
declare v_m text;
begin
  v_m := t233.msg($q$insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, valor_total, moneda, valor_cop_63) values ('DTM-9331', 'mayorista', 'P', 'hotel', 's', 100, 'COP', 100)$q$);
  perform t233.afirma('F8 CHECK: equivalente sin TRM válido solo si es COP e igual al valor', v_m = 'OK', v_m);
  v_m := t233.msg($q$insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, valor_total, moneda, valor_cop_63) values ('DTM-9331', 'mayorista', 'P', 'hotel', 's', 100, 'USD', 100)$q$);
  perform t233.afirma('F9 CHECK: un equivalente sin TRM en una obligación USD se rechaza', v_m like '23514%', v_m);
  v_m := t233.msg($q$insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, valor_total, moneda, valor_cop_63) values ('DTM-9331', 'mayorista', 'P', 'hotel', 's', 100, 'COP', 90)$q$);
  perform t233.afirma('F10 CHECK: un equivalente sin TRM distinto del valor se rechaza', v_m like '23514%', v_m);
  v_m := t233.msg($q$insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, valor_total, moneda, trm_63) values ('DTM-9331', 'mayorista', 'P', 'hotel', 's', 100, 'USD', 4000)$q$);
  perform t233.afirma('F11 CHECK: una TRM sin equivalente se rechaza', v_m like '23514%', v_m);
  v_m := t233.msg($q$insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, valor_total, moneda, valor_cop_63, trm_63) values ('DTM-9331', 'mayorista', 'P', 'hotel', 's', 100, 'USD', 400000, 4000)$q$);
  perform t233.afirma('F12 CHECK: obligación USD con TRM y equivalente (el modo 63 de siempre) válida', v_m = 'OK', v_m);
  v_m := t233.msg($q$insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, valor_total, moneda) values ('DTM-9331', 'mayorista', 'P', 'hotel', 's', 100, 'USD')$q$);
  perform t233.afirma('F13 una obligación de siempre (sin equivalente ni TRM) sigue válida', v_m = 'OK', v_m);
end $$;

-- ═ G · el mundo 63 con TRM sigue igual ═════════════════════════════════════════════════
do $$
declare v_r text; v_cot text;
begin
  v_r := t233.publicar(233302, 'oper', '4000');
  perform t233.afirma('G1 un paquete con hotel USD y TRM publica como antes', v_r = 'true', v_r);
  v_r := t233.publicar(233302, 'oper', 'null');
  perform t233.afirma('G2 si el paquete tiene TRM y se envía null, se descarta (false)', v_r = 'false', v_r);
  v_cot := t233.cotizar(233302, 4000, 'hG1', jsonb_build_array(
    jsonb_build_object('obligacion', 'hotel:0', 'tipo_proveedor', 'hotel', 'proveedor', 'T233 PROV', 'servicio', 'Hotel T233 USD',
      'valor_total', 210, 'moneda', 'USD', 'valor_cop', 840000, 'trm', 4000, 'aplica_retencion', false, 'pct_retencion', 0,
      'observaciones', 'Generado automáticamente desde el tarifario', 'servicio_id', null)));
  perform t233.afirma('G3 cotizar con TRM y USD funciona como antes', v_cot ~ '^[0-9]+$', v_cot);
  perform t233.afirma('G4 la oferta guarda la TRM', (select trm from public.p63_oferta where cotizacion_id = v_cot::bigint) = 4000);
  update public.armado_paquetes set trm_oferta = null where id = 233302;
  perform t233.afirma('G5 quitar la TRM de un paquete con USD sube la revisión (invalida lo cotizado)',
    (select tarifario_snapshot_publicable from public.armado_paquetes where id = 233302) is not true);
end $$;

-- ═ Z · conclusión ═══════════════════════════════════════════════════════════════════════
do $$
declare v_total int; v_ok int;
begin
  select count(*), count(*) filter (where ok) into v_total, v_ok from t233.res;
  perform t233.afirma('Z1 la batería ejecutó todas sus secciones (A-G)', v_total >= 60, 'afirmaciones: ' || v_total);
  select count(*), count(*) filter (where ok) into v_total, v_ok from t233.res;
  if v_ok <> v_total then
    raise exception 'TEST 233 SQL: % de % afirmaciones fallaron', v_total - v_ok, v_total;
  end if;
  raise notice 'TEST 233 SQL: TODO OK (% afirmaciones)', v_total;
end $$;

rollback;
