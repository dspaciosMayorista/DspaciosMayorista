-- ─────────────────────────────────────────────────────────────────────────
-- BATERÍA SQL · 234 (#90 · #63 · #93): modo de oferta con conversión por TRM TAMBIÉN publicando en USD. SOLO bases desechables.
-- Corre en UNA transacción que termina en ROLLBACK, sobre una base con 001-233 y la 234 aplicada.
-- Uso:  psql -X -q -v ON_ERROR_STOP=1 -f test_234_oferta_usd.sql      Cierre esperado: "TEST 234 SQL: TODO OK".
--
--   A  esquema: el modo 63 admite moneda_publicacion USD; los CHECK que siguen vigentes
--   B  p63_requiere_trm: en USD solo si hay fuentes en COP (todo USD no la exige); en COP la regla de la 233 no cambia; ACL
--   C  publicar_tarifario_resultado_63: USD con todo USD publica SIN TRM; con fuentes COP sin TRM se niega; moneda distinta de la elegida se descarta
--   D  cotizar USD→USD (con y sin TRM), COP→USD y USD→COP: snapshot/cabecera/cotización en la misma moneda; COP→USD sin TRM no se cotiza
--   E  aceptar: moneda, TRM, fuente (tarifa, fee, record, inactiva, destino) cambiadas tras cotizar protegen la oferta
--   F  recorrido hasta contrato y CxP en USD: cabecera, hijos, pendiente, RPC financiera, CxP con equivalente COP a la TRM congelada;
--      oferta USD sin TRM: la TRM provisional INGRESADA al convertir es OBLIGATORIA (sin respaldo en trm_referencia), se congela AL ACEPTAR,
--      antes de cualquier CxP/asiento, y no se mueve después; sin ella (también con la llamada de 5 argumentos) no se reserva número
--   G  regresión: la oferta en COP (con y sin TRM) sigue igual
--   Z  conclusión: las pruebas fueron concluyentes
-- ─────────────────────────────────────────────────────────────────────────
begin;

create schema t234;
create table t234.res (nombre text, ok boolean, detalle text);

create function t234.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void
language plpgsql as $$
begin
  insert into t234.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre;
  else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;

create function t234.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000234' || case p_k
    when 'super' then '001' when 'gere' then '002' when 'admi' then '003' when 'oper' then '004'
    when 'vent' then '006' else '999' end)::uuid
$$;

-- Ejecuta UNA consulta que devuelve un texto como el usuario `p_k` (NULL = sin sesión) con el rol de Postgres `p_rol`.
create function t234.q(p_sql text, p_k text, p_rol text default 'authenticated') returns text
language plpgsql as $$
declare v_res text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_k is null then '' else json_build_object('sub', t234.u(p_k), 'role', p_rol)::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(t234.u(p_k)::text, ''), true);
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

create function t234.msg(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function t234.try(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, 'OK');
exception when others then
  return 'ERR ' || sqlstate || ' ' || sqlerrm;
end $$;

insert into auth.users (id, email)
select t234.u(k), 'c234-' || k || '@x.test' from unnest(array['super','gere','admi','oper','vent']) k on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t234.u(v.k), 'c234-' || v.k || '@x.test', 'C234 ' || v.k, v.r::rol_usuario, true, 'mayorista'
from (values ('super','superadmin'), ('gere','gerencia'), ('admi','administracion'), ('oper','operaciones'), ('vent','venta')) v(k, r)
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (234010, 'T234 CARTAGENA', 'CTG', 'Colombia', true), (234011, 'T234 SANTA MARTA', 'SMR', 'Colombia', true);
insert into public.proveedores (id, nombre, aplica_retencion, pct_retencion) values (234700, 'T234 PROV', false, 0);
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) values
  (234600, 234010, 'T234 HOTEL COP', 234700, 'COP'),
  (234601, 234010, 'T234 HOTEL USD', 234700, 'USD');
insert into public.servicios_adicionales (id, nombre, proveedor_id, moneda) values (234650, 'T234 TOUR COP', 234700, 'COP'), (234651, 'T234 TOUR USD', 234700, 'USD');
-- Empaquetados sin record: 234507 en COP (R 1.130.000 / N 1.000.000 / F 80.500) y 234508 en USD (R 290 / N 250 / F 20).
insert into public.empaquetados (id, record, aerolinea, ruta, destino_id, fecha_ida, fecha_regreso, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo, proveedor_id, moneda) values
  (234507, null, 'AEROTEST', 'BOG - CTG - BOG', 234010, current_date + 60, current_date + 63, 1000000, 1130000, 80500, true, 234700, 'COP'),
  (234508, null, 'AEROTEST', 'MDE - CTG - MDE', 234010, current_date + 61, current_date + 64, 250, 290, 20, true, 234700, 'USD'),
  (234509, 'ZZZ999', 'AEROTEST', 'CLO - CTG - CLO', 234010, current_date + 62, current_date + 65, 250, 290, 20, true, 234700, 'USD');

-- Paquetes Dinámico en modo 63:
--   234301 COP + TRM 4000 + vinculada USD (USD→COP)        234302 USD + TRM 4000 + vinculada USD (USD→USD)
--   234303 USD + TRM 4000 + vinculada COP (COP→USD)        234304 COP sin TRM, todo COP (como antes)
--   234305 USD SIN TRM (aunque todo sea USD)                234306 legacy
--   234307 USD sin TRM con TODO en COP (hotel, servicio y vuelo)
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id, modo_oferta, trm_oferta, moneda_publicacion) values
  (234301, 'T234 COP con vinculada USD', 'dinamico', true, 234010, 'cop_trm_63', 4000, 'COP'),
  (234302, 'T234 USD con vinculada USD', 'dinamico', true, 234010, 'cop_trm_63', 4000, 'USD'),
  (234303, 'T234 USD con vinculada COP', 'dinamico', true, 234010, 'cop_trm_63', 4000, 'USD'),
  (234304, 'T234 COP sin TRM', 'dinamico', true, 234010, 'cop_trm_63', null, 'COP'),
  (234305, 'T234 USD sin TRM', 'dinamico', true, 234010, 'cop_trm_63', null, 'USD'),
  (234306, 'T234 legacy', 'dinamico', true, 234010, 'legacy', null, 'COP'),
  (234307, 'T234 USD sin TRM con todo en COP', 'dinamico', true, 234010, 'cop_trm_63', null, 'USD');
select setval(pg_get_serial_sequence('public.armado_paquetes', 'id'), greatest((select max(id) from public.armado_paquetes), 234307));

insert into public.armado_hoteles (paquete_id, hotel_id) values (234301, 234601), (234302, 234601), (234303, 234601), (234304, 234600), (234305, 234601), (234307, 234600);
insert into public.armado_servicios (paquete_id, servicio_id) values (234301, 234651), (234302, 234651), (234303, 234650), (234304, 234650), (234305, 234651), (234307, 234650);
insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, fee_infante, aplica_mk, ta, moneda) values
  (234301, 234508, current_date + 61, current_date + 64, 'MDE - CTG - MDE', 'AEROTEST', 290, 20, false, 0, 'USD'),
  (234302, 234508, current_date + 61, current_date + 64, 'MDE - CTG - MDE', 'AEROTEST', 290, 20, false, 0, 'USD'),
  (234303, 234507, current_date + 60, current_date + 63, 'BOG - CTG - BOG', 'AEROTEST', 1130000, 80500, false, 0, 'COP'),
  (234304, 234507, current_date + 60, current_date + 63, 'BOG - CTG - BOG', 'AEROTEST', 1130000, 80500, false, 0, 'COP'),
  (234305, 234508, current_date + 61, current_date + 64, 'MDE - CTG - MDE', 'AEROTEST', 290, 20, false, 0, 'USD'),
  (234307, 234507, current_date + 60, current_date + 63, 'BOG - CTG - BOG', 'AEROTEST', 1130000, 80500, false, 0, 'COP');

create function t234.publicar(p_paquete bigint, p_k text, p_trm text default 'null', p_moneda text default 'COP', p_modo text default 'cop_trm_63') returns text
language plpgsql as $$
declare v_gen bigint; v_rev bigint;
begin
  select tarifario_generacion, tarifario_revision_fuente into v_gen, v_rev from public.armado_paquetes where id = p_paquete;
  return t234.q(format('select public.publicar_tarifario_resultado_63(%s, %s, %s, %L, ''[]''::jsonb, %L, %s)::text', p_paquete, v_gen, v_rev, p_moneda, p_modo, p_trm), p_k);
end $$;

-- ═ A · esquema ═══════════════════════════════════════════════════════════════════════════
do $$
declare v_m text;
begin
  perform t234.afirma('A1 el CHECK que ataba el modo 63 a COP ya no existe',
    not exists (select 1 from pg_constraint where conrelid = 'public.armado_paquetes'::regclass and conname = 'armado_paquetes_modo63_moneda_chk'));
  perform t234.afirma('A2 un paquete en modo 63 con moneda_publicacion USD existe (fixture) y conserva COP/USD/NULL como únicos valores',
    (select count(*) from public.armado_paquetes where id in (234302, 234303, 234305) and modo_oferta = 'cop_trm_63' and moneda_publicacion = 'USD') = 3);
  v_m := t234.msg('update public.armado_paquetes set moneda_publicacion = ''EUR'' where id = 234302');
  perform t234.afirma('A3 moneda_publicacion fuera de (COP, USD) sigue rechazada', v_m like '23514%', v_m);
  v_m := t234.msg('update public.armado_paquetes set trm_oferta = 0 where id = 234302');
  perform t234.afirma('A4 una TRM cero sigue rechazada (nunca 1 ni 0 implícitas)', v_m like '23514%', v_m);
  v_m := t234.msg('update public.armado_paquetes set moneda_publicacion = null where id = 234302');
  perform t234.afirma('A5 NULL sigue siendo válido (paquetes anteriores a la 233: equivale a COP)', v_m = 'OK', v_m);
  update public.armado_paquetes set moneda_publicacion = 'USD' where id = 234302;
end $$;

-- ═ B · p63_requiere_trm ══════════════════════════════════════════════════════════════════
do $$
begin
  perform t234.afirma('B1 publicar en USD con TODO en USD (hotel, servicio y vuelo USD) NO exige TRM de publicación', not public.p63_requiere_trm(234302));
  perform t234.afirma('B2 publicar en USD con TODO en COP exige TRM (se convierte COP / TRM)', public.p63_requiere_trm(234307)
    and not exists (select 1 from public.armado_hoteles ah join public.hoteles h on h.id = ah.hotel_id where ah.paquete_id = 234307 and h.moneda = 'USD'));
  perform t234.afirma('B3 un paquete en USD sin TRM y todo en USD tampoco la requiere', not public.p63_requiere_trm(234305));
  perform t234.afirma('B3b basta UNA fuente en COP (el servicio) para exigirla en USD', public.p63_requiere_trm(234303));
  perform t234.afirma('B4 en COP con fuentes en USD sigue exigiendo TRM (regla de la 233)', public.p63_requiere_trm(234301));
  perform t234.afirma('B5 en COP con todo en COP sigue sin exigirla (regla de la 233)', not public.p63_requiere_trm(234304));
  perform t234.afirma('B6 p63_requiere_trm no la ejecuta anon ni authenticated',
    not has_function_privilege('anon', 'public.p63_requiere_trm(bigint)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.p63_requiere_trm(bigint)', 'EXECUTE'));
end $$;

-- ═ C · publicar_tarifario_resultado_63 ═══════════════════════════════════════════════════
do $$
declare v_r text;
begin
  v_r := t234.publicar(234302, 'oper', '4000', 'USD');
  perform t234.afirma('C1 USD con TRM y moneda USD publica', v_r = 'true', v_r);
  perform t234.afirma('C2 el snapshot publicado queda en USD', (select moneda from public.armado_paquetes where id = 234302) = 'USD');
  perform t234.afirma('C3 la oferta publicada guarda la TRM congelada', (select trm from public.tarifario_oferta_63 where paquete_id = 234302) = 4000);
  v_r := t234.publicar(234302, 'oper', '4000', 'COP');
  perform t234.afirma('C4 publicar en COP un paquete que eligió USD se descarta (false), no se publica en otra moneda', v_r = 'false', v_r);
  v_r := t234.publicar(234301, 'oper', '4000', 'USD');
  perform t234.afirma('C5 publicar en USD un paquete que eligió COP se descarta (false)', v_r = 'false', v_r);
  v_r := t234.publicar(234305, 'oper', 'null', 'USD');
  perform t234.afirma('C6 USD con TODO en USD y sin TRM publica (nada que convertir)', v_r = 'true', v_r);
  perform t234.afirma('C6b esa publicación queda sin TRM (nunca 1) y en USD', (select trm from public.tarifario_oferta_63 where paquete_id = 234305) is null
    and (select moneda from public.armado_paquetes where id = 234305) = 'USD');
  v_r := t234.publicar(234302, 'oper', 'null', 'USD');
  perform t234.afirma('C7 si el paquete tiene TRM y se envía null se descarta (false)', v_r = 'false', v_r);
  v_r := t234.publicar(234307, 'oper', 'null', 'USD');
  perform t234.afirma('C7b USD con todo en COP y sin TRM se niega (p63_trm_requerida): nunca se convierte "a 1"', v_r like 'ERR%p63_trm_requerida%', v_r);
  v_r := t234.publicar(234302, 'oper', '4000', 'EUR');
  perform t234.afirma('C8 una moneda fuera de (COP, USD) se rechaza', v_r like 'ERR%debe ser COP o USD%', v_r);
  v_r := t234.publicar(234302, 'oper', '0', 'USD');
  perform t234.afirma('C9 una TRM cero se rechaza (nunca 1 ni 0)', v_r like 'ERR%TRM debe ser positiva%', v_r);
  v_r := t234.publicar(234302, 'vent', '4000', 'USD');
  perform t234.afirma('C10 un rol sin permiso no publica', v_r like 'ERR%rol sin permiso%', v_r);
  v_r := t234.publicar(234302, null, '4000', 'USD', 'cop_trm_63');
  perform t234.afirma('C11 sin sesión no publica', v_r like 'ERR%', v_r);
  v_r := t234.publicar(234304, 'oper');
  perform t234.afirma('C12 regresión: todo COP, sin TRM, en COP publica como antes', v_r = 'true', v_r);
  perform t234.afirma('C13 regresión: esa publicación queda sin TRM', (select trm from public.tarifario_oferta_63 where paquete_id = 234304) is null);
  v_r := t234.publicar(234301, 'oper', '4000', 'COP');
  perform t234.afirma('C14 regresión: COP con fuente USD y TRM publica como antes (USD→COP)', v_r = 'true', v_r);
  v_r := t234.publicar(234303, 'oper', '4000', 'USD');
  perform t234.afirma('C15 COP→USD: una vinculada en COP en un paquete USD con TRM publica', v_r = 'true', v_r);
  perform t234.afirma('C16 modo legacy no entra por este publicador', t234.publicar(234306, 'oper', 'null', 'COP', 'legacy') like 'ERR%p_modo debe ser cop_trm_63%');
end $$;

-- ═ D · cotizar ════════════════════════════════════════════════════════════════════════════
create function t234.t0(p_paquete bigint) returns jsonb language sql stable as $$
  select jsonb_build_object('rev_fuente', tarifario_revision_fuente, 'rev_publicada', tarifario_revision_publicada,
                            'gen_publicada', tarifario_generacion_publicada, 'rev_costos', p63_rev_costos)
    from public.armado_paquetes where id = p_paquete
$$;

-- Snapshot del escenario `p_esc`:
--   'usd_usd' paquete 234302, vuelo USD 234508 · 'cop_usd' paquete 234303, vuelo COP 234507 · 'usd_cop' paquete 234301 (COP), vuelo USD 234508
--   'cop_cop' paquete 234304, vuelo COP 234507 (sin TRM)
create function t234.snap(p_esc text, p_trm numeric default null, p_mon text default null, p_cxp jsonb default null) returns jsonb language plpgsql stable as $$
declare
  v_paq bigint; v_emp bigint; v_mon text; v_trm numeric;
  v_precio numeric; v_imp numeric; v_aereo numeric; v_costos jsonb; v_cxp jsonb;
begin
  if p_esc = 'usd_usd' then v_paq := 234302; v_emp := 234508; v_mon := 'USD'; v_trm := 4000; v_precio := 1200; v_imp := 580; v_aereo := 500;
  elsif p_esc = 'cop_usd' then v_paq := 234303; v_emp := 234507; v_mon := 'USD'; v_trm := 4000; v_precio := 1200; v_imp := 565; v_aereo := 500;
  elsif p_esc = 'usd_sintrm' then v_paq := 234305; v_emp := 234508; v_mon := 'USD'; v_trm := null; v_precio := 1200; v_imp := 580; v_aereo := 500;
  elsif p_esc = 'usd_cop' then v_paq := 234301; v_emp := 234508; v_mon := 'COP'; v_trm := 4000; v_precio := 4800000; v_imp := 2320000; v_aereo := 2000000;
  else v_paq := 234304; v_emp := 234507; v_mon := 'COP'; v_trm := null; v_precio := 3360000; v_imp := 2260000; v_aereo := 2000000; end if;
  v_mon := coalesce(p_mon, v_mon);
  v_trm := coalesce(p_trm, v_trm);
  if p_esc in ('cop_cop', 'usd_sintrm') and p_trm is null then v_trm := null; end if;
  v_costos := case v_mon when 'USD' then jsonb_build_object('costo_hotel', 400, 'costo_aereo', v_aereo)
                         else jsonb_build_object('costo_hotel', 1600000, 'costo_aereo', v_aereo) end;
  v_cxp := coalesce(p_cxp, jsonb_build_array(
    -- Aéreo: el costo de ORIGEN del vuelo (USD o COP) con su equivalente COP a la TRM congelada.
    jsonb_build_object('obligacion', 'aereo:0', 'tipo_proveedor', 'aereo', 'proveedor', 'AEROTEST', 'servicio', 'Aéreo AEROTEST',
      'valor_total', case when v_emp = 234508 then 500 else 2000000 end, 'moneda', case when v_emp = 234508 then 'USD' else 'COP' end,
      'valor_cop', case when v_trm is null and v_mon = 'USD' then null else 2000000 end, 'trm', v_trm, 'aplica_retencion', false, 'pct_retencion', 0,
      'observaciones', 'Generado automáticamente desde el tarifario', 'servicio_id', null),
    jsonb_build_object('obligacion', 'hotel:0', 'tipo_proveedor', 'hotel', 'proveedor', 'T234 PROV', 'servicio', 'Hotel T234',
      'valor_total', case when v_paq = 234304 then 1600000 else 400 end, 'moneda', case when v_paq = 234304 then 'COP' else 'USD' end,
      'valor_cop', case when v_trm is null and v_mon = 'USD' then null else 1600000 end, 'trm', v_trm, 'aplica_retencion', false, 'pct_retencion', 0,
      'observaciones', 'Generado automáticamente desde el tarifario', 'servicio_id', null)));
  return jsonb_build_object(
    'v', 1, 'paquete_id', v_paq, 'salida_id', (select id from public.salidas_dinamicas where paquete_id = v_paq order by id limit 1),
    'empaquetado_id', v_emp, 'trm', v_trm, 'moneda', v_mon,
    'cabecera', jsonb_build_object('tipo_paquete', 'dinamico', 'moneda', v_mon, 'fecha_salida', (current_date + 60)::text,
        'fecha_regreso', (current_date + 63)::text, 'pax', 2, 'destino', 'T234 CARTAGENA', 'hotel', 'T234 HOTEL',
        'precio_venta', v_precio, 'impuesto', v_imp, 'costo_aereo', v_aereo, 'aerolinea', 'AEROTEST',
        'plan_nombre', 'ESTANDAR · PC', 'paquete_armado_id', v_paq, 'n_tramos', 2, 'n_items', 1, 'n_hoteles', 1,
        'tipo_asesor', 'interno', 'canal', 'B2C'),
    'b2b', null, 'vigencias', '[]'::jsonb,
    'financiero', jsonb_build_object('costos', v_costos, 'cxp', v_cxp));
end $$;

create function t234.cotizar(p_esc text, p_h text default 'h1', p_trm numeric default null, p_mon text default null, p_cxp jsonb default null,
                             p_mon_cot text default null, p_t0 jsonb default null) returns text language plpgsql as $$
declare v_cot jsonb; v_snap jsonb; v_paq bigint;
begin
  v_snap := t234.snap(p_esc, p_trm, p_mon, p_cxp);
  v_paq := (v_snap ->> 'paquete_id')::bigint;
  v_cot := jsonb_build_object('tenant', 'mayorista', 'payload', jsonb_build_object('x', 1), 'detalle', '{}'::jsonb, 'cliente', 'Cliente 234',
    'destino', 'T234 CARTAGENA', 'hotel', 'T234 HOTEL', 'modulo', 'dinamico', 'plan_nombre', 'ESTANDAR · PC', 'pax', 2,
    'precio_venta', (v_snap -> 'cabecera' ->> 'precio_venta')::numeric,
    'moneda', coalesce(p_mon_cot, v_snap ->> 'moneda'), 'fecha_salida', (current_date + 60)::text, 'fecha_regreso', (current_date + 63)::text,
    'vigencia_hasta', (current_date + 1)::text, 'paquete_armado_id', v_paq, 'asesor', 'Asesor 234', 'creado_por', 'c234@x.test');
  return t234.try(format('select public.crear_cotizacion_oferta_63(%L::uuid, ''mayorista'', %L::jsonb, %L::jsonb, %L, %L, %L::jsonb)::text',
    t234.u('vent'), v_cot::text, v_snap::text, p_h, 'f1', coalesce(p_t0, t234.t0(v_paq))::text));
end $$;

-- Llamada de CINCO argumentos (p_trm_provisional toma su valor por defecto NULL).
create function t234.aceptar5(p_cot text, p_h text default 'h1') returns text language plpgsql as $$
begin
  return t234.try(format('select public.aceptar_oferta_63(%s, ''mayorista'', %L::uuid, %L, ''f1'')::text', p_cot, t234.u('vent'), p_h));
end $$;

-- Acepta como lo hace quien convierte a contrato: si la oferta es USD sin TRM, INGRESA la tasa (4000); en las demás no hace falta y va sin tasa.
create function t234.aceptar(p_cot text, p_h text default 'h1') returns text language plpgsql as $$
declare v_req boolean;
begin
  select (o.trm is null and coalesce(nullif(o.snapshot ->> 'moneda', ''), 'COP') = 'USD') into v_req from public.p63_oferta o where o.cotizacion_id = p_cot::bigint;
  if coalesce(v_req, false) then return t234.aceptar_con(p_cot, p_h, '4000'); end if;
  return t234.aceptar5(p_cot, p_h);
end $$;

-- Igual que aceptar, pasando la TRM provisional INGRESADA al convertir a contrato (p_trm_provisional), como texto SQL ('4321.5', 'null', '0', '''NaN''::numeric'…).
create function t234.aceptar_con(p_cot text, p_h text, p_trm text) returns text language plpgsql as $$
begin
  return t234.try(format('select public.aceptar_oferta_63(%s, ''mayorista'', %L::uuid, %L, ''f1'', %s)::text', p_cot, t234.u('vent'), p_h, p_trm));
end $$;

do $$
declare v_cot text; v_o record;
begin
  perform t234.publicar(234302, 'oper', '4000', 'USD');
  perform t234.publicar(234303, 'oper', '4000', 'USD');
  perform t234.publicar(234301, 'oper', '4000', 'COP');
  perform t234.publicar(234304, 'oper');

  v_cot := t234.cotizar('usd_usd', 'hD1');
  perform t234.afirma('D1 USD→USD: cotizar crea la cotización y su oferta', v_cot ~ '^[0-9]+$', v_cot);
  select trm, snapshot ->> 'moneda' as mon, (select moneda from public.cotizaciones c where c.id = o.cotizacion_id) as mon_cot into v_o
    from public.p63_oferta o where o.cotizacion_id = v_cot::bigint;
  perform t234.afirma('D2 la oferta guarda la TRM congelada y la moneda USD en el snapshot y en la cotización', v_o.trm = 4000 and v_o.mon = 'USD' and v_o.mon_cot = 'USD');

  v_cot := t234.cotizar('cop_usd', 'hD2');
  perform t234.afirma('D3 COP→USD: cotizar funciona (vuelo en COP, paquete en USD, TRM 4000)', v_cot ~ '^[0-9]+$', v_cot);
  v_cot := t234.cotizar('usd_cop', 'hD3');
  perform t234.afirma('D4 USD→COP: cotizar sigue funcionando (modo de la 227/230)', v_cot ~ '^[0-9]+$', v_cot);
  v_cot := t234.cotizar('cop_cop', 'hD4');
  perform t234.afirma('D5 todo COP sin TRM: cotizar sigue funcionando (233)', v_cot ~ '^[0-9]+$', v_cot);

  v_cot := t234.cotizar('usd_usd', 'hD6', null, 'COP');
  perform t234.afirma('D6 un snapshot en COP contra un paquete que se publica en USD no se cotiza (p63_oferta_cambio)', v_cot like 'ERR%p63_oferta_cambio%', v_cot);
  v_cot := t234.cotizar('usd_cop', 'hD7', null, 'USD');
  perform t234.afirma('D7 un snapshot en USD contra un paquete que se publica en COP no se cotiza (p63_oferta_cambio)', v_cot like 'ERR%p63_oferta_cambio%', v_cot);
  v_cot := t234.cotizar('usd_usd', 'hD8', null, null, null, 'COP');
  perform t234.afirma('D8 la moneda de la cotización debe ser la de la oferta (p63_invalida)', v_cot like 'ERR%p63_invalida%', v_cot);
  v_cot := t234.cotizar('usd_usd', 'hD9', null, 'EUR');
  perform t234.afirma('D9 una moneda de oferta fuera de (COP, USD) no se cotiza', v_cot like 'ERR%', v_cot);

  -- Cabecera del snapshot distinta de la moneda de la oferta.
  declare v_snap jsonb := jsonb_set(t234.snap('usd_usd'), '{cabecera,moneda}', '"COP"'); v_r text;
  begin
    v_r := t234.try(format('select public.crear_cotizacion_oferta_63(%L::uuid, ''mayorista'', %L::jsonb, %L::jsonb, %L, %L, %L::jsonb)::text',
      t234.u('vent'),
      jsonb_build_object('tenant', 'mayorista', 'payload', '{}'::jsonb, 'detalle', '{}'::jsonb, 'cliente', 'C', 'modulo', 'dinamico', 'pax', 2,
        'precio_venta', 1200, 'moneda', 'USD', 'paquete_armado_id', 234302)::text,
      v_snap::text, 'hD10', 'f1', t234.t0(234302)::text));
    perform t234.afirma('D10 la cabecera del snapshot debe estar en la moneda de la oferta (p63_invalida)', v_r like 'ERR%p63_invalida%', v_r);
  end;

  -- USD con una fuente en COP y sin TRM: no se cotiza (el paquete 234307 tiene todo en COP).
  declare v_snap jsonb := jsonb_set(jsonb_set(t234.snap('usd_usd'), '{paquete_id}', '234307'), '{trm}', 'null'::jsonb); v_r text;
  begin
    v_r := t234.try(format('select public.crear_cotizacion_oferta_63(%L::uuid, ''mayorista'', %L::jsonb, %L::jsonb, %L, %L, %L::jsonb)::text',
      t234.u('vent'),
      jsonb_build_object('tenant', 'mayorista', 'payload', '{}'::jsonb, 'detalle', '{}'::jsonb, 'cliente', 'C', 'modulo', 'dinamico', 'pax', 2,
        'precio_venta', 1200, 'moneda', 'USD', 'paquete_armado_id', 234307)::text,
      v_snap::text, 'hD11', 'f1', t234.t0(234307)::text));
    perform t234.afirma('D11 publicando en USD con fuentes en COP y sin TRM no se cotiza (p63_trm_requerida)', v_r like 'ERR%p63_trm_requerida%', v_r);
  end;

  -- USD con todo en USD y sin TRM SÍ se cotiza, sin equivalentes en COP (la provisional se congela al aceptar).
  perform t234.publicar(234305, 'oper', 'null', 'USD');
  v_cot := t234.cotizar('usd_sintrm', 'hD12');
  perform t234.afirma('D12 USD sin TRM (todo USD): cotizar crea la cotización y su oferta', v_cot ~ '^[0-9]+$', v_cot);
  select trm, snapshot ->> 'moneda' as mon into v_o from public.p63_oferta o where o.cotizacion_id = v_cot::bigint;
  perform t234.afirma('D13 la oferta queda en USD y SIN TRM', v_o.trm is null and v_o.mon = 'USD');
  perform t234.afirma('D14 el snapshot no inventa trm ni equivalentes COP en sus obligaciones USD',
    (select count(*) from public.p63_oferta o, jsonb_array_elements(o.snapshot -> 'financiero' -> 'cxp') c
      where o.cotizacion_id = v_cot::bigint and c ->> 'moneda' = 'USD' and c -> 'trm' = 'null'::jsonb and c -> 'valor_cop' = 'null'::jsonb) = 2);
end $$;

-- ═ E · aceptar: lo cambiado después de cotizar protege la oferta ═════════════════════════════
do $$
declare v_cot text; v_a text;
begin
  -- E1: sin cambios, aceptar funciona en USD.
  v_cot := t234.cotizar('usd_usd', 'hE1');
  v_a := t234.aceptar(v_cot, 'hE1');
  perform t234.afirma('E1 USD→USD: aceptar sin cambios reserva el número y congela el snapshot', v_a like '%numero_contrato%', v_a);

  -- E2: cambia la TRM después de cotizar.
  v_cot := t234.cotizar('usd_usd', 'hE2');
  update public.armado_paquetes set trm_oferta = 4100 where id = 234302;
  v_a := t234.aceptar(v_cot, 'hE2');
  perform t234.afirma('E2 cambiar la TRM del paquete después de cotizar: la oferta NO se acepta (p63_oferta_cambio)', v_a like 'ERR%p63_oferta_cambio%', v_a);
  update public.armado_paquetes set trm_oferta = 4000 where id = 234302;
  perform t234.publicar(234302, 'oper', '4000', 'USD');

  -- E3: cambia la moneda de publicación después de cotizar (USD → COP).
  v_cot := t234.cotizar('usd_usd', 'hE3');
  update public.armado_paquetes set moneda_publicacion = 'COP' where id = 234302;
  v_a := t234.aceptar(v_cot, 'hE3');
  perform t234.afirma('E3 cambiar la moneda de publicación después de cotizar: la oferta NO se acepta (p63_oferta_cambio)', v_a like 'ERR%p63_oferta_cambio%', v_a);
  update public.armado_paquetes set moneda_publicacion = 'USD' where id = 234302;
  perform t234.publicar(234302, 'oper', '4000', 'USD');

  -- E4: cambia la tarifa del vuelo en Empaquetados (la copia de la salida queda vieja).
  v_cot := t234.cotizar('usd_usd', 'hE4');
  update public.empaquetados set tarifa_para_empaquetar = 300 where id = 234508;
  v_a := t234.aceptar(v_cot, 'hE4');
  perform t234.afirma('E4 cambiar la tarifa R del vuelo después de cotizar: la oferta NO se acepta', v_a like 'ERR%p63_oferta_cambio%', v_a);
  update public.empaquetados set tarifa_para_empaquetar = 290 where id = 234508;
  perform t234.publicar(234302, 'oper', '4000', 'USD');

  -- E5: cambia el fee de infante del vuelo.
  v_cot := t234.cotizar('usd_usd', 'hE5');
  update public.empaquetados set fee_infante = 25 where id = 234508;
  v_a := t234.aceptar(v_cot, 'hE5');
  perform t234.afirma('E5 cambiar el fee de infante después de cotizar: la oferta NO se acepta', v_a like 'ERR%p63_oferta_cambio%', v_a);
  update public.empaquetados set fee_infante = 20 where id = 234508;
  perform t234.publicar(234302, 'oper', '4000', 'USD');

  -- E6: el vuelo cambia de moneda (USD → COP) después de cotizar.
  v_cot := t234.cotizar('usd_usd', 'hE6');
  update public.empaquetados set moneda = 'COP' where id = 234508;
  v_a := t234.aceptar(v_cot, 'hE6');
  perform t234.afirma('E6 el vuelo cambió de moneda después de cotizar: la oferta NO se acepta', v_a like 'ERR%p63_oferta_cambio%', v_a);
  update public.empaquetados set moneda = 'USD' where id = 234508;
  perform t234.publicar(234302, 'oper', '4000', 'USD');

  -- E7: fuente inelegible — el vuelo se desactiva.
  v_cot := t234.cotizar('usd_usd', 'hE7');
  update public.empaquetados set activo = false where id = 234508;
  v_a := t234.aceptar(v_cot, 'hE7');
  perform t234.afirma('E7 fuente desactivada después de cotizar: la oferta NO se acepta', v_a like 'ERR%p63_oferta_cambio%', v_a);
  update public.empaquetados set activo = true where id = 234508;
  perform t234.publicar(234302, 'oper', '4000', 'USD');

  -- E8: fuente inelegible — el vuelo recibe record (PNR).
  v_cot := t234.cotizar('usd_usd', 'hE8');
  update public.empaquetados set record = 'ABC123' where id = 234508;
  v_a := t234.aceptar(v_cot, 'hE8');
  perform t234.afirma('E8 el vuelo recibe record (PNR) después de cotizar: la oferta NO se acepta', v_a like 'ERR%p63_oferta_cambio%', v_a);
  update public.empaquetados set record = null where id = 234508;
  perform t234.publicar(234302, 'oper', '4000', 'USD');

  -- E9: fuente inelegible — la compra del vuelo cerró.
  v_cot := t234.cotizar('usd_usd', 'hE9');
  update public.empaquetados set compra_fin = current_date - 1 where id = 234508;
  v_a := t234.aceptar(v_cot, 'hE9');
  perform t234.afirma('E9 la ventana de compra del vuelo cerró después de cotizar: la oferta NO se acepta', v_a like 'ERR%p63_oferta_cambio%', v_a);
  update public.empaquetados set compra_fin = null where id = 234508;
  perform t234.publicar(234302, 'oper', '4000', 'USD');

  -- E10: COP→USD — el vuelo en COP cambia su tarifa.
  perform t234.publicar(234303, 'oper', '4000', 'USD');
  v_cot := t234.cotizar('cop_usd', 'hE10');
  update public.empaquetados set tarifa_para_empaquetar = 1200000 where id = 234507;
  v_a := t234.aceptar(v_cot, 'hE10');
  perform t234.afirma('E10 COP→USD: cambiar la tarifa del vuelo en COP después de cotizar: la oferta NO se acepta', v_a like 'ERR%p63_oferta_cambio%', v_a);
  update public.empaquetados set tarifa_para_empaquetar = 1130000 where id = 234507;
  perform t234.publicar(234303, 'oper', '4000', 'USD');

  -- E11: la TRM del paquete USD se quita después de cotizar.
  v_cot := t234.cotizar('usd_usd', 'hE11');
  update public.armado_paquetes set trm_oferta = null where id = 234302;
  v_a := t234.aceptar(v_cot, 'hE11');
  perform t234.afirma('E11 quitar la TRM de un paquete en USD después de cotizar: la oferta NO se acepta', v_a like 'ERR%p63_oferta_cambio%', v_a);
  perform t234.afirma('E11b y el paquete en USD con todo en USD ya no necesita TRM para volver a publicar', not public.p63_requiere_trm(234302));
  v_cot := t234.cotizar('usd_usd', 'hE11b', null, null, null, null, t234.t0(234302));
  perform t234.afirma('E11c pero una oferta cotizada CON TRM 4000 no coincide con un paquete sin TRM (p63_oferta_cambio)', v_cot like 'ERR%p63_oferta_cambio%', v_cot);
  update public.armado_paquetes set trm_oferta = 4000 where id = 234302;
  perform t234.publicar(234302, 'oper', '4000', 'USD');

  -- E12: ACL.
  perform t234.afirma('E12 crear_cotizacion_oferta_63 y aceptar_oferta_63 solo las ejecuta service_role (no authenticated ni anon)',
    not has_function_privilege('authenticated', 'public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)', 'EXECUTE'));
end $$;

-- ═ F · recorrido hasta el contrato y las CxP ═══════════════════════════════════════════════
create function t234.cabecera(p_numero text, p_acep bigint, p_esc text, p_mon_ventas text default null) returns text language plpgsql as $$
declare v_s jsonb := t234.snap(p_esc); v_c jsonb := v_s -> 'cabecera';
begin
  return t234.try(format($f$insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, fecha_salida, fecha_regreso, pax, hotel, destino,
      precio_venta, impuesto, costo_aereo, aerolinea, estado, financiero_estado, plan_nombre, paquete_armado_id, aceptacion_63_id, tipo_asesor, canal)
    values (%L, 'mayorista', 'Cliente 234', 'dinamico', %L, current_date + 60, current_date + 63, 2, 'T234 HOTEL', 'T234 CARTAGENA',
      %s, %s, %s, 'AEROTEST', 'pendiente', 'pendiente', 'ESTANDAR · PC', %s, %s, 'interno', 'B2C') returning 'OK'$f$,
    p_numero, coalesce(p_mon_ventas, v_c ->> 'moneda'), v_c ->> 'precio_venta', v_c ->> 'impuesto', v_c ->> 'costo_aereo', v_s ->> 'paquete_id', p_acep));
end $$;

create function t234.hijos(p_numero text) returns void language plpgsql as $$
begin
  insert into public.contrato_vuelos (numero_contrato) select p_numero from generate_series(1, 2);
  insert into public.contrato_items (numero_contrato, descripcion) values (p_numero, 'item');
  insert into public.contrato_hoteles (numero_contrato, nombre) values (p_numero, 'T234 HOTEL');
end $$;

create function t234.pendiente(p_acep bigint, p_numero text) returns text language plpgsql as $$
declare v_der jsonb := public.p63_financiero_derivado(p_acep);
begin
  return t234.try(format($f$insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values (%L, 'mayorista', %L::jsonb, %L::jsonb) returning 'OK'$f$,
    p_numero, (v_der->'costos')::text, (v_der->'cxp')::text));
end $$;

create function t234.finalizar(p_acep bigint, p_numero text) returns text language plpgsql as $$
declare v_der jsonb := public.p63_financiero_derivado(p_acep);
begin
  return t234.try(format($f$select public.registrar_financiero_contrato(%L, 'mayorista', %L::jsonb, %L::jsonb)::text$f$,
    p_numero, (v_der->'costos')::text, (v_der->'cxp')::text));
end $$;

-- Recorre cotizar → aceptar → cabecera → hijos → pendiente → financiero y devuelve 'numero|aceptacion|resultado'.
create function t234.recorrer(p_esc text, p_h text, p_mon_ventas text default null) returns text language plpgsql as $$
declare v_cot text; v_a jsonb; v_acep bigint; v_num text; v_r text;
begin
  v_cot := t234.cotizar(p_esc, p_h);
  if v_cot !~ '^[0-9]+$' then return '||cotizar ' || v_cot; end if;
  v_a := (t234.aceptar(v_cot, p_h))::jsonb;
  v_acep := (v_a ->> 'aceptacion_id')::bigint; v_num := v_a ->> 'numero_contrato';
  v_r := t234.cabecera(v_num, v_acep, p_esc, p_mon_ventas);
  if v_r <> 'OK' then return v_num || '|' || v_acep || '|cabecera ' || v_r; end if;
  perform t234.hijos(v_num);
  v_r := t234.pendiente(v_acep, v_num);
  if v_r <> 'OK' then return v_num || '|' || v_acep || '|pendiente ' || v_r; end if;
  v_r := t234.finalizar(v_acep, v_num);
  return v_num || '|' || v_acep || '|' || v_r;
end $$;

do $$
declare v text; v_num text; v_acep bigint;
begin
  perform t234.publicar(234302, 'oper', '4000', 'USD');
  perform t234.publicar(234303, 'oper', '4000', 'USD');
  perform t234.publicar(234301, 'oper', '4000', 'COP');

  -- F1-F6: USD→USD de punta a punta.
  v := t234.recorrer('usd_usd', 'hF1');
  v_num := split_part(v, '|', 1); v_acep := nullif(split_part(v, '|', 2), '')::bigint;
  perform t234.afirma('F1 USD→USD: el contrato se crea (cabecera en USD), se completan los hijos y la RPC financiera escribe las CxP', v like '%creadas%', v);
  perform t234.afirma('F2 la venta queda en USD con sus costos en USD (los del snapshot)',
    (select moneda = 'USD' and costo_aereo = 500 and costo_hotel = 400 and financiero_estado = 'completo' from public.ventas where numero_contrato = v_num));
  perform t234.afirma('F3 las CxP conservan su moneda de ORIGEN (USD) con el equivalente COP a la TRM congelada (valor_cop_63 = valor × 4000)',
    (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num and moneda = 'USD' and trm_63 = 4000 and valor_cop_63 = valor_total * 4000 and aceptacion_63_id = v_acep) = 2);
  perform t234.afirma('F4 la aceptación queda completa', (select estado from public.p63_aceptacion where id = v_acep) = 'completa');
  perform t234.afirma('F5 el snapshot aceptado (inmutable) conserva moneda USD y la TRM',
    (select snapshot ->> 'moneda' = 'USD' and (snapshot ->> 'trm')::numeric = 4000 from public.p63_aceptacion where id = v_acep));

  -- F7-F9: COP→USD: aéreo en COP (CxP en COP, equivalente = valor, TRM congelada) y costo del contrato en USD.
  v := t234.recorrer('cop_usd', 'hF2');
  v_num := split_part(v, '|', 1); v_acep := nullif(split_part(v, '|', 2), '')::bigint;
  perform t234.afirma('F7 COP→USD: el contrato se crea y se completa', v like '%creadas%', v);
  perform t234.afirma('F8 COP→USD: la CxP aérea queda en COP (origen) con equivalente = valor y la TRM congelada; la del hotel en USD',
    (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num and tipo_proveedor = 'aereo' and moneda = 'COP' and trm_63 = 4000 and valor_cop_63 = valor_total and valor_total = 2000000) = 1
    and (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num and tipo_proveedor = 'hotel' and moneda = 'USD' and trm_63 = 4000 and valor_cop_63 = valor_total * 4000) = 1);
  perform t234.afirma('F9 COP→USD: el contrato está en USD y su costo aéreo es el de origen COP / TRM (500)',
    (select moneda = 'USD' and costo_aereo = 500 from public.ventas where numero_contrato = v_num));

  -- F10-F11: USD→COP (el modo de siempre) sigue completándose.
  v := t234.recorrer('usd_cop', 'hF3');
  v_num := split_part(v, '|', 1);
  perform t234.afirma('F10 USD→COP: el contrato se crea y se completa (regresión 227/230)', v like '%creadas%', v);
  perform t234.afirma('F11 USD→COP: contrato en COP con costos COP y CxP USD con equivalente × TRM',
    (select moneda = 'COP' and costo_aereo = 2000000 from public.ventas where numero_contrato = v_num)
    and (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num and moneda = 'USD' and valor_cop_63 = valor_total * 4000) = 2);

  -- F12: la cabecera debe estar en la moneda aceptada (USD): una cabecera en COP se niega.
  v := t234.recorrer('usd_usd', 'hF4', 'COP');
  perform t234.afirma('F12 una cabecera en COP para una oferta aceptada en USD se niega (p63_cabecera: moneda)', v like '%p63_cabecera%moneda%', v);

  -- F13: una obligación en USD sin equivalente COP/TRM se rechaza al escribir lo financiero (la contabilidad está en pesos).
  -- (el recorrido válido ya pasó en F1; aquí se fuerza un payload con la obligación USD sin TRM en una oferta USD)
  declare v_cot text; v_a jsonb; v_ac bigint; v_n text; v_r text;
  begin
    v_cot := t234.cotizar('usd_usd', 'hF6', null, null, jsonb_build_array(
      jsonb_build_object('obligacion', 'hotel:0', 'tipo_proveedor', 'hotel', 'proveedor', 'T234 PROV', 'servicio', 'Hotel T234',
        'valor_total', 400, 'moneda', 'USD', 'valor_cop', 1600000, 'trm', null, 'aplica_retencion', false, 'pct_retencion', 0,
        'observaciones', 'Generado automáticamente desde el tarifario', 'servicio_id', null)));
    v_a := (t234.aceptar(v_cot, 'hF6'))::jsonb;
    v_ac := (v_a ->> 'aceptacion_id')::bigint; v_n := v_a ->> 'numero_contrato';
    perform t234.cabecera(v_n, v_ac, 'usd_usd');
    perform t234.hijos(v_n);
    perform t234.pendiente(v_ac, v_n);
    v_r := t234.finalizar(v_ac, v_n);
    perform t234.afirma('F13 una obligación USD sin la TRM congelada de la oferta se rechaza al escribir lo financiero', v_r like 'ERR%obligación aceptada inválida%', v_r);
    perform t234.afirma('F14 y no queda ninguna CxP de ese intento', (select count(*) from public.cuentas_por_pagar where numero_contrato = v_n) = 0);
  end;
end $$;

-- ═ F2 · oferta en USD SIN TRM: la TRM provisional INGRESADA se congela AL ACEPTAR, antes de cualquier CxP o asiento ═══════
do $$
declare v_cot text; v_cot2 text; v_a jsonb; v_a2 text; v_acep bigint; v_num text; v_r text; v_n int;
begin
  perform t234.publicar(234305, 'oper', 'null', 'USD');
  update public.parametros_tributarios set valor = 4100 where parametro = 'trm_referencia';
  perform t234.afirma('F15 (precondición) existe una TRM de referencia válida (y NO se usa)', exists (select 1 from public.parametros_tributarios where parametro = 'trm_referencia' and valor = 4100));

  -- La TRM se ingresa AL CONTRATAR, no al cotizar: el parámetro de referencia se mueve y no influye.
  v_cot := t234.cotizar('usd_sintrm', 'hF7');
  perform t234.afirma('F16 se cotiza sin TRM', v_cot ~ '^[0-9]+$', v_cot);
  update public.parametros_tributarios set valor = 9999 where parametro = 'trm_referencia';
  v_a := (t234.aceptar_con(v_cot, 'hF7', '4200'))::jsonb;
  v_acep := (v_a ->> 'aceptacion_id')::bigint; v_num := v_a ->> 'numero_contrato';
  perform t234.afirma('F17 la aceptación congela la TRM INGRESADA (4200), no la de referencia (9999)', (select trm_provisional from public.p63_aceptacion where id = v_acep) = 4200);
  select count(*) into v_n from jsonb_array_elements(v_a -> 'financiero' -> 'cxp') c
   where (c ->> 'trm')::numeric = 4200 and (c ->> 'valor_cop')::numeric = (c ->> 'valor_total')::numeric * 4200 and c ->> 'moneda' = 'USD';
  perform t234.afirma('F18 el payload financiero que devuelve la aceptación trae TRM 4200 y el equivalente COP en TODAS las obligaciones USD', v_n = 2, v_n::text);
  perform t234.afirma('F19 la aceptación todavía no creó CxP ni asientos', (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num) = 0
    and (select count(*) from public.asientos_contables where descripcion like '%' || v_num || '%') = 0);

  -- Reintento idempotente: mismo intento, misma TRM aunque el parámetro ya cambió.
  update public.parametros_tributarios set valor = 4300 where parametro = 'trm_referencia';
  v_a2 := t234.aceptar(v_cot, 'hF7');
  perform t234.afirma('F20 el reintento devuelve el MISMO intento con la TRM congelada (4200), no la nueva', v_a2 like '%"trm": 4200%' and (v_a2::jsonb ->> 'numero_contrato') = v_num, v_a2);

  v_r := t234.cabecera(v_num, v_acep, 'usd_sintrm');
  perform t234.afirma('F21 la cabecera en USD se inserta', v_r = 'OK', v_r);
  perform t234.hijos(v_num);
  v_r := t234.pendiente(v_acep, v_num);
  perform t234.afirma('F22 el payload derivado (con la TRM provisional) se guarda como pendiente', v_r = 'OK', v_r);
  v_r := t234.finalizar(v_acep, v_num);
  perform t234.afirma('F23 la RPC financiera escribe las obligaciones con la TRM provisional como la TRM de la oferta', v_r like '%creadas%', v_r);
  perform t234.afirma('F24 las CxP quedan en USD con trm_63 = 4200 y valor_cop_63 = valor_total × 4200',
    (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num and moneda = 'USD' and trm_63 = 4200 and valor_cop_63 = valor_total * 4200 and aceptacion_63_id = v_acep) = 2);
  perform t234.afirma('F25 ninguna CxP de la oferta en USD nace sin TRM ni equivalente', (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num and (trm_63 is null or valor_cop_63 is null)) = 0);
  perform t234.afirma('F26 la TRM provisional de una aceptación no se modifica (inmutable)',
    t234.try(format('update public.p63_aceptacion set trm_provisional = 1 where id = %s returning ''ok''', v_acep)) like 'ERR%p63_inmutable%');
  update public.parametros_tributarios set valor = 4999 where parametro = 'trm_referencia';
  perform t234.afirma('F27 cambiar el parámetro después de contratar no mueve la TRM ni las CxP',
    (select trm_provisional from public.p63_aceptacion where id = v_acep) = 4200
    and (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num and trm_63 = 4200) = 2);

  -- Sin tasa ingresada NO se contrata aunque trm_referencia exista y sea positiva: ni número, ni aceptación, y la oferta sigue abierta.
  update public.parametros_tributarios set valor = 4000 where parametro = 'trm_referencia';
  v_cot2 := t234.cotizar('usd_sintrm', 'hF8');
  perform t234.afirma('F28 (precondición) segunda oferta sin TRM cotizada, con una TRM de referencia positiva (4000)', v_cot2 ~ '^[0-9]+$' and exists (select 1 from public.parametros_tributarios where parametro = 'trm_referencia' and valor = 4000), v_cot2);
  v_a2 := t234.aceptar_con(v_cot2, 'hF8', 'null');
  perform t234.afirma('F29 con p_trm_provisional NULL no se acepta (p63_trm_requerida) aunque haya TRM de referencia', v_a2 like 'ERR%p63_trm_requerida%', v_a2);
  perform t234.afirma('F30 no se reservó ningún número ni quedó aceptación, y la oferta sigue abierta',
    not exists (select 1 from public.p63_aceptacion where cotizacion_id = v_cot2::bigint) and (select estado from public.p63_oferta where cotizacion_id = v_cot2::bigint) = 'abierta');
  v_a2 := t234.aceptar5(v_cot2, 'hF8');
  perform t234.afirma('F31 la llamada de CINCO argumentos (valor por defecto) tampoco acepta una oferta USD sin tasa ingresada', v_a2 like 'ERR%p63_trm_requerida%', v_a2);
  v_a2 := t234.aceptar_con(v_cot2, 'hF8', '4100');
  perform t234.afirma('F32 con la tasa ingresada la MISMA cotización se acepta', v_a2 like '%numero_contrato%', v_a2);

  -- Una oferta con TRM de publicación NO captura ninguna provisional: manda la de la oferta.
  perform t234.publicar(234302, 'oper', '4000', 'USD');
  v_a2 := t234.aceptar(t234.cotizar('usd_usd', 'hF9'), 'hF9');
  perform t234.afirma('F33 una oferta con TRM de publicación se acepta sin TRM provisional',
    v_a2 like '%numero_contrato%' and (select trm_provisional from public.p63_aceptacion where numero_contrato = (v_a2::jsonb ->> 'numero_contrato')) is null, v_a2);
end $$;

-- ═ F3 · la TRM provisional INGRESADA al convertir a contrato prevalece sobre trm_referencia ═════════════════════════════════════
do $$
declare v_cot text; v_a text; v_aj jsonb; v_acep bigint; v_num text; v_r text; v_n int; v_seq_antes text;
begin
  perform t234.publicar(234305, 'oper', 'null', 'USD');
  update public.parametros_tributarios set valor = 4000 where parametro = 'trm_referencia';
  perform t234.afirma('F34 la firma de 5 argumentos ya no existe (no queda una puerta sin la guarda)', to_regprocedure('public.aceptar_oferta_63(bigint, text, uuid, text, text)') is null);

  -- Tasa inválida: se rechaza ANTES de reservar número, aunque haya TRM de referencia. 0, negativa, NaN.
  v_cot := t234.cotizar('usd_sintrm', 'hF10');
  for v_r in select unnest(array['0', '-5', '''NaN''::numeric', '-0.00001']) loop
    v_a := t234.aceptar_con(v_cot, 'hF10', v_r);
    perform t234.afirma('F35 TRM provisional inválida (' || v_r || ') se rechaza (p63_trm_invalida)', v_a like 'ERR%p63_trm_invalida%', v_a);
  end loop;
  perform t234.afirma('F36 ninguna tasa inválida reservó número ni dejó aceptación, y la oferta sigue abierta',
    not exists (select 1 from public.p63_aceptacion where cotizacion_id = v_cot::bigint) and (select estado from public.p63_oferta where cotizacion_id = v_cot::bigint) = 'abierta');
  v_a := t234.aceptar_con(v_cot, 'hF10', '0.00001');
  perform t234.afirma('F37 una tasa que se redondea a 0 (4 decimales) también se rechaza', v_a like 'ERR%p63_trm_invalida%', v_a);

  -- La tasa ingresada manda aunque trm_referencia tenga OTRO valor.
  v_a := t234.aceptar_con(v_cot, 'hF10', '4321.5');
  perform t234.afirma('F38 con una tasa válida la oferta se acepta', v_a like '%numero_contrato%', v_a);
  v_aj := v_a::jsonb; v_acep := (v_aj ->> 'aceptacion_id')::bigint; v_num := v_aj ->> 'numero_contrato';
  perform t234.afirma('F39 la TRM provisional congelada es la INGRESADA (4321,5), no la de referencia (4000)', (select trm_provisional from public.p63_aceptacion where id = v_acep) = 4321.5);
  select count(*) into v_n from jsonb_array_elements(v_aj -> 'financiero' -> 'cxp') c
   where (c ->> 'trm')::numeric = 4321.5 and (c ->> 'valor_cop')::numeric = (c ->> 'valor_total')::numeric * 4321.5;
  perform t234.afirma('F40 el payload financiero derivado trae la tasa ingresada y el equivalente COP en TODAS las obligaciones USD', v_n = 2, v_n::text);
  perform t234.afirma('F41 antes de la escritura financiera no hay CxP ni asientos', (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num) = 0);
  -- El reintento (aunque traiga OTRA tasa) devuelve el mismo intento: la tasa no se re-captura.
  v_a := t234.aceptar_con(v_cot, 'hF10', '9999');
  perform t234.afirma('F42 el reintento devuelve el MISMO intento y no re-captura la tasa', v_a like '%numero_contrato%' and (v_a::jsonb ->> 'numero_contrato') = v_num
    and (select trm_provisional from public.p63_aceptacion where id = v_acep) = 4321.5, v_a);
  perform t234.cabecera(v_num, v_acep, 'usd_sintrm');
  perform t234.hijos(v_num);
  perform t234.pendiente(v_acep, v_num);
  v_r := t234.finalizar(v_acep, v_num);
  perform t234.afirma('F43 la RPC financiera escribe las CxP con la tasa ingresada', v_r like '%creadas%', v_r);
  perform t234.afirma('F44 las CxP quedan con trm_63 = 4321,5 y valor_cop_63 = valor_total × 4321,5 (no × 4000)',
    (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num and trm_63 = 4321.5 and valor_cop_63 = valor_total * 4321.5) = 2);

  -- Sin tasa ingresada y sin referencia: no se reserva número.
  v_cot := t234.cotizar('usd_sintrm', 'hF11');
  delete from public.parametros_tributarios where parametro = 'trm_referencia';
  select last_value::text || '/' || is_called::text into v_seq_antes from public.contrato_seq_mayorista;
  v_a := t234.aceptar_con(v_cot, 'hF11', 'null');
  perform t234.afirma('F45 sin tasa ingresada ni de referencia se rechaza (p63_trm_requerida)', v_a like 'ERR%p63_trm_requerida%', v_a);
  perform t234.afirma('F46 y no se reservó número: no hay aceptación y el consecutivo no avanzó',
    not exists (select 1 from public.p63_aceptacion where cotizacion_id = v_cot::bigint) and (select last_value::text || '/' || is_called::text from public.contrato_seq_mayorista) = v_seq_antes);
  -- La tasa ingresada basta aunque NO exista trm_referencia.
  v_a := t234.aceptar_con(v_cot, 'hF11', '4100');
  perform t234.afirma('F47 la tasa ingresada basta aunque no exista trm_referencia', v_a like '%numero_contrato%'
    and (select trm_provisional from public.p63_aceptacion where cotizacion_id = v_cot::bigint) = 4100, v_a);
  insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion) values ('trm_referencia', 4000, 'COP por 1 USD', 'TRM de referencia (restaurada por la prueba)');

  -- Con TRM de publicación la tasa ingresada se IGNORA (manda la de la oferta; no se captura provisional).
  perform t234.publicar(234302, 'oper', '4000', 'USD');
  v_a := t234.aceptar_con(t234.cotizar('usd_usd', 'hF12'), 'hF12', '4999');
  perform t234.afirma('F48 con TRM de publicación la tasa ingresada se ignora (sin provisional)', v_a like '%numero_contrato%'
    and (select trm_provisional from public.p63_aceptacion where numero_contrato = (v_a::jsonb ->> 'numero_contrato')) is null, v_a);
end $$;

-- ═ F4 · cierre de las dos vías: PUBLICAR y NUMERAR rechazan antes de escribir ═════════════════════════════════════════════
-- Vía 1 · publicar. Frontera de base de datos SIN banderas de sesión: el publicador base (fachada) rechaza todo paquete cop_trm_63 (con o sin filas),
-- el cuerpo real (publicar_tarifario_resultado_interno) no lo ejecuta ningún rol de la API y tarifario_resultado no admite escritura directa.
create function t234.filas(p_n int, p_precio numeric default 550000) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('modulo', 'dinamico', 'categoria', 'CAT' || g, 'regimen', 'PC', 'acomodacion', 'doble', 'noches', 3,
           'fecha_ida', (current_date + 40)::text, 'fecha_regreso', (current_date + 43)::text, 'base_comisionable', p_precio, 'impuesto', 0, 'precio_pvp', p_precio)), '[]'::jsonb)
  from generate_series(1, p_n) g $$;
-- Llama al publicador BASE (5 argumentos) como el usuario p_k con los tokens vigentes del paquete.
create function t234.base(p_paquete bigint, p_k text, p_moneda text, p_filas jsonb, p_rol text default 'authenticated') returns text language plpgsql as $$
declare v_gen bigint; v_rev bigint;
begin
  select tarifario_generacion, tarifario_revision_fuente into v_gen, v_rev from public.armado_paquetes where id = p_paquete;
  return t234.q(format('select public.publicar_tarifario_resultado(%s, %s, %s, %L, %L::jsonb)::text', p_paquete, v_gen, v_rev, p_moneda, p_filas::text), p_k, p_rol);
end $$;
create function t234.publicar_con(p_paquete bigint, p_k text, p_moneda text, p_filas jsonb, p_trm text default 'null') returns text language plpgsql as $$
declare v_gen bigint; v_rev bigint;
begin
  select tarifario_generacion, tarifario_revision_fuente into v_gen, v_rev from public.armado_paquetes where id = p_paquete;
  return t234.q(format('select public.publicar_tarifario_resultado_63(%s, %s, %s, %L, %L::jsonb, %L, %s)::text', p_paquete, v_gen, v_rev, p_moneda, p_filas::text, 'cop_trm_63', p_trm), p_k);
end $$;
-- Huella COMPLETA de lo publicado: filas (id, precio, moneda), generación, estado, moneda y revisión publicadas del paquete.
create function t234.huella(p_paquete bigint) returns text language sql stable as $$
  select (select count(*) || ':' || coalesce(md5(string_agg(r.id::text || '/' || r.precio_pvp::text || '/' || r.moneda || '/' || r.categoria, ',' order by r.id)), '-')
            from public.tarifario_resultado r where r.paquete_id = p_paquete)
      || ' | ' || (select concat_ws('/', p.tarifario_generacion, p.tarifario_generacion_publicada, p.tarifario_revision_publicada, p.tarifario_estado, p.moneda, p.tarifario_snapshot_publicable)
                     from public.armado_paquetes p where p.id = p_paquete) $$;

do $$
declare v_m text; v_r text; v_cot text; v_a text; v_seq_antes text; v_n_antes int; v_h0 text; v_h1 text;
begin
  -- Publicación válida por el envoltorio 63 (USD con TRM): es la base contra la que se miden los rechazos.
  v_r := t234.publicar_con(234302, 'oper', 'USD', t234.filas(2), '4000');
  perform t234.afirma('F49a el envoltorio 63 publica un lote no vacío en la moneda elegida (USD)', v_r = 'true'
    and (select count(*) from public.tarifario_resultado where paquete_id = 234302) = 2
    and (select moneda from public.armado_paquetes where id = 234302) = 'USD'
    and (select count(*) from public.tarifario_resultado where paquete_id = 234302 and moneda = 'USD') = 2, v_r);
  v_h0 := t234.huella(234302);

  -- Llamada directa al publicador base: lote VACÍO (borraría el tarifario y marcaría el paquete como publicado) y lote no vacío, moneda correcta e indebida.
  v_r := t234.base(234302, 'oper', 'USD', '[]'::jsonb);
  perform t234.afirma('F49b publicador base con lote VACÍO sobre un paquete 63 se rechaza (p63_publicador)', v_r like 'ERR%p63_publicador%', v_r);
  perform t234.afirma('F49c ...y deja intactas filas, generación, estado y moneda', t234.huella(234302) = v_h0, t234.huella(234302) || ' vs ' || v_h0);
  v_r := t234.base(234302, 'oper', 'USD', t234.filas(3, 1));
  perform t234.afirma('F49d publicador base con lote NO vacío sobre un paquete 63 se rechaza (p63_publicador)', v_r like 'ERR%p63_publicador%', v_r);
  perform t234.afirma('F49e ...y deja todo intacto', t234.huella(234302) = v_h0);
  v_r := t234.base(234302, 'oper', 'COP', t234.filas(3, 1));
  perform t234.afirma('F49f publicador base con moneda INDEBIDA (COP en un paquete USD) se rechaza (p63_publicador)', v_r like 'ERR%p63_publicador%', v_r);
  v_r := t234.base(234302, 'oper', 'EUR', '[]'::jsonb);
  perform t234.afirma('F49g publicador base con moneda inválida y lote vacío se rechaza', v_r like 'ERR%', v_r);
  perform t234.afirma('F49h ...y deja todo intacto (filas, generación, estado, moneda)', t234.huella(234302) = v_h0);
  v_r := t234.base(234302, 'vent', 'USD', t234.filas(1));
  perform t234.afirma('F49i un rol sin permiso (venta) no publica por el base', v_r like 'ERR%rol sin permiso%' and t234.huella(234302) = v_h0, v_r);

  -- La bandera de la versión anterior NO autoriza nada: activarla antes de escribir no abre ninguna vía.
  perform set_config('app.p63_pub', 'on', true);
  v_r := t234.base(234302, 'oper', 'USD', t234.filas(1));
  perform t234.afirma('F49j con app.p63_pub = on el publicador base sigue rechazando (la bandera no autoriza)', v_r like 'ERR%p63_publicador%' and t234.huella(234302) = v_h0, v_r);
  v_r := t234.base(234302, 'oper', 'USD', '[]'::jsonb);
  perform t234.afirma('F49k ...tampoco con lote vacío', v_r like 'ERR%p63_publicador%' and t234.huella(234302) = v_h0, v_r);
  v_r := t234.q('insert into public.tarifario_resultado (paquete_id, modulo) values (234302, (enum_range(null::public.tarifario_modulo))[1]) returning ''x''', 'oper');
  perform t234.afirma('F49l con la bandera activada, escribir tarifario_resultado como authenticated sigue denegado (42501)', v_r like 'ERR 42501%' and t234.huella(234302) = v_h0, v_r);
  perform set_config('app.p63_pub', 'off', true);
  v_r := t234.q('with d as (delete from public.tarifario_resultado where paquete_id = 234302 returning 1) select count(*)::text from d', 'oper');
  perform t234.afirma('F49m borrar tarifario_resultado como authenticated se deniega (42501)', v_r like 'ERR 42501%' and t234.huella(234302) = v_h0, v_r);
  v_r := t234.q('update public.tarifario_resultado set precio_pvp = 1 where paquete_id = 234302 returning ''x''', 'super');
  perform t234.afirma('F49n actualizar tarifario_resultado como authenticated (superadmin) se deniega (42501)', v_r like 'ERR 42501%' and t234.huella(234302) = v_h0, v_r);
  v_r := t234.q('insert into public.tarifario_resultado (paquete_id, modulo) values (234306, (enum_range(null::public.tarifario_modulo))[1]) returning ''x''', null, 'anon');
  perform t234.afirma('F49o anon no escribe tarifario_resultado (42501)', v_r like 'ERR 42501%', v_r);

  -- El cuerpo real no es alcanzable por la API.
  perform t234.afirma('F49p publicar_tarifario_resultado_interno no la ejecuta anon ni authenticated',
    not has_function_privilege('anon', 'public.publicar_tarifario_resultado_interno(bigint, bigint, bigint, text, jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.publicar_tarifario_resultado_interno(bigint, bigint, bigint, text, jsonb)', 'EXECUTE'));
  v_r := t234.q(format('select public.publicar_tarifario_resultado_interno(234302, %s, %s, ''USD'', ''[]''::jsonb)::text',
           (select tarifario_generacion from public.armado_paquetes where id = 234302), (select tarifario_revision_fuente from public.armado_paquetes where id = 234302)), 'oper');
  perform t234.afirma('F49q llamar al interno directamente como authenticated se deniega (42501) y no cambia nada', v_r like 'ERR 42501%' and t234.huella(234302) = v_h0, v_r);

  -- Publicación válida por el envoltorio 63 DESPUÉS de los rechazos: reemplaza el snapshot completo.
  v_r := t234.publicar_con(234302, 'oper', 'USD', t234.filas(3, 777000), '4000');
  perform t234.afirma('F49r el envoltorio 63 sigue publicando (reemplaza el snapshot por el lote nuevo)', v_r = 'true'
    and (select count(*) from public.tarifario_resultado where paquete_id = 234302 and precio_pvp = 777000 and moneda = 'USD') = 3
    and (select count(*) from public.tarifario_resultado where paquete_id = 234302) = 3, v_r);
  perform t234.afirma('F49s ...y la TRM de esa publicación queda guardada', (select trm from public.tarifario_oferta_63 where paquete_id = 234302) = 4000);

  -- Paquete LEGACY: sigue publicando por el publicador base, y sus rechazos tampoco tocan lo publicado.
  v_r := t234.base(234306, 'oper', 'COP', t234.filas(2, 123000));
  perform t234.afirma('F50a un paquete legacy publica por el publicador base (lote no vacío)', v_r = 'true'
    and (select count(*) from public.tarifario_resultado where paquete_id = 234306 and precio_pvp = 123000 and moneda = 'COP') = 2
    and (select tarifario_estado from public.armado_paquetes where id = 234306) = 'listo', v_r);
  v_h1 := t234.huella(234306);
  v_r := t234.base(234306, 'oper', 'EUR', t234.filas(1, 5));
  perform t234.afirma('F50b legacy con moneda indebida se rechaza y deja todo intacto', v_r like 'ERR%p_moneda debe ser COP o USD%' and t234.huella(234306) = v_h1, v_r);
  v_r := t234.base(234306, 'vent', 'COP', t234.filas(1, 5));
  perform t234.afirma('F50c legacy: un rol sin permiso no publica y deja todo intacto', v_r like 'ERR%rol sin permiso%' and t234.huella(234306) = v_h1, v_r);
  v_r := t234.base(234306, 'oper', 'COP', t234.filas(1, 5));
  perform t234.afirma('F50d legacy vuelve a publicar (reemplaza el snapshot)', v_r = 'true' and (select count(*) from public.tarifario_resultado where paquete_id = 234306) = 1, v_r);
  v_r := t234.publicar_con(234306, 'oper', 'COP', t234.filas(1), 'null');
  perform t234.afirma('F50e el envoltorio 63 sigue rechazando un paquete legacy (modo)', v_r like 'ERR%' or v_r = 'false', v_r);

  -- TRM no finita / desbordada: no se publica, no se cotiza, no se guarda en el paquete.
  v_r := t234.publicar(234302, 'oper', '''NaN''::numeric', 'USD');
  perform t234.afirma('F54 publicar con TRM NaN se rechaza', v_r like 'ERR%TRM%', v_r);
  v_r := t234.publicar(234302, 'oper', '100000000000', 'USD');
  perform t234.afirma('F55 publicar con TRM desbordada se rechaza', v_r like 'ERR%TRM%', v_r);
  v_m := t234.msg('update public.armado_paquetes set trm_oferta = ''NaN''::numeric where id = 234302');
  perform t234.afirma('F56 el paquete no guarda una TRM NaN (CHECK armado_paquetes_trm_finita_chk)', v_m like '23514%trm_finita%', v_m);
  v_m := t234.msg('update public.armado_paquetes set trm_oferta = 100000000000 where id = 234302');
  perform t234.afirma('F57 el paquete no guarda una TRM desbordada', v_m like '23514%' or v_m like '22003%', v_m);

  -- Vía 2 · numerar. Una tasa provisional no finita o desbordada se rechaza ANTES de reservar número.
  perform t234.publicar(234305, 'oper', 'null', 'USD');
  v_cot := t234.cotizar('usd_sintrm', 'hF20');
  select last_value::text || '/' || is_called::text into v_seq_antes from public.contrato_seq_mayorista;
  select count(*) into v_n_antes from public.p63_aceptacion;
  v_a := t234.aceptar_con(v_cot, 'hF20', '100000000000');
  perform t234.afirma('F58 TRM provisional desbordada se rechaza (p63_trm_invalida)', v_a like 'ERR%p63_trm_invalida%', v_a);
  v_a := t234.aceptar_con(v_cot, 'hF20', '''Infinity''::numeric');
  perform t234.afirma('F59 TRM provisional Infinity se rechaza (p63_trm_invalida)', v_a like 'ERR%p63_trm_invalida%', v_a);
  perform t234.afirma('F60 ninguna reservó número ni dejó aceptación, y la oferta sigue abierta',
    (select last_value::text || '/' || is_called::text from public.contrato_seq_mayorista) = v_seq_antes
    and (select count(*) from public.p63_aceptacion) = v_n_antes
    and (select estado from public.p63_oferta where cotizacion_id = v_cot::bigint) = 'abierta');
end $$;

-- ═ F5 · hallazgo 1: SIN tasa ingresada no se numera, ni se crea aceptación, venta, CxP o asiento (aunque exista trm_referencia) ═════
do $$
declare v_cot text; v_a text; v_seq text; v_aceps int; v_ventas int; v_cxp int; v_asi int; v_r text;
begin
  perform t234.publicar(234305, 'oper', 'null', 'USD');
  update public.parametros_tributarios set valor = 4000 where parametro = 'trm_referencia';
  v_cot := t234.cotizar('usd_sintrm', 'hF30');
  select last_value::text || '/' || is_called::text into v_seq from public.contrato_seq_mayorista;
  select count(*) into v_aceps from public.p63_aceptacion;
  select count(*) into v_ventas from public.ventas;
  select count(*) into v_cxp from public.cuentas_por_pagar;
  select count(*) into v_asi from public.asientos_contables;
  perform t234.afirma('F61 (precondición) existe una TRM de referencia positiva y la oferta es USD sin TRM',
    exists (select 1 from public.parametros_tributarios where parametro = 'trm_referencia' and valor > 0)
    and (select trm is null and snapshot ->> 'moneda' = 'USD' from public.p63_oferta where cotizacion_id = v_cot::bigint));
  for v_r in select unnest(array['null', '0', '-1']) loop
    v_a := t234.aceptar_con(v_cot, 'hF30', v_r);
    perform t234.afirma('F62 tasa ' || v_r || ' se rechaza', v_a like 'ERR%p63_trm_%', v_a);
  end loop;
  v_a := t234.aceptar5(v_cot, 'hF30');
  perform t234.afirma('F63 la llamada de cinco argumentos se rechaza (p63_trm_requerida)', v_a like 'ERR%p63_trm_requerida%', v_a);
  perform t234.afirma('F64 el consecutivo no avanzó', (select last_value::text || '/' || is_called::text from public.contrato_seq_mayorista) = v_seq);
  perform t234.afirma('F65 ni aceptación, ni venta, ni CxP, ni asiento',
    (select count(*) from public.p63_aceptacion) = v_aceps and (select count(*) from public.ventas) = v_ventas
    and (select count(*) from public.cuentas_por_pagar) = v_cxp and (select count(*) from public.asientos_contables) = v_asi);
  perform t234.afirma('F66 la oferta sigue abierta', (select estado from public.p63_oferta where cotizacion_id = v_cot::bigint) = 'abierta');
  v_a := t234.aceptar_con(v_cot, 'hF30', '4150');
  perform t234.afirma('F67 con la tasa ingresada la misma oferta se acepta y se congela esa tasa (no la de referencia)',
    v_a like '%numero_contrato%' and (select trm_provisional from public.p63_aceptacion where cotizacion_id = v_cot::bigint) = 4150, v_a);
end $$;

-- ═ G · regresión: oferta en COP ══════════════════════════════════════════════════════════
do $$
declare v text;
begin
  perform t234.publicar(234304, 'oper');
  v := t234.recorrer('cop_cop', 'hG1');
  perform t234.afirma('G1 todo COP sin TRM: recorrido completo sin TRM (233)', v like '%creadas%', v);
  perform t234.afirma('G2 las CxP quedan sin TRM con equivalente = valor (COP)',
    (select count(*) from public.cuentas_por_pagar where numero_contrato = split_part(v, '|', 1) and trm_63 is null and moneda = 'COP' and valor_cop_63 = valor_total) = 2);
end $$;

-- ═ Z · conclusión ═══════════════════════════════════════════════════════════════════════
do $$
declare v_total int; v_ok int;
begin
  select count(*), count(*) filter (where ok) into v_total, v_ok from t234.res;
  perform t234.afirma('Z1 la batería ejecutó todas sus secciones (A-G)', v_total >= 65, 'afirmaciones: ' || v_total);
  select count(*), count(*) filter (where ok) into v_total, v_ok from t234.res;
  if v_ok <> v_total then
    raise exception 'TEST 234 SQL: % de % afirmaciones fallaron', v_total - v_ok, v_total;
  end if;
  raise notice 'TEST 234 SQL: TODO OK (% afirmaciones)', v_total;
end $$;

rollback;
