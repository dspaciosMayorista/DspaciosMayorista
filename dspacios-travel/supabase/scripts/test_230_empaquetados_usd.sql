-- ─────────────────────────────────────────────────────────────────────────
-- BATERÍA SQL · 230 = la batería de la 227 ADAPTADA (USD ya es válido en Empaquetados y en sus salidas vinculadas) + secciones U–W
-- con el vuelo en USD (CHECK, coherencia de moneda, invalidación, aceptación y CxP en su moneda de origen). SOLO bases desechables.
-- Corre en UNA transacción que termina en ROLLBACK.
--
-- Uso:  psql -X -q -v ON_ERROR_STOP=1 -f test_230_empaquetados_usd.sql   (base con 001-228 y la 230)
-- Cierre esperado: "TEST 230 SQL: TODO OK".
-- Cambios respecto de la batería de la 227: A8 (ahora EUR se rechaza y USD se acepta) y B7 (una vinculada USD a una fuente COP
-- se rechaza por la coherencia de moneda, ya no por el CHECK). Todo lo demás es idéntico y debe seguir en verde (compatibilidad).
--
--   A  columnas y CHECK: modo/TRM, modo 63 solo Dinámico con TRM, vinculada sin MK/TA/USD, empaquetados COP, CxP con equivalente
--   B  guardas de la salida vinculada: paquete Dinámico en modo 63, fuente SIN record (NULL o vacío; texto = record), único por
--      paquete, FK RESTRICT, vínculo aéreo de la 220 (diferido; inmediato en la prueba), cambio de modo bloqueado con vinculadas
--   C  publicar_tarifario_resultado_63: envuelve al publicador vigente; exige modo/COP/TRM; TRM cambiada = descarta (false);
--      guarda la TRM/fuentes en la tabla PRIVADA; rol y ACL
--   D  invalidación: record, tarifa, fee, destino, activo de la fuente y modo/TRM del paquete invalidan; notas NO; paquete ajeno NO;
--      conviven el trigger de la 226 (fee_infante) y el propio de la 227
--   E  extensión de la 220: apagar el check / quitar la alternativa con una salida vinculada hacia ella se RECHAZA
--   F  registrar_financiero_contrato: escribe valor_cop_63/trm_63 en la MISMA transacción; payload incompleto rechazado;
--      sin los campos = NULL (obligación de siempre); K15 (ya_completo); ACL solo service_role
--   G  tarifario_oferta_63 es PRIVADA (ni anon ni authenticated)
--   H  nada congelado se toca: ventas, abonos y cuentas por pagar de un contrato existente quedan idénticos
--   Z  conclusión: las pruebas fueron concluyentes (conteos de las propias fixtures, no literales)
-- ─────────────────────────────────────────────────────────────────────────
begin;

create schema t227;
create table t227.res (nombre text, ok boolean, detalle text);

create function t227.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void
language plpgsql as $$
begin
  insert into t227.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre;
  else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;

create function t227.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000227' || case p_k
    when 'super' then '001' when 'gere' then '002' when 'admi' then '003' when 'oper' then '004'
    when 'ctrl' then '005' when 'vent' then '006' when 'agen' then '008' else '999' end)::uuid
$$;

-- Ejecuta UNA consulta que devuelve un solo texto como el usuario `p_k` (NULL = sin sesión) con el rol de Postgres `p_rol`
-- (la API usa authenticated/anon/service_role). Devuelve el texto o 'ERR <sqlstate>'. `set local role` es imprescindible:
-- un superusuario SE SALTA la RLS.
create function t227.q(p_sql text, p_k text, p_rol text default 'authenticated') returns text
language plpgsql as $$
declare v_res text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_k is null then '' else json_build_object('sub', t227.u(p_k), 'role', p_rol)::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(t227.u(p_k)::text, ''), true);
    execute format('set local role %I', p_rol);
    execute p_sql into v_res;
  exception when others then
    v_res := 'ERR ' || sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_res;
end $$;

-- Como t227.q pero devuelve el MENSAJE del error (para distinguir las guardas por su prefijo).
create function t227.msg(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- ── Usuarios de prueba: uno por rol ─────────────────────────────────────────────────────────
insert into auth.users (id, email)
select t227.u(k), 'c227-' || k || '@x.test' from unnest(array['super','gere','admi','oper','ctrl','vent','agen']) k
on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t227.u(v.k), 'c227-' || v.k || '@x.test', 'C227 ' || v.k, v.r::rol_usuario, true, 'mayorista'
from (values ('super','superadmin'), ('gere','gerencia'), ('admi','administracion'), ('oper','operaciones'),
             ('ctrl','control_vuelo'), ('vent','venta'), ('agen','agencia')) v(k, r)
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values
  (227010, 'T227 CARTAGENA', 'CTG', 'Colombia', true),
  (227011, 'T227 SANTA MARTA', 'SMR', 'Colombia', true),
  (227012, 'T227 EXTRANJERO', 'MIA', 'Estados Unidos', true),
  (227013, 'T227 BARRANQUILLA', 'BAQ', 'Colombia', true);

insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id) values
  (227301, 'T227 dinamico (se pasa a modo 63)', 'dinamico', true, 227010),
  (227302, 'T227 dinamico legacy', 'dinamico', true, 227010),
  (227303, 'T227 bloqueo', 'bloqueo', true, 227010),
  (227304, 'T227 dinamico ajeno (no debe invalidarse)', 'dinamico', true, 227010);
select setval(pg_get_serial_sequence('public.armado_paquetes', 'id'), greatest((select max(id) from public.armado_paquetes), 227304));

insert into public.empaquetados (id, record, aerolinea, ruta, destino_id, fecha_ida, fecha_regreso, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo) values
  (227501, null,       'AEROTEST', 'BOG - CTG - BOG', 227010, current_date + 40, current_date + 43, 1000000, 1130000, 80500, true),
  (227502, '   ',      'AEROTEST', 'MDE - CTG - MDE', 227010, current_date + 41, current_date + 44, 1000000, 1130000, 80500, true),
  (227503, 'L93FYZ',   'AEROTEST', 'CLO - CTG - CLO', 227010, current_date + 42, current_date + 45, 1000000, 1130000, 80500, true),
  (227504, null,       'AEROTEST', 'BOG - SMR - BOG', 227011, current_date + 43, current_date + 46, 1000000, 1130000, 80500, true),
  (227505, null,       'AEROTEST', 'BOG - MIA - BOG', 227012, current_date + 44, current_date + 47, 1000000, 1130000, 80500, true),
  (227506, null,       'AEROTEST', 'BOG - CTG - BOG', 227010, current_date + 45, current_date + 48, 1000000, 1130000, 80500, true);

-- ═ A · columnas y CHECK ═══════════════════════════════════════════════════════════════════
do $$
declare v_m text;
begin
  perform t227.afirma('A1 todo paquete existente nace en modo legacy sin TRM',
    (select count(*) from public.armado_paquetes where id between 227301 and 227304 and modo_oferta = 'legacy' and trm_oferta is null) = 4);
  v_m := t227.msg('update public.armado_paquetes set modo_oferta = ''raro'' where id = 227302');
  perform t227.afirma('A2 modo_oferta fuera de (legacy, cop_trm_63) rechazado', v_m like '23514%', v_m);
  v_m := t227.msg('update public.armado_paquetes set modo_oferta = ''cop_trm_63'' where id = 227302');
  perform t227.afirma('A3 modo 63 SIN TRM rechazado (nunca hay TRM por omisión)', v_m like '23514%', v_m);
  v_m := t227.msg('update public.armado_paquetes set modo_oferta = ''cop_trm_63'', trm_oferta = 0 where id = 227302');
  perform t227.afirma('A4 TRM cero rechazada', v_m like '23514%', v_m);
  v_m := t227.msg('update public.armado_paquetes set modo_oferta = ''cop_trm_63'', trm_oferta = -4000 where id = 227302');
  perform t227.afirma('A5 TRM negativa rechazada', v_m like '23514%', v_m);
  v_m := t227.msg('update public.armado_paquetes set modo_oferta = ''cop_trm_63'', trm_oferta = 4000 where id = 227303');
  perform t227.afirma('A6 modo 63 en un paquete que NO es Dinámico rechazado', v_m like '23514%', v_m);
  update public.armado_paquetes set modo_oferta = 'cop_trm_63', trm_oferta = 4000 where id = 227301;
  perform t227.afirma('A7 modo 63 con TRM 4000 en un Dinámico se guarda',
    (select modo_oferta = 'cop_trm_63' and trm_oferta = 4000 from public.armado_paquetes where id = 227301));
  v_m := t227.msg('update public.empaquetados set moneda = ''EUR'' where id = 227501');
  perform t227.afirma('A8 empaquetados.moneda solo admite COP o USD (230): EUR rechazado', v_m like '23514%', v_m);
  perform t227.afirma('A9 los empaquetados existentes nacen en COP',
    (select count(*) from public.empaquetados where id between 227501 and 227506 and moneda = 'COP') = 6);
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, fecha_ida, moneda) values (227302, current_date + 50, ''EUR'')');
  perform t227.afirma('A10 salidas_dinamicas.moneda fuera de (COP, USD) rechazada', v_m like '23514%', v_m);
  v_m := t227.msg('insert into public.cuentas_por_pagar (numero_contrato, tenant, tipo_proveedor, valor_total, valor_cop_63) values (''DTM-9270'', ''mayorista'', ''hotel'', 210, 840000)');
  perform t227.afirma('A11 una CxP con valor_cop_63 SIN trm_63 rechazada (viajan juntos o no viajan)', v_m like '23514%' or v_m like '23503%', v_m);
end $$;

-- ═ B · guardas de la salida vinculada ═════════════════════════════════════════════════════
do $$
declare v_m text;
begin
  -- B1 paquete de siempre
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, aplica_mk, ta) values (227302, 227501, current_date + 40, false, 0)');
  perform t227.afirma('B1 vincular en un paquete legacy rechazado (salida_vinculada_modo)', v_m like '%salida_vinculada_modo%', v_m);
  -- B2 Bloqueo
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, aplica_mk, ta) values (227303, 227501, current_date + 40, false, 0)');
  perform t227.afirma('B2 vincular en un paquete Bloqueo rechazado', v_m like '%salida_vinculada_modo%', v_m);
  -- B3 fuente con record
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, aplica_mk, ta) values (227301, 227503, current_date + 42, false, 0)');
  perform t227.afirma('B3 la fuente con record (PNR) no se vincula (salida_vinculada_record)', v_m like '%salida_vinculada_record%', v_m);
  -- B4 fuente inexistente
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, aplica_mk, ta) values (227301, 999999, current_date + 42, false, 0)');
  perform t227.afirma('B4 una fuente inexistente se rechaza', v_m like '%salida_vinculada_fuente%' or v_m like '23503%', v_m);
  -- B5 doble margen
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, aplica_mk, ta) values (227301, 227501, current_date + 40, true, 0)');
  perform t227.afirma('B5 una vinculada con markup (aplica_mk) es doble margen: rechazada (CHECK)', v_m like '23514%', v_m);
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, aplica_mk, ta) values (227301, 227501, current_date + 40, false, 50000)');
  perform t227.afirma('B6 una vinculada con TA es doble margen: rechazada (CHECK)', v_m like '23514%', v_m);
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, aplica_mk, ta, moneda) values (227301, 227501, current_date + 40, false, 0, ''USD'')');
  perform t227.afirma('B7 una vinculada en USD a una fuente COP rechazada (230: coherencia de moneda, ya no el CHECK)', v_m like '%salida_vinculada_moneda%', v_m);
  -- B8 alta válida: record NULL y record solo espacios
  insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, fee_infante, aplica_mk, ta)
  values (227301, 227501, current_date + 40, current_date + 43, 'BOG - CTG - BOG', 'AEROTEST', 1130000, 80500, false, 0);
  insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, fee_infante, aplica_mk, ta)
  values (227301, 227502, current_date + 41, current_date + 44, 'MDE - CTG - MDE', 'AEROTEST', 1130000, 80500, false, 0);
  perform t227.afirma('B8 se vinculan las fuentes con record NULL y con record de solo espacios',
    (select count(*) from public.salidas_dinamicas where paquete_id = 227301 and empaquetado_id in (227501, 227502)) = 2);
  -- B9 único por (paquete, fuente)
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, aplica_mk, ta) values (227301, 227501, current_date + 40, false, 0)');
  perform t227.afirma('B9 la misma fuente no se vincula dos veces al mismo paquete (23505)', v_m like '23505%', v_m);
  -- B10 FK RESTRICT
  v_m := t227.msg('delete from public.empaquetados where id = 227501');
  perform t227.afirma('B10 no se borra un Empaquetado vinculado (FK RESTRICT, 23001)', v_m like '23001%' or v_m like '23503%', v_m);
  -- B11 las salidas manuales siguen idénticas: sin vínculo
  insert into public.salidas_dinamicas (paquete_id, fecha_ida, fecha_regreso, valor_tiquete, aplica_mk, ta) values (227302, current_date + 50, current_date + 53, 400000, true, 0);
  perform t227.afirma('B11 una salida MANUAL (sin vínculo) sigue creándose como siempre, con markup y moneda COP',
    (select empaquetado_id is null and aplica_mk and moneda = 'COP' from public.salidas_dinamicas where paquete_id = 227302 and valor_tiquete = 400000));
  -- B12 vínculo aéreo de la 220 (diferido; se fuerza inmediato para probarlo en la misma transacción)
  set constraints tr_vinculo_aereo_67_salida immediate;
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, aplica_mk, ta) values (227301, 227504, current_date + 43, false, 0)');
  perform t227.afirma('B12 el destino de llegada (SMR) no es el comercial (CTG) y el check está apagado: rechazado (destino_aereo_no_permitido)', v_m like '%destino_aereo_no_permitido%', v_m);
  update public.armado_paquetes set destinos_aereos_alternativos = true where id = 227301;
  set constraints all deferred;
  insert into public.armado_paquete_destinos_aereos (paquete_id, destino_id) values (227301, 227011), (227301, 227013);
  set constraints all immediate;
  insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, fee_infante, aplica_mk, ta)
  values (227301, 227504, current_date + 43, current_date + 46, 'BOG - SMR - BOG', 'AEROTEST', 1130000, 80500, false, 0);
  perform t227.afirma('B13 con el check encendido y SMR entre las alternativas (mismo país) la vinculación SÍ pasa',
    exists (select 1 from public.salidas_dinamicas where paquete_id = 227301 and empaquetado_id = 227504));
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, aplica_mk, ta) values (227301, 227505, current_date + 44, false, 0)');
  perform t227.afirma('B14 un destino de OTRO país nunca se autoriza (destino_aereo_no_permitido)', v_m like '%destino_aereo_no_permitido%', v_m);
  -- B15 no se sale del modo 63 con vinculadas
  v_m := t227.msg('update public.armado_paquetes set modo_oferta = ''legacy'', trm_oferta = null where id = 227301');
  perform t227.afirma('B15 no se puede volver a legacy con salidas vinculadas (modo_oferta_vinculadas)', v_m like '%modo_oferta_vinculadas%', v_m);
  v_m := t227.msg('update public.armado_paquetes set tipo = ''bloqueo'' where id = 227301');
  perform t227.afirma('B16 no se puede cambiar el tipo con salidas vinculadas', v_m like '%modo_oferta_vinculadas%' or v_m like '23514%', v_m);
end $$;

-- ═ C · publicar_tarifario_resultado_63 ═══════════════════════════════════════════════════════
create function t227.publicar(p_paquete bigint, p_filas jsonb, p_k text, p_moneda text default 'COP', p_modo text default 'cop_trm_63', p_trm numeric default 4000) returns text
language plpgsql as $$
declare v_gen bigint; v_rev bigint;
begin
  select tarifario_generacion, tarifario_revision_fuente into v_gen, v_rev from public.armado_paquetes where id = p_paquete;
  return t227.q(format('select public.publicar_tarifario_resultado_63(%s, %s, %s, %L, %L::jsonb, %L, %s)::text', p_paquete, v_gen, v_rev, p_moneda, p_filas::text, p_modo, p_trm), p_k);
end $$;

do $$
declare v_res text; v_filas jsonb;
begin
  v_filas := jsonb_build_array(
    jsonb_build_object('modulo', 'dinamico', 'salida_id', (select id from public.salidas_dinamicas where paquete_id = 227301 and empaquetado_id = 227501),
                       'categoria', 'ESTANDAR', 'regimen', 'PC', 'acomodacion', 'doble', 'noches', 3,
                       'fecha_ida', '2030-01-10', 'fecha_regreso', '2030-01-13', 'base_comisionable', 550000, 'impuesto', 1130000, 'precio_pvp', 1680000),
    jsonb_build_object('modulo', 'dinamico', 'salida_id', (select id from public.salidas_dinamicas where paquete_id = 227301 and empaquetado_id = 227501),
                       'categoria', 'ESTANDAR', 'regimen', 'PC', 'acomodacion', 'infante', 'noches', 3,
                       'fecha_ida', '2030-01-10', 'fecha_regreso', '2030-01-13', 'base_comisionable', 100, 'impuesto', 0,
                       'precio_pvp', 1230000, 'precio_pvp_menor2', 130500));
  -- C1 publicación válida
  v_res := t227.publicar(227301, v_filas, 'oper');
  perform t227.afirma('C1 operaciones publica un snapshot 63 (el envoltorio llama al publicador vigente)', v_res = 'true', 'res=' || coalesce(v_res, '<null>'));
  perform t227.afirma('C2 las filas quedan en COP con precio_pvp_menor2 (lo persiste el publicador de la 226)',
    (select count(*) from public.tarifario_resultado where paquete_id = 227301 and moneda = 'COP') = 2
    and (select precio_pvp_menor2 from public.tarifario_resultado where paquete_id = 227301 and acomodacion = 'infante') = 130500);
  perform t227.afirma('C3 la TRM, el modo y las fuentes de ESA publicación quedan en la tabla privada',
    (select trm = 4000 and modo = 'cop_trm_63' and generacion is not null and jsonb_array_length(fuentes) = 3 from public.tarifario_oferta_63 where paquete_id = 227301));
  perform t227.afirma('C4 las fuentes guardadas traen R y F, nunca el costo del proveedor',
    (select bool_and(f ? 'valor_tiquete' and f ? 'fee_infante' and not (f ? 'tarifa_proveedor')) from public.tarifario_oferta_63 o, jsonb_array_elements(o.fuentes) f where o.paquete_id = 227301));
  perform t227.afirma('C5 el paquete queda COP y publicable',
    (select moneda = 'COP' and tarifario_snapshot_publicable from public.armado_paquetes where id = 227301));
  -- C6 validaciones del envoltorio
  v_res := t227.publicar(227301, v_filas, 'oper', 'USD');
  perform t227.afirma('C6 el envoltorio rechaza una moneda distinta de COP', v_res like 'ERR%', 'res=' || coalesce(v_res, '<null>'));
  v_res := t227.publicar(227301, v_filas, 'oper', 'COP', 'legacy');
  perform t227.afirma('C7 el envoltorio rechaza un modo distinto de cop_trm_63', v_res like 'ERR%', 'res=' || coalesce(v_res, '<null>'));
  v_res := t227.publicar(227301, v_filas, 'oper', 'COP', 'cop_trm_63', 0);
  perform t227.afirma('C8 el envoltorio rechaza una TRM no positiva', v_res like 'ERR%', 'res=' || coalesce(v_res, '<null>'));
  -- C9 la TRM del paquete cambió mientras se calculaba: se DESCARTA (false), no se publica con la TRM vieja
  v_res := t227.publicar(227301, v_filas, 'oper', 'COP', 'cop_trm_63', 4100);
  perform t227.afirma('C9 TRM distinta de la del paquete = publicación descartada (false), sin tocar el snapshot', v_res = 'false', 'res=' || coalesce(v_res, '<null>'));
  perform t227.afirma('C10 ...y la tabla privada conserva la TRM de la publicación vigente', (select trm from public.tarifario_oferta_63 where paquete_id = 227301) = 4000);
  -- C11 paquete que no está en modo 63
  v_res := t227.publicar(227302, '[]'::jsonb, 'oper');
  perform t227.afirma('C11 un paquete en modo legacy no publica por el envoltorio (false)', v_res = 'false', 'res=' || coalesce(v_res, '<null>'));
  -- C12 roles
  v_res := t227.publicar(227301, v_filas, 'vent');
  perform t227.afirma('C12 venta no publica (rol sin permiso)', v_res like 'ERR%', 'res=' || coalesce(v_res, '<null>'));
  v_res := t227.q('select public.publicar_tarifario_resultado_63(227301, 1, 1, ''COP'', ''[]''::jsonb, ''cop_trm_63'', 4000)::text', null, 'anon');
  perform t227.afirma('C13 anon no ejecuta el envoltorio', v_res like 'ERR%', 'res=' || coalesce(v_res, '<null>'));
  perform t227.afirma('C14 ACL: authenticated sí, anon no',
    has_function_privilege('authenticated', 'public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)', 'EXECUTE'));
  -- C15 el publicador vigente sigue siendo usable por sí solo (paquete legacy, como siempre)
  v_res := t227.q('select public.publicar_tarifario_resultado(227302, (select tarifario_generacion from public.armado_paquetes where id = 227302), (select tarifario_revision_fuente from public.armado_paquetes where id = 227302), ''COP'', ''[]''::jsonb)::text', 'oper');
  perform t227.afirma('C15 el publicador de la 226 sigue funcionando directo para un paquete de siempre', v_res = 'true', 'res=' || coalesce(v_res, '<null>'));
end $$;

-- ═ D · invalidación ════════════════════════════════════════════════════════════════════════
create function t227.rev(p_paquete bigint) returns bigint language sql stable as $$
  select tarifario_revision_fuente from public.armado_paquetes where id = p_paquete
$$;

do $$
declare r0 bigint; r1 bigint;
begin
  r0 := t227.rev(227301);
  update public.empaquetados set tarifa_para_empaquetar = 1200000 where id = 227501;
  perform t227.afirma('D1 cambiar la tarifa de la fuente invalida el paquete con la salida vinculada',
    t227.rev(227301) > r0 and (select tarifario_estado from public.armado_paquetes where id = 227301) = 'pendiente' and not (select tarifario_snapshot_publicable from public.armado_paquetes where id = 227301),
    'r0=' || r0);
  update public.empaquetados set tarifa_para_empaquetar = 1130000 where id = 227501;
  r0 := t227.rev(227301);
  update public.empaquetados set record = 'NUEVO1' where id = 227502;
  perform t227.afirma('D2 agregar un record (PNR) a la fuente invalida (y NO borra el vínculo)',
    t227.rev(227301) > r0 and exists (select 1 from public.salidas_dinamicas where paquete_id = 227301 and empaquetado_id = 227502), 'r0=' || r0);
  r0 := t227.rev(227301);
  update public.empaquetados set record = null where id = 227502;
  perform t227.afirma('D3 quitar el record vuelve a invalidar (revisión), sin incorporar nada solo', t227.rev(227301) > r0);
  r0 := t227.rev(227301);
  update public.empaquetados set tarifa_proveedor = 1100000 where id = 227501;
  perform t227.afirma('D4 cambiar el costo (tarifa_proveedor) invalida: el CxP futuro cambia', t227.rev(227301) > r0);
  r0 := t227.rev(227301);
  update public.empaquetados set fee_infante = 90000 where id = 227501;
  perform t227.afirma('D5 cambiar fee_infante invalida (coexisten el trigger de la 226 y el propio de la 227)', t227.rev(227301) > r0);
  r0 := t227.rev(227301);
  update public.empaquetados set activo = false where id = 227501;
  perform t227.afirma('D6 desactivar la fuente invalida', t227.rev(227301) > r0);
  update public.empaquetados set activo = true where id = 227501;
  r0 := t227.rev(227301);
  update public.empaquetados set notas = 'solo una nota' where id = 227501;
  perform t227.afirma('D7 una nota (columna sin efecto comercial) NO invalida', t227.rev(227301) = r0, 'r0=' || r0 || ' ahora=' || t227.rev(227301));
  r0 := t227.rev(227301);
  update public.empaquetados set fee_infante = fee_infante where id = 227501;
  perform t227.afirma('D8 un UPDATE que no cambia nada NO invalida (IS DISTINCT FROM)', t227.rev(227301) = r0);
  -- paquete ajeno: ninguna fuente suya
  r0 := t227.rev(227304);
  update public.empaquetados set tarifa_para_empaquetar = 1131000 where id = 227501;
  perform t227.afirma('D9 un paquete sin salidas vinculadas a esa fuente no se invalida', t227.rev(227304) = r0);
  update public.empaquetados set tarifa_para_empaquetar = 1130000 where id = 227501;
  -- modo/TRM del paquete
  r0 := t227.rev(227301);
  update public.armado_paquetes set trm_oferta = 4050 where id = 227301;
  perform t227.afirma('D10 cambiar la TRM del paquete invalida el tarifario (bloqueante)',
    t227.rev(227301) > r0 and not (select tarifario_snapshot_publicable from public.armado_paquetes where id = 227301));
  update public.armado_paquetes set trm_oferta = 4000 where id = 227301;
  -- la 226 sigue invalidando por fee_infante vía armado_empaquetados (Bloqueo/Sistema), sin que la 227 lo pise
  insert into public.armado_empaquetados (paquete_id, empaquetado_id) values (227303, 227506);
  r1 := t227.rev(227303);
  update public.empaquetados set fee_infante = 70000 where id = 227506;
  perform t227.afirma('D11 el trigger de la 226 sigue invalidando un paquete Bloqueo/Sistema por fee_infante', t227.rev(227303) > r1);
end $$;

-- ═ E · la guarda de configuración de la 220 cuenta las salidas vinculadas ═══════════════════════
do $$
declare v_m text;
begin
  perform t227.afirma('E0 (precondición) la salida vinculada hacia SMR existe', exists (select 1 from public.salidas_dinamicas where paquete_id = 227301 and empaquetado_id = 227504));
  -- la guarda de configuración es diferida (constraint trigger): se fuerza al instante
  set constraints tr_config_paquete_aereo_67_upd immediate;
  v_m := t227.msg('update public.armado_paquetes set destinos_aereos_alternativos = false where id = 227301');
  set constraints all deferred;
  perform t227.afirma('E1 apagar el check con una salida vinculada hacia SMR se rechaza (destino_aereo_vinculos)', v_m like '%destino_aereo_vinculos%', v_m);
  set constraints tr_config_alternativa_aerea_67 immediate;
  v_m := t227.msg('delete from public.armado_paquete_destinos_aereos where paquete_id = 227301 and destino_id = 227011');
  set constraints all deferred;
  perform t227.afirma('E2 retirar la alternativa SMR con una salida vinculada hacia ella se rechaza (destino_aereo_vinculos)', v_m like '%destino_aereo_vinculos%', v_m);
  -- tras desvincular explícitamente, sí se puede
  delete from public.salidas_dinamicas where paquete_id = 227301 and empaquetado_id = 227504;
  set constraints tr_config_alternativa_aerea_67 immediate;
  v_m := t227.msg('delete from public.armado_paquete_destinos_aereos where paquete_id = 227301 and destino_id = 227011');
  set constraints all deferred;
  perform t227.afirma('E3 tras desvincular explícitamente la salida, retirar la alternativa sí se permite', v_m = 'OK', v_m);
  -- ya sin salida hacia SMR se puede apagar el check
  update public.armado_paquetes set destinos_aereos_alternativos = false where id = 227301;
  perform t227.afirma('E4 y apagar el check también', not (select destinos_aereos_alternativos from public.armado_paquetes where id = 227301));
end $$;

-- ═ F · registrar_financiero_contrato: un contrato SIN aceptación #63 ejecuta EXACTAMENTE la semántica de la 210 ═══════════════
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, financiero_estado) values
  ('DTM-9271', 'Cliente F227A', 'mayorista', 3490500, 'pendiente'),
  ('DTM-9272', 'Cliente F227B', 'mayorista', 1000000, 'pendiente'),
  ('DTM-9273', 'Cliente F227C', 'mayorista', 1000000, 'pendiente');

do $$
declare v_r jsonb; v_m text;
begin
  v_r := public.registrar_financiero_contrato('DTM-9271', 'mayorista', '{"costo_hotel": 840000, "costo_aereo": 2080500}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('tipo_proveedor', 'hotel', 'proveedor', 'Hotel T227', 'servicio', 'Hotel T227', 'valor_total', 210, 'moneda', 'USD', 'fecha_obligacion', current_date),
      jsonb_build_object('tipo_proveedor', 'aereo', 'proveedor', 'AEROTEST', 'servicio', 'Aéreo', 'valor_total', 2080500, 'moneda', 'COP', 'fecha_obligacion', current_date)));
  perform t227.afirma('F1 un contrato de siempre: la RPC crea las dos CxP y las devuelve (semántica 210)', jsonb_array_length(v_r->'creadas') = 2, v_r::text);
  perform t227.afirma('F2 los costos (COP) y el estado completo salen de la MISMA transacción, con financiero_registrado_en',
    (select costo_hotel = 840000 and costo_aereo = 2080500 and financiero_estado = 'completo' and financiero_registrado_en is not null from public.ventas where numero_contrato = 'DTM-9271'));
  perform t227.afirma('F3 la CxP en USD de siempre conserva su moneda y NO lleva marca #63',
    (select moneda = 'USD' and valor_total = 210 and valor_cop_63 is null and trm_63 is null and aceptacion_63_id is null and obligacion_63 is null
       from public.cuentas_por_pagar where numero_contrato = 'DTM-9271' and tipo_proveedor = 'hotel'));
  -- K15: una segunda llamada es un no-op
  v_r := public.registrar_financiero_contrato('DTM-9271', 'mayorista', '{"costo_hotel": 1}'::jsonb, '[]'::jsonb);
  perform t227.afirma('F4 K15: sobre un contrato ya completo responde ya_completo y no toca nada',
    (v_r->>'ya_completo')::boolean and (select costo_hotel = 840000 from public.ventas where numero_contrato = 'DTM-9271')
    and (select count(*) from public.cuentas_por_pagar where numero_contrato = 'DTM-9271') = 2, v_r::text);
  -- 210 exacta: los campos del #63 que mande el llamador NO se interpretan en un contrato de siempre (el INSERT de la 210 no los conoce)
  v_r := public.registrar_financiero_contrato('DTM-9272', 'mayorista', '{"costo_hotel": 500000}'::jsonb,
    jsonb_build_array(jsonb_build_object('tipo_proveedor', 'hotel', 'proveedor', 'Hotel T227', 'servicio', 'Hotel', 'valor_total', 500000, 'valor_cop', 1, 'trm', 1, 'fecha_obligacion', current_date)));
  perform t227.afirma('F5 un contrato de siempre ignora valor_cop/trm del payload (210 exacta): quedan NULL y moneda COP',
    (select valor_cop_63 is null and trm_63 is null and moneda = 'COP' and aceptacion_63_id is null from public.cuentas_por_pagar where numero_contrato = 'DTM-9272'));
  -- validaciones de la 210
  v_m := t227.msg($q$select public.registrar_financiero_contrato('DTM-9273', 'mayorista', '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('tipo_proveedor', 'hotel', 'servicio', 'Hotel', 'valor_total', 'mucho')))$q$);
  perform t227.afirma('F6 210: un valor_total no numérico se rechaza antes de escribir', v_m <> 'OK', v_m);
  v_m := t227.msg($q$select public.registrar_financiero_contrato('DTM-9273', 'mayorista', '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('tipo_proveedor', 'hotel', 'servicio', 'Hotel', 'valor_total', -5)))$q$);
  perform t227.afirma('F7 210: un valor_total negativo se rechaza', v_m <> 'OK', v_m);
  v_m := t227.msg($q$select public.registrar_financiero_contrato('DTM-9273', 'mayorista', '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('servicio', 'Hotel', 'valor_total', 5)))$q$);
  perform t227.afirma('F8 210: una CxP sin tipo_proveedor se rechaza', v_m <> 'OK', v_m);
  perform t227.afirma('F9 los rechazos no dejaron CxP ni cambiaron el estado del contrato (sigue pendiente)',
    not exists (select 1 from public.cuentas_por_pagar where numero_contrato = 'DTM-9273')
    and (select financiero_estado from public.ventas where numero_contrato = 'DTM-9273') = 'pendiente');
  v_m := t227.msg($q$select public.registrar_financiero_contrato('DTM-9999', 'mayorista', '{}'::jsonb, '[]'::jsonb)$q$);
  perform t227.afirma('F10 210: un contrato inexistente se rechaza', v_m like '%no existe%', v_m);
  -- ACL
  perform t227.afirma('F11 ACL: solo service_role ejecuta la RPC financiera (ni anon ni authenticated)',
    has_function_privilege('service_role', 'public.registrar_financiero_contrato(text, text, jsonb, jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.registrar_financiero_contrato(text, text, jsonb, jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.registrar_financiero_contrato(text, text, jsonb, jsonb)', 'EXECUTE'));
  v_m := t227.q($q$select public.registrar_financiero_contrato('DTM-9273', 'mayorista', '{}'::jsonb, '[]'::jsonb)::text$q$, 'super');
  perform t227.afirma('F12 un superadmin de la API (authenticated) no ejecuta la RPC financiera', v_m like 'ERR%', v_m);
  perform t227.afirma('F13 las funciones nuevas de E/F/G no son invocables por anon ni authenticated (solo service_role las dos RPC)',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and (p.proname like 'p63\_%' or p.proname like 'trg\_p63\_%' or p.proname in ('trg_ventas_aceptacion_63_ins', 'trg_ventas_borrada_63', 'trg_ventas_costos_63', 'trg_cxp_aceptacion_63', 'trg_cxp_borrada_63'))
                   and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')))
    and has_function_privilege('service_role', 'public.aceptar_oferta_63(bigint, text, uuid, text, text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.aceptar_oferta_63(bigint, text, uuid, text, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.crear_cotizacion_oferta_63(uuid, text, jsonb, jsonb, text, text, jsonb)', 'EXECUTE'));
end $$;

-- ═ G · la metadata 63 es PRIVADA ═════════════════════════════════════════════════════════
do $$
declare v_res text;
begin
  v_res := t227.q('select count(*)::text from public.tarifario_oferta_63', 'super');
  perform t227.afirma('G1 ni un superadmin autenticado lee tarifario_oferta_63 por la API', v_res like 'ERR%', 'res=' || coalesce(v_res, '<null>'));
  v_res := t227.q('select count(*)::text from public.tarifario_oferta_63', null, 'anon');
  perform t227.afirma('G2 anon tampoco', v_res like 'ERR%', 'res=' || coalesce(v_res, '<null>'));
  v_res := t227.q('insert into public.tarifario_oferta_63 (paquete_id, modo, trm, generacion) values (227304, ''cop_trm_63'', 1, 1) returning ''x''', 'oper');
  perform t227.afirma('G3 ningún rol de la API escribe tarifario_oferta_63', v_res like 'ERR%', 'res=' || coalesce(v_res, '<null>'));
  perform t227.afirma('G4 RLS activada y sin policies',
    (select relrowsecurity from pg_class where oid = 'public.tarifario_oferta_63'::regclass)
    and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'tarifario_oferta_63') = 0);
  perform t227.afirma('G5 las funciones de trigger de la 227 no son invocables por la API',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('trg_modo_oferta_vinculadas_63', 'trg_invalidar_modo_oferta_63', 'trg_salida_vinculada_63', 'trg_vinculo_aereo_67_salida', 'tarifario_trg_empaquetado_vinculadas_63')
                   and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))));
end $$;

-- ═ H · lo congelado no se toca ═══════════════════════════════════════════════════════════════
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta) values ('DTM-9279', 'Cliente prueba 227', 'mayorista', 4765000);
insert into public.abonos (numero_contrato, tenant, valor_abono, fecha_abono) values ('DTM-9279', 'mayorista', 1000000, current_date);
insert into public.cuentas_por_pagar (numero_contrato, tenant, tipo_proveedor, servicio, valor_total) values ('DTM-9279', 'mayorista', 'hotel', 'Hotel T227', 860000);
do $$
declare v_antes text; v_despues text;
begin
  v_antes := (select md5(string_agg(x, '|' order by x)) from (
    select v::text as x from public.ventas v where numero_contrato = 'DTM-9279'
    union all select a::text from public.abonos a where numero_contrato = 'DTM-9279'
    union all select c::text from public.cuentas_por_pagar c where numero_contrato = 'DTM-9279') s);
  -- Operaciones de la 227 sobre fuentes y paquetes (no tocan estas tablas).
  update public.empaquetados set tarifa_para_empaquetar = 1140000 where id = 227501;
  update public.armado_paquetes set trm_oferta = 4010 where id = 227301;
  perform t227.publicar(227301, '[]'::jsonb, 'oper');
  v_despues := (select md5(string_agg(x, '|' order by x)) from (
    select v::text as x from public.ventas v where numero_contrato = 'DTM-9279'
    union all select a::text from public.abonos a where numero_contrato = 'DTM-9279'
    union all select c::text from public.cuentas_por_pagar c where numero_contrato = 'DTM-9279') s);
  perform t227.afirma('H1 ventas, abonos y cuentas por pagar del contrato DTM-9279 quedan idénticos', v_antes is not null and v_antes = v_despues, 'antes=' || coalesce(v_antes, '<null>') || ' despues=' || coalesce(v_despues, '<null>'));
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- E/F/G · ACEPTACIÓN ATÓMICA, FENCING DE LA CABECERA, MATERIALIZACIÓN Y RPC FINANCIERA DERIVADA
--   I  cotizar (cotización + oferta + snapshot en UNA transacción) y aceptar (número reservado, intento único, ACL)
--   J  rechazos de la aceptación: revisión, costo/proveedor/retención con PVP igual, TRM, tarifario regenerado, huellas, reloj
--   K  fencing de la cabecera: número reservado, intento vigente, worker viejo, tombstone, reapertura tras reversión
--   L  H: payload derivado de lo aceptado; llamada directa / pendiente adulterados; ya_completo; protecciones de lo aceptado
--   M  cortes: tras aceptar / tras cabecera / tras hijos / tras pendiente / respuesta perdida; catálogo cambiado después de aceptar
--   N  cobertura de revisión: cada fuente de costo/proveedor/retención sube el contador (o está exenta con motivo)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

create function t227.try(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, 'OK');
exception when others then
  return 'ERR ' || sqlstate || ' ' || sqlerrm;
end $$;

create function t227.t0(p_paquete bigint) returns jsonb language sql stable as $$
  select jsonb_build_object('rev_fuente', tarifario_revision_fuente, 'rev_publicada', tarifario_revision_publicada,
                            'gen_publicada', tarifario_generacion_publicada, 'rev_costos', p63_rev_costos)
    from public.armado_paquetes where id = p_paquete
$$;

-- Snapshot de una oferta (misma forma que arma el servidor): cabecera, hijos esperados y payload financiero SIN fecha de obligación.
create function t227.snap(p_paquete bigint, p_salida bigint, p_emp bigint) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'v', 1, 'paquete_id', p_paquete, 'salida_id', p_salida, 'empaquetado_id', p_emp, 'trm', 4000, 'moneda', 'COP',
    'cabecera', jsonb_build_object('tipo_paquete', 'dinamico', 'moneda', 'COP', 'fecha_salida', (current_date + 60)::text,
        'fecha_regreso', (current_date + 63)::text, 'pax', 2, 'destino', 'T227 CARTAGENA', 'hotel', 'T227 HOTEL',
        'precio_venta', 3360000, 'impuesto', 2260000, 'costo_aereo', 2080500, 'aerolinea', 'AEROTEST',
        'plan_nombre', 'ESTANDAR · PC', 'paquete_armado_id', p_paquete, 'n_tramos', 2, 'n_items', 1, 'n_hoteles', 1,
        'tipo_asesor', 'interno', 'canal', 'B2C'),
    'b2b', null, 'vigencias', '[]'::jsonb,
    'financiero', jsonb_build_object(
      'costos', jsonb_build_object('costo_hotel', 840000, 'costo_aereo', 2080500),
      'cxp', jsonb_build_array(
        jsonb_build_object('obligacion', 'aereo:0', 'tipo_proveedor', 'aereo', 'proveedor', 'AEROTEST', 'servicio', 'Aéreo AEROTEST',
          'valor_total', 2080500, 'moneda', 'COP', 'valor_cop', 2080500, 'trm', 4000, 'aplica_retencion', false, 'pct_retencion', 0,
          'observaciones', 'Generado automáticamente desde el tarifario', 'servicio_id', null),
        jsonb_build_object('obligacion', 'hotel:0', 'tipo_proveedor', 'hotel', 'proveedor', 'T227 PROV HOTEL', 'servicio', 'Hotel T227 HOTEL',
          'valor_total', 210, 'moneda', 'USD', 'valor_cop', 840000, 'trm', 4000, 'aplica_retencion', true, 'pct_retencion', 0.035,
          'observaciones', 'Generado automáticamente desde el tarifario', 'servicio_id', null))))
$$;

create function t227.salida63(p_paquete bigint) returns bigint language sql stable as $$
  select id from public.salidas_dinamicas where paquete_id = p_paquete and empaquetado_id is not null order by id limit 1
$$;

-- Crea una cotización 63 como lo hace el servidor (service_role). Devuelve el id o 'ERR <sqlstate> <mensaje>'.
create function t227.cotizar(p_paquete bigint default 227310, p_huella text default 'h1', p_hf text default 'f1', p_t0 jsonb default null, p_b2b jsonb default null, p_vig jsonb default '[]'::jsonb) returns text language plpgsql as $$
declare v_cot jsonb; v_snap jsonb;
begin
  v_snap := t227.snap(p_paquete, t227.salida63(p_paquete), 227507);
  v_snap := jsonb_set(v_snap, '{vigencias}', coalesce(p_vig, '[]'::jsonb));
  if p_b2b is not null then
    v_snap := jsonb_set(v_snap, '{b2b}', p_b2b);
    v_snap := jsonb_set(v_snap, '{cabecera,tipo_asesor}', to_jsonb(p_b2b ->> 'tipo_asesor'));
    v_snap := jsonb_set(v_snap, '{cabecera,canal}', '"B2B"'::jsonb);
  end if;
  v_cot := jsonb_build_object('tenant', 'mayorista', 'payload', jsonb_build_object('x', 1), 'detalle', '{}'::jsonb, 'cliente', 'Cliente 227',
    'destino', 'T227 CARTAGENA', 'hotel', 'T227 HOTEL', 'modulo', 'dinamico', 'plan_nombre', 'ESTANDAR · PC', 'pax', 2, 'precio_venta', 3360000,
    'moneda', 'COP', 'fecha_salida', (current_date + 60)::text, 'fecha_regreso', (current_date + 63)::text, 'vigencia_hasta', (current_date + 1)::text,
    'paquete_armado_id', p_paquete, 'asesor', 'Asesor 227', 'creado_por', 'c227@x.test');
  return t227.try(format('select public.crear_cotizacion_oferta_63(%L::uuid, ''mayorista'', %L::jsonb, %L::jsonb, %L, %L, %L::jsonb)::text',
    t227.u('vent'), v_cot::text, v_snap::text, p_huella, p_hf, coalesce(p_t0, t227.t0(p_paquete))::text));
end $$;

create function t227.aceptar(p_cot text, p_h text default 'h1', p_hf text default 'f1', p_tenant text default 'mayorista', p_usuario uuid default null) returns text language plpgsql as $$
begin
  return t227.try(format('select public.aceptar_oferta_63(%s, %L, %L::uuid, %L, %L)::text', p_cot, p_tenant, coalesce(p_usuario, t227.u('vent')), p_h, p_hf));
end $$;

-- Cabecera como la inserta la app: los valores de lo aceptado + el marcador.
create function t227.cabecera(p_numero text, p_acep bigint, p_precio numeric default 3360000, p_b2b jsonb default null) returns text language plpgsql as $$
begin
  return t227.try(format($f$insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, fecha_salida, fecha_regreso, pax, hotel, destino,
      precio_venta, impuesto, costo_aereo, aerolinea, estado, financiero_estado, plan_nombre, paquete_armado_id, aceptacion_63_id,
      tipo_asesor, canal, aliado_id, modo_compra, comision_b2b, comision_estado)
    values (%L, 'mayorista', 'Cliente 227', 'dinamico', 'COP', current_date + 60, current_date + 63, 2, 'T227 HOTEL', 'T227 CARTAGENA',
      %s, 2260000, 2080500, 'AEROTEST', 'pendiente', 'pendiente', 'ESTANDAR · PC', 227310, %s,
      %L, %L, %L, %L, %L, %L) returning 'OK'$f$, p_numero, p_precio, p_acep,
      coalesce(p_b2b ->> 'tipo_asesor', 'interno'), case when p_b2b is null then 'B2C' else 'B2B' end, p_b2b ->> 'aliado_id', p_b2b ->> 'modo_compra', p_b2b ->> 'comision', p_b2b ->> 'comision_estado'));
end $$;

create function t227.hijos(p_numero text, p_vuelos int default 2, p_items int default 1, p_hoteles int default 1) returns void language plpgsql as $$
begin
  insert into public.contrato_vuelos (numero_contrato) select p_numero from generate_series(1, p_vuelos);
  insert into public.contrato_items (numero_contrato, descripcion) select p_numero, 'item' from generate_series(1, p_items);
  insert into public.contrato_hoteles (numero_contrato, nombre) select p_numero, 'T227 HOTEL' from generate_series(1, p_hoteles);
end $$;

create function t227.pendiente(p_acep bigint, p_numero text) returns text language plpgsql as $$
declare v_der jsonb := public.p63_financiero_derivado(p_acep);
begin
  return t227.try(format($f$insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values (%L, 'mayorista', %L::jsonb, %L::jsonb) returning 'OK'$f$,
    p_numero, (v_der->'costos')::text, (v_der->'cxp')::text));
end $$;

create function t227.finalizar(p_acep bigint, p_numero text, p_costos jsonb default null, p_cxp jsonb default null) returns text language plpgsql as $$
declare v_der jsonb := public.p63_financiero_derivado(p_acep);
begin
  return t227.try(format($f$select public.registrar_financiero_contrato(%L, 'mayorista', %L::jsonb, %L::jsonb)::text$f$,
    p_numero, coalesce(p_costos, v_der->'costos')::text, coalesce(p_cxp, v_der->'cxp')::text));
end $$;

-- ── Fixtures del mundo #63 ──────────────────────────────────────────────────────────────────
insert into public.proveedores (id, nombre, aplica_retencion, pct_retencion) values
  (227700, 'T227 PROV HOTEL', true, 0.035), (227701, 'T227 PROV HOTEL 2', false, 0);
insert into public.hoteles (id, destino_id, nombre, proveedor_id) values
  (227600, 227010, 'T227 HOTEL', 227700), (227601, 227010, 'T227 HOTEL AJENO', 227700);
insert into public.servicios_adicionales (id, nombre, proveedor_id) values (227650, 'T227 TOUR', 227700);
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id, modo_oferta, trm_oferta) values
  (227310, 'T227 dinámico modo 63 (aceptación)', 'dinamico', true, 227010, 'cop_trm_63', 4000),
  (227311, 'T227 dinámico modo 63 ajeno', 'dinamico', true, 227010, 'cop_trm_63', 4000);
insert into public.armado_hoteles (paquete_id, hotel_id) values (227310, 227600);
insert into public.armado_servicios (paquete_id, servicio_id) values (227310, 227650);
insert into public.empaquetados (id, record, aerolinea, ruta, destino_id, fecha_ida, fecha_regreso, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo, proveedor_id) values
  (227507, null, 'AEROTEST', 'BOG - CTG - BOG', 227010, current_date + 60, current_date + 63, 1000000, 1130000, 80500, true, 227700);
insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, fee_infante, aplica_mk, ta)
values (227310, 227507, current_date + 60, current_date + 63, 'BOG - CTG - BOG', 'AEROTEST', 1130000, 80500, false, 0);
do $$
begin
  perform t227.publicar(227310, '[]'::jsonb, 'oper');
  perform t227.publicar(227311, '[]'::jsonb, 'oper');
end $$;

-- ═ I · cotizar y aceptar ═══════════════════════════════════════════════════════════════════
do $$
declare v_cot text; v_a text; v_a2 text; v_j jsonb; v_m text; v_n text; v_id bigint; v_fecha date;
begin
  perform t227.afirma('I0 (precondición) el paquete del mundo #63 está publicado y publicable',
    (select tarifario_snapshot_publicable and tarifario_revision_publicada is not null and tarifario_generacion_publicada is not null from public.armado_paquetes where id = 227310));

  -- I1 revisión de T0 vencida al guardar: no se crea la cotización "rasgada"
  v_m := t227.cotizar(227310, 'h1', 'f1', jsonb_set(t227.t0(227310), '{rev_fuente}', to_jsonb((t227.t0(227310)->>'rev_fuente')::bigint - 1)));
  perform t227.afirma('I1 crear_cotizacion_oferta_63 verifica la revisión de T0 al guardar (no hay cotización rasgada)', v_m like '%p63_oferta_cambio%', v_m);
  perform t227.afirma('I2 ...y el rechazo no dejó cotización ni oferta a medias (misma transacción)',
    (select count(*) from public.p63_oferta) = 0 and not exists (select 1 from public.cotizaciones where cliente = 'Cliente 227'));

  v_cot := t227.cotizar();
  perform t227.afirma('I3 cotizar crea la cotización y su oferta privada en UNA transacción',
    v_cot ~ '^[0-9]+$' and (select count(*) from public.p63_oferta where cotizacion_id = v_cot::bigint) = 1
    and (select estado from public.cotizaciones where id = v_cot::bigint) = 'abierta', v_cot);
  perform t227.afirma('I4 la oferta guarda las revisiones de T0, la TRM y el snapshot con costos y proveedores',
    (select rev_fuente = (select tarifario_revision_fuente from public.armado_paquetes where id = 227310) and trm = 4000
        and snapshot -> 'financiero' -> 'cxp' -> 1 ->> 'proveedor' = 'T227 PROV HOTEL' and estado = 'abierta'
       from public.p63_oferta where cotizacion_id = v_cot::bigint));
  v_m := t227.cotizar(227310);
  perform t227.afirma('I5 una segunda cotización del mismo paquete es otra oferta independiente', v_m ~ '^[0-9]+$' and v_m <> v_cot, v_m);
  -- el modo del paquete debe ser el cotizado
  v_m := t227.try(format('select public.crear_cotizacion_oferta_63(%L::uuid, ''minorista'', ''{}''::jsonb, ''{}''::jsonb, ''h'', ''f'', ''{}''::jsonb)::text', t227.u('vent')));
  perform t227.afirma('I6 la oferta COP con TRM solo existe en mayorista', v_m like '%p63_no_autorizado%', v_m);
  v_m := t227.try(format('select public.crear_cotizacion_oferta_63(%L::uuid, ''mayorista'', ''{}''::jsonb, ''{}''::jsonb, ''h'', ''f'', ''{}''::jsonb)::text', gen_random_uuid()));
  perform t227.afirma('I7 un usuario inexistente no cotiza (p63_no_autorizado)', v_m like '%p63_no_autorizado%', v_m);

  -- I8 aceptar: número reservado, intento preparado, snapshot y payload derivado con la fecha de negocio de Bogotá
  v_a := t227.aceptar(v_cot);
  v_j := v_a::jsonb;
  v_fecha := public.p63_hoy_bogota();
  perform t227.afirma('I8 aceptar_oferta_63 reserva el número (DTM-####), crea el intento preparado y devuelve el snapshot',
    v_j->>'estado' = 'preparada' and v_j->>'numero_contrato' ~ '^DTM-[0-9]{4,}$' and v_j->'snapshot' ? 'cabecera' and (v_j->>'aceptacion_id') ~ '^[0-9]+$', v_a);
  perform t227.afirma('I9 el payload financiero devuelto trae la fecha de obligación del día de negocio y las dos obligaciones',
    jsonb_array_length(v_j->'financiero'->'cxp') = 2 and (v_j->'financiero'->'cxp'->0->>'fecha_obligacion')::date = v_fecha, v_a);
  perform t227.afirma('I10 la oferta pasa a aceptada y existe UN solo intento vigente',
    (select estado from public.p63_oferta where cotizacion_id = v_cot::bigint) = 'aceptada'
    and (select count(*) from public.p63_aceptacion where cotizacion_id = v_cot::bigint and estado <> 'descartada') = 1);
  -- I11 el mismo reintento recibe el MISMO intento (mismo número, mismo snapshot), nunca otro
  v_a2 := t227.aceptar(v_cot);
  perform t227.afirma('I11 un reintento devuelve el MISMO número y el MISMO intento (no gasta otro consecutivo)',
    (v_a2::jsonb)->>'numero_contrato' = v_j->>'numero_contrato' and (v_a2::jsonb)->>'aceptacion_id' = v_j->>'aceptacion_id'
    and (select count(*) from public.p63_aceptacion where cotizacion_id = v_cot::bigint) = 1, v_a2);
  -- I12 guardas de identidad
  v_m := t227.aceptar(v_cot, 'h1', 'f1', 'minorista');
  perform t227.afirma('I12 aceptar con otra agencia se rechaza (p63_no_autorizado)', v_m like '%p63_no_autorizado%', v_m);
  v_m := t227.aceptar(v_cot, 'h1', 'f1', 'mayorista', gen_random_uuid());
  perform t227.afirma('I13 aceptar con un usuario inexistente se rechaza', v_m like '%p63_no_autorizado%', v_m);
  v_m := t227.aceptar('999999');
  perform t227.afirma('I14 aceptar una cotización sin oferta #63 se rechaza (p63_sin_oferta)', v_m like '%p63_sin_oferta%', v_m);
  -- I15 lo aceptado es inmutable (incluso para un superusuario)
  v_m := t227.try(format('update public.p63_aceptacion set snapshot = ''{}''::jsonb where cotizacion_id = %s returning ''OK''', v_cot));
  perform t227.afirma('I15 el snapshot aceptado no se modifica (p63_inmutable)', v_m like '%p63_inmutable%', v_m);
  v_m := t227.try(format('update public.p63_oferta set snapshot = ''{}''::jsonb where cotizacion_id = %s returning ''OK''', v_cot));
  perform t227.afirma('I16 el snapshot de la oferta cotizada tampoco', v_m like '%p63_inmutable%', v_m);
  v_m := t227.try(format('delete from public.p63_aceptacion where cotizacion_id = %s returning ''OK''', v_cot));
  perform t227.afirma('I17 una aceptación no se borra (historia)', v_m like '%p63_historico%', v_m);
  v_m := t227.try(format('update public.p63_aceptacion set numero_contrato = ''DTM-9999'' where cotizacion_id = %s returning ''OK''', v_cot));
  perform t227.afirma('I18 el número reservado no se cambia', v_m like '%p63_inmutable%', v_m);
  -- I19 privacidad: ni la API ni anon ven las tablas privadas, ni ejecutan las RPC
  perform t227.afirma('I19 ni authenticated ni anon leen p63_oferta / p63_aceptacion',
    t227.q('select count(*)::text from public.p63_oferta', 'super') like 'ERR%' and t227.q('select count(*)::text from public.p63_aceptacion', 'super') like 'ERR%'
    and t227.q('select count(*)::text from public.p63_oferta', null, 'anon') like 'ERR%' and t227.q('select count(*)::text from public.p63_aceptacion', null, 'anon') like 'ERR%');
  perform t227.afirma('I20 RLS activada y SIN policies en las dos tablas privadas',
    (select count(*) from pg_class where oid in ('public.p63_oferta'::regclass, 'public.p63_aceptacion'::regclass) and relrowsecurity) = 2
    and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('p63_oferta', 'p63_aceptacion')) = 0);
  perform t227.afirma('I21 un superadmin de la API no ejecuta aceptar_oferta_63 ni crear_cotizacion_oferta_63',
    t227.q(format('select public.aceptar_oferta_63(%s, ''mayorista'', ''%s'', ''h1'', ''f1'')::text', v_cot, t227.u('vent')), 'super') like 'ERR%'
    and t227.q(format('select public.crear_cotizacion_oferta_63(''%s'', ''mayorista'', ''{}'', ''{}'', ''h'', ''f'', ''{}'')::text', t227.u('vent')), 'super') like 'ERR%');
  perform t227.afirma('I22 service_role SÍ ejecuta aceptar_oferta_63 (reintento idempotente)',
    t227.q(format('select public.aceptar_oferta_63(%s, ''mayorista'', ''%s'', ''h1'', ''f1'')::text', v_cot, t227.u('vent')), null, 'service_role') like '%numero_contrato%');
  perform t227.afirma('I23 la auditoría (087) cubre las dos tablas privadas',
    (select count(*) from pg_trigger where tgname = 'trg_auditoria' and tgrelid in ('public.p63_oferta'::regclass, 'public.p63_aceptacion'::regclass)) = 2
    and exists (select 1 from public.auditoria where tabla = 'p63_aceptacion' and accion = 'INSERT'));
  perform t227.afirma('I24 service_role SÍ lee las tablas privadas (la recuperación del servidor las necesita) y authenticated/anon no tienen ningún privilegio',
    t227.q('select count(*)::text from public.p63_aceptacion', null, 'service_role') ~ '^[0-9]+$'
    and t227.q('select count(*)::text from public.p63_oferta', null, 'service_role') ~ '^[0-9]+$'
    and not has_table_privilege('authenticated', 'public.p63_aceptacion', 'SELECT') and not has_table_privilege('anon', 'public.p63_oferta', 'SELECT')
    and not has_table_privilege('authenticated', 'public.p63_oferta', 'DELETE') and not has_table_privilege('authenticated', 'public.p63_aceptacion', 'TRUNCATE'));
end $$;

-- ═ J · rechazos de la aceptación ═══════════════════════════════════════════════════════════
create function t227.republicar(p_paquete bigint) returns text language plpgsql as $$
declare v_gen bigint;
begin
  select tarifario_generacion + 1 into v_gen from public.armado_paquetes where id = p_paquete;
  update public.armado_paquetes set tarifario_generacion = v_gen where id = p_paquete;
  return t227.publicar(p_paquete, '[]'::jsonb, 'oper');
end $$;

do $$
declare v_cot text; v_m text; r bigint;
begin
  -- J1 cambio SOLO de costo (tarifa_proveedor) con el PVP igual: R no cambia → la revisión sube y la aceptación se rechaza
  v_cot := t227.cotizar();
  update public.empaquetados set tarifa_proveedor = 1000001 where id = 227507;
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('J1 cambiar solo el costo N de la fuente (PVP igual) invalida la aceptación', v_m like '%p63_oferta_cambio%', v_m);
  perform t227.afirma('J2 ...y no consumió número ni dejó intento', not exists (select 1 from public.p63_aceptacion where cotizacion_id = v_cot::bigint)
    and (select estado from public.p63_oferta where cotizacion_id = v_cot::bigint) = 'abierta');
  update public.empaquetados set tarifa_proveedor = 1000000 where id = 227507;
  perform t227.republicar(227310);

  -- J3 retención del proveedor cambia (no mueve el PVP ni el tarifario): sube p63_rev_costos y rechaza
  v_cot := t227.cotizar();
  r := (select p63_rev_costos from public.armado_paquetes where id = 227310);
  update public.proveedores set pct_retencion = 0.11 where id = 227700;
  perform t227.afirma('J3 cambiar la retención del proveedor sube el contador de costos EN LA MISMA transacción (y no el del paquete ajeno)',
    (select p63_rev_costos from public.armado_paquetes where id = 227310) = r + 1 and (select p63_rev_costos from public.armado_paquetes where id = 227311) = 0);
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('J4 ...y la aceptación se rechaza aunque el PVP y el tarifario sigan iguales', v_m like '%p63_oferta_cambio%', v_m);
  update public.proveedores set pct_retencion = 0.035 where id = 227700;

  -- J5 cambio de proveedor del hotel
  v_cot := t227.cotizar();
  update public.hoteles set proveedor_id = 227701 where id = 227600;
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('J5 cambiar el proveedor del hotel invalida la aceptación (costo/proveedor distinto, PVP igual)', v_m like '%p63_oferta_cambio%', v_m);
  update public.hoteles set proveedor_id = 227700 where id = 227600;

  -- J6 TRM del paquete
  v_cot := t227.cotizar();
  update public.armado_paquetes set trm_oferta = 4010 where id = 227310;
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('J6 la TRM del paquete cambió: la aceptación se rechaza', v_m like '%p63_oferta_cambio%', v_m);
  update public.armado_paquetes set trm_oferta = 4000 where id = 227310;
  perform t227.republicar(227310);

  -- J7 tarifario regenerado entre la cotización y la aceptación (generación publicada distinta)
  v_cot := t227.cotizar();
  perform t227.republicar(227310);
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('J7 el tarifario fue regenerado/publicado de nuevo: requiere cotización nueva', v_m like '%p63_oferta_cambio%', v_m);

  -- J8 huellas calculadas en vivo distintas de las cotizadas
  v_cot := t227.cotizar();
  v_m := t227.aceptar(v_cot, 'otra-huella', 'f1');
  perform t227.afirma('J8 el precio/vuelo recalculado ya no coincide con la huella cotizada', v_m like '%p63_oferta_cambio%', v_m);
  v_m := t227.aceptar(v_cot, 'h1', 'otra-financiera');
  perform t227.afirma('J9 los costos recalculados ya no coinciden con la huella financiera cotizada', v_m like '%p63_oferta_cambio%', v_m);

  -- J10 record agregado a la fuente: invalida, no borra el vínculo
  v_cot := t227.cotizar();
  update public.empaquetados set record = 'PNR227' where id = 227507;
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('J10 la fuente recibió un record (PNR): la aceptación se rechaza y el vínculo sigue', v_m like '%p63_oferta_cambio%'
    and exists (select 1 from public.salidas_dinamicas where paquete_id = 227310 and empaquetado_id = 227507), v_m);
  update public.empaquetados set record = null where id = 227507;
  perform t227.republicar(227310);

  -- J11 un cambio en un paquete AJENO no afecta una aceptación
  v_cot := t227.cotizar();
  update public.hoteles set pet_friendly = true where id = 227601;               -- hotel que NO está en el armado del paquete
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('J11 un cambio de un hotel que el paquete no usa NO invalida la aceptación', v_m like '%numero_contrato%', v_m);
  -- limpiar el intento para no ensuciar los bloques siguientes: lo descarta la reversión del bloque K con otra oferta
end $$;

-- J12/J13 reloj: la fecha de negocio se toma AHORA, sin UPDATE de por medio (medianoche de Bogotá)
do $$
declare v_cot text; v_m text; v_orig text;
begin
  update public.salidas_dinamicas set compra_fin = public.p63_hoy_bogota() where paquete_id = 227310 and empaquetado_id = 227507;
  perform t227.republicar(227310);                        -- el UPDATE de arriba subió la revisión: se regenera
  v_cot := t227.cotizar();
  -- Simula el cruce de medianoche SIN tocar ninguna tabla: el reloj de negocio salta un día.
  v_orig := pg_get_functiondef('public.p63_hoy_bogota()'::regprocedure);
  create or replace function public.p63_hoy_bogota() returns date language sql stable as 'select (clock_timestamp() at time zone ''America/Bogota'')::date + 1';
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('J12 R0 AÚN NO aceptada y con la compra vencida al cruzar medianoche (sin UPDATE) se rechaza', v_m like '%p63_oferta_cambio%' and v_m like '%vigencia de compra%', v_m);
  execute v_orig;
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('J13 ...y antes del cruce (mismo día) la MISMA oferta sí se acepta: el rechazo era del reloj, no de la revisión', v_m like '%numero_contrato%', v_m);
  -- J14 R0 YA aceptada antes de vencer se materializa después sin revalidar la ventana (es lo aceptado)
  create or replace function public.p63_hoy_bogota() returns date language sql stable as 'select (clock_timestamp() at time zone ''America/Bogota'')::date + 1';
  perform t227.afirma('J14 una oferta ya ACEPTADA antes de vencer se puede recuperar al día siguiente: el reintento devuelve el mismo intento',
    t227.aceptar(v_cot) like '%numero_contrato%');
  execute v_orig;
end $$;

-- ═ K · fencing de la cabecera ═══════════════════════════════════════════════════════════════
do $$
declare v_cot text; v_a jsonb; v_num text; v_acep bigint; v_m text; v_cot2 text; v_b jsonb; v_num2 text;
begin
  -- Una oferta nueva y su aceptación
  update public.salidas_dinamicas set compra_fin = null where paquete_id = 227310 and empaquetado_id = 227507;
  perform t227.republicar(227310);
  v_cot := t227.cotizar();
  v_a := t227.aceptar(v_cot)::jsonb;
  v_num := v_a->>'numero_contrato'; v_acep := (v_a->>'aceptacion_id')::bigint;

  v_m := t227.try(format($f$insert into public.ventas (numero_contrato, tenant, cliente) values (%L, 'mayorista', 'intruso') returning 'OK'$f$, v_num));
  perform t227.afirma('K1 un número reservado por una aceptación no lo crea nadie sin el marcador (p63_cabecera)', v_m like '%p63_cabecera%' and v_m like '%reservado%', v_m);
  v_m := t227.cabecera(v_num, v_acep, 3360001);
  perform t227.afirma('K2 con el marcador pero con un precio distinto al aceptado se rechaza', v_m like '%p63_cabecera%' and v_m like '%precio_venta%', v_m);
  v_m := t227.cabecera(v_num, v_acep + 999);
  perform t227.afirma('K3 con una aceptación ajena se rechaza', v_m like '%p63_cabecera%', v_m);
  perform t227.afirma('K4 los rechazos no cambiaron el intento (sigue preparado)', (select estado from public.p63_aceptacion where id = v_acep) = 'preparada');

  v_m := t227.cabecera(v_num, v_acep);
  perform t227.afirma('K5 la cabecera de lo aceptado se inserta y marca el intento como materializando EN LA MISMA transacción', v_m = 'OK'
    and (select estado from public.p63_aceptacion where id = v_acep) = 'materializando', v_m);
  v_m := t227.cabecera(v_num, v_acep);
  perform t227.afirma('K6 un segundo worker no crea otra cabecera del mismo número', v_m <> 'OK', v_m);
  v_b := t227.aceptar(v_cot)::jsonb;
  perform t227.afirma('K7 reintentar aceptar con el intento ya materializando devuelve su estado y NO un número nuevo',
    v_b->>'estado' = 'materializando' and v_b->>'numero_contrato' = v_num and not (v_b ? 'snapshot'), v_b::text);

  -- K8 reversión (la compensación borra la cabecera): el número queda descartado y la oferta vuelve a abrirse
  perform public.revertir_contrato_incompleto(v_num, 'mayorista');
  perform t227.afirma('K8 la reversión descarta el intento (tombstone) y reabre la oferta no convertida',
    (select estado from public.p63_aceptacion where id = v_acep) = 'descartada' and (select estado from public.p63_oferta where cotizacion_id = v_cot::bigint) = 'abierta'
    and not exists (select 1 from public.ventas where numero_contrato = v_num));
  v_m := t227.cabecera(v_num, v_acep);
  perform t227.afirma('K9 un worker viejo (intento descartado) NO crea cabecera después de la reversión', v_m like '%p63_cabecera%', v_m);
  v_m := t227.try(format($f$insert into public.ventas (numero_contrato, tenant, cliente) values (%L, 'mayorista', 'intruso') returning 'OK'$f$, v_num));
  perform t227.afirma('K10 el número descartado sigue siendo tombstone: tampoco sin marcador', v_m like '%p63_cabecera%', v_m);
  v_b := t227.aceptar(v_cot)::jsonb;
  v_num2 := v_b->>'numero_contrato';
  perform t227.afirma('K11 tras la reversión la oferta se acepta de nuevo con un número NUEVO (el viejo no se reutiliza)',
    v_b->>'estado' = 'preparada' and v_num2 <> v_num and (v_b->>'aceptacion_id')::bigint <> v_acep, v_b::text);
  perform t227.afirma('K12 el intento descartado queda como historia y hay un solo intento vigente',
    (select count(*) from public.p63_aceptacion where cotizacion_id = v_cot::bigint) = 2
    and (select count(*) from public.p63_aceptacion where cotizacion_id = v_cot::bigint and estado <> 'descartada') = 1);
  -- K13 una cabecera sin aceptación #63 no la toca el fencing (contratos de siempre)
  v_m := t227.try($f$insert into public.ventas (numero_contrato, tenant, cliente, estado, financiero_estado) values ('DTM-9281', 'mayorista', 'legacy', 'pendiente', 'pendiente') returning 'OK'$f$);
  perform t227.afirma('K13 una cabecera de siempre (sin aceptación #63) se inserta como antes', v_m = 'OK', v_m);
  v_m := t227.try($f$insert into public.ventas (numero_contrato, tenant, cliente, aceptacion_63_id) values ('DTM-9282', 'mayorista', 'legacy', 999999) returning 'OK'$f$);
  perform t227.afirma('K14 el marcador de una aceptación inexistente se rechaza', v_m like '%p63_cabecera%', v_m);
  -- K15 el marcador no se agrega ni se cambia después
  v_m := t227.try($f$update public.ventas set aceptacion_63_id = 1 where numero_contrato = 'DTM-9281' returning 'OK'$f$);
  perform t227.afirma('K15 un contrato de siempre no se marca como #63 después de creado', v_m like '%p63_protegido%', v_m);
  -- limpiar: dejar el intento vigente de v_cot descartado para los siguientes bloques
  perform t227.cabecera(v_num2, (v_b->>'aceptacion_id')::bigint);
  perform public.revertir_contrato_incompleto(v_num2, 'mayorista');
end $$;

-- ═ L · H: el payload se DERIVA de lo aceptado ══════════════════════════════════════════════
do $$
declare v_cot text; v_a jsonb; v_num text; v_acep bigint; v_m text; v_m2 text; v_r jsonb; v_der jsonb; v_cxp_id bigint;
begin
  v_cot := t227.cotizar();
  v_a := t227.aceptar(v_cot)::jsonb;
  v_num := v_a->>'numero_contrato'; v_acep := (v_a->>'aceptacion_id')::bigint;
  perform t227.cabecera(v_num, v_acep);
  v_der := public.p63_financiero_derivado(v_acep);

  -- L1/L2 sin hijos no se guarda el pendiente (solo tras los pasos previos)
  v_m := t227.pendiente(v_acep, v_num);
  perform t227.afirma('L1 el pendiente NO se guarda mientras falten los hijos del contrato (p63_pendiente)', v_m like '%p63_pendiente%' and v_m like '%tramos%', v_m);
  perform t227.hijos(v_num);
  -- L2 pendiente adulterado
  v_m := t227.try(format($f$insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values (%L, 'mayorista', '{"costo_hotel": 1}'::jsonb, %L::jsonb) returning 'OK'$f$, v_num, (v_der->'cxp')::text));
  perform t227.afirma('L2 un pendiente con costos distintos a lo aceptado se rechaza (p63_payload_alterno)', v_m like '%p63_payload_alterno%', v_m);
  v_m := t227.try(format($f$insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values (%L, 'mayorista', %L::jsonb, '[]'::jsonb) returning 'OK'$f$, v_num, (v_der->'costos')::text));
  perform t227.afirma('L3 un pendiente con obligaciones distintas (vacías) se rechaza', v_m like '%p63_payload_alterno%', v_m);
  perform t227.afirma('L4 los rechazos no dejaron pendiente', not exists (select 1 from public.contrato_financiero_pendiente where numero_contrato = v_num));

  -- L5 llamada DIRECTA sin pendiente (la RPC antigua no puede fabricar una cuenta #63)
  v_m := t227.finalizar(v_acep, v_num);
  perform t227.afirma('L5 llamada directa con el payload correcto pero SIN pendiente: se rechaza (p63_sin_pendiente)', v_m like '%p63_sin_pendiente%', v_m);
  v_m := t227.pendiente(v_acep, v_num);
  perform t227.afirma('L6 el pendiente con exactamente lo aceptado sí se guarda', v_m = 'OK', v_m);
  -- L6b/L6c: el UPDATE del pendiente también se vigila (el reconciliador solo cuenta intentos y guarda el error)
  v_m := t227.try(format($f$update public.contrato_financiero_pendiente set costos = '{"costo_hotel": 1}'::jsonb where numero_contrato = %L returning 'OK'$f$, v_num));
  perform t227.afirma('L6b un UPDATE del pendiente a costos distintos de lo aceptado se rechaza (p63_payload_alterno)', v_m like '%p63_payload_alterno%', v_m);
  v_m := t227.try(format($f$update public.contrato_financiero_pendiente set cxp = '[]'::jsonb where numero_contrato = %L returning 'OK'$f$, v_num));
  perform t227.afirma('L6c ...y a obligaciones distintas (vacías) también', v_m like '%p63_payload_alterno%', v_m);
  v_m := t227.try(format($f$update public.contrato_financiero_pendiente set intentos = intentos + 1, ultimo_error = 'x', ultimo_intento_en = now() where numero_contrato = %L returning 'OK'$f$, v_num));
  perform t227.afirma('L6d registrar un intento fallido (intentos / ultimo_error) sigue permitido: el payload no cambia', v_m = 'OK', v_m);
  -- L7 llamada directa con costos/CxP adulterados
  v_m := t227.finalizar(v_acep, v_num, '{"costo_hotel": 1, "costo_aereo": 1}'::jsonb, '[{"tipo_proveedor":"hotel","proveedor":"X","servicio":"Hotel","valor_total":1,"obligacion":"hotel:0"}]'::jsonb);
  perform t227.afirma('L7 llamada directa con costos y CxP adulterados: se rechaza (payload alterno)', v_m like '%p63_payload_alterno%', v_m);
  perform t227.afirma('L8 ...y no se escribió nada: contrato pendiente, sin CxP, costos intactos',
    (select financiero_estado from public.ventas where numero_contrato = v_num) = 'pendiente'
    and not exists (select 1 from public.cuentas_por_pagar where numero_contrato = v_num) and (select coalesce(costo_hotel, 0) from public.ventas where numero_contrato = v_num) = 0);
  v_m := t227.finalizar(v_acep, v_num, null, '[{"tipo_proveedor":"hotel","valor_total":210,"obligacion":"hotel:0","valor_cop":840000,"trm":4000}]'::jsonb);
  perform t227.afirma('L9 un payload parcial (una obligación de menos) tampoco pasa', v_m like '%p63_payload_alterno%', v_m);
  -- L9b: los pasos previos se re-verifican al finalizar (si desaparece un hijo después de guardar el pendiente, no se completa)
  delete from public.contrato_items where numero_contrato = v_num;
  v_m := t227.finalizar(v_acep, v_num);
  perform t227.afirma('L9b si desaparece un hijo del contrato tras guardar el pendiente, la finalización NO completa (p63_pendiente)', v_m like '%p63_pendiente%' and v_m like '%ítems%', v_m);
  perform t227.hijos(v_num, 0, 1, 0);

  -- L10 el catálogo cambia DESPUÉS de aceptar: lo escrito es lo ACEPTADO (reconciliador con el mismo payload)
  update public.empaquetados set tarifa_proveedor = 1200000, proveedor_id = 227701 where id = 227507;
  update public.proveedores set nombre = 'T227 PROV HOTEL RENOMBRADO', pct_retencion = 0.11 where id = 227700;
  v_m := t227.finalizar(v_acep, v_num, '{}'::jsonb, '[]'::jsonb);     -- argumentos vacíos = "usa lo aceptado"
  perform t227.afirma('L10 finaliza con lo ACEPTADO aunque la fuente y el proveedor cambiaron después (argumentos vacíos = derivado)', v_m like '%creadas%', v_m);
  perform t227.afirma('L11 las obligaciones salen del snapshot: proveedor, retención, moneda y equivalente COP originales',
    (select proveedor = 'T227 PROV HOTEL' and pct_retencion = 0.035 and aplica_retencion and moneda = 'USD' and valor_total = 210 and valor_cop_63 = 840000 and trm_63 = 4000
        and aceptacion_63_id = v_acep and obligacion_63 = 'hotel:0'
       from public.cuentas_por_pagar where numero_contrato = v_num and tipo_proveedor = 'hotel')
    and (select moneda = 'COP' and valor_total = 2080500 and valor_cop_63 = 2080500 and obligacion_63 = 'aereo:0' from public.cuentas_por_pagar where numero_contrato = v_num and tipo_proveedor = 'aereo'));
  perform t227.afirma('L12 costos (COP), estado completo, aceptación completa y pendiente borrado: todo en la misma transacción',
    (select costo_hotel = 840000 and costo_aereo = 2080500 and financiero_estado = 'completo' and financiero_registrado_en is not null from public.ventas where numero_contrato = v_num)
    and (select estado from public.p63_aceptacion where id = v_acep) = 'completa'
    and not exists (select 1 from public.contrato_financiero_pendiente where numero_contrato = v_num));
  perform t227.afirma('L13 las CxP USD y COP coexisten sin sumarse nominalmente: la suma de equivalentes cuadra con los costos del contrato',
    (select sum(valor_cop_63) from public.cuentas_por_pagar where numero_contrato = v_num) = (select costo_hotel + costo_aereo from public.ventas where numero_contrato = v_num)
    and (select sum(valor_total) from public.cuentas_por_pagar where numero_contrato = v_num) <> (select costo_hotel + costo_aereo from public.ventas where numero_contrato = v_num));
  -- L14 K15: una segunda llamada es un no-op
  v_r := public.registrar_financiero_contrato(v_num, 'mayorista', '{"costo_hotel": 1}'::jsonb, '[]'::jsonb);
  perform t227.afirma('L14 K15: sobre un contrato #63 ya completo responde ya_completo (primero, antes de validar el payload) y no toca nada',
    (v_r->>'ya_completo')::boolean and (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num) = 2
    and (select costo_hotel from public.ventas where numero_contrato = v_num) = 840000, v_r::text);
  v_r := public.revertir_contrato_incompleto(v_num, 'mayorista');
  perform t227.afirma('L15 la compensación (revertir_contrato_incompleto) no borra un contrato #63 ya completado', v_r->>'estado' = 'ya_completo'
    and exists (select 1 from public.ventas where numero_contrato = v_num), v_r::text);

  -- L16-L21 protección de lo aceptado
  select id into v_cxp_id from public.cuentas_por_pagar where numero_contrato = v_num and tipo_proveedor = 'hotel';
  v_m := t227.try(format('update public.cuentas_por_pagar set valor_total = 100 where id = %s returning ''OK''', v_cxp_id));
  perform t227.afirma('L16 el principal de una obligación aceptada no se edita', v_m like '%p63_cxp_protegida%', v_m);
  v_m := t227.try(format('update public.cuentas_por_pagar set moneda = ''COP'' where id = %s returning ''OK''', v_cxp_id));
  perform t227.afirma('L17 su moneda tampoco', v_m like '%p63_cxp_protegida%', v_m);
  v_m := t227.try(format('update public.cuentas_por_pagar set proveedor = ''Otro'' where id = %s returning ''OK''', v_cxp_id));
  perform t227.afirma('L18 su proveedor tampoco', v_m like '%p63_cxp_protegida%', v_m);
  v_m := t227.try(format('update public.cuentas_por_pagar set aplica_retencion = false, pct_retencion = 0 where id = %s returning ''OK''', v_cxp_id));
  perform t227.afirma('L19 ni su retención', v_m like '%p63_cxp_protegida%', v_m);
  v_m := t227.try(format('update public.cuentas_por_pagar set valor_cop_63 = 1 where id = %s returning ''OK''', v_cxp_id));
  perform t227.afirma('L20 ni el equivalente en COP congelado', v_m like '%p63_cxp_protegida%', v_m);
  v_m := t227.try(format('update public.cuentas_por_pagar set observaciones = ''nota interna'', fecha_vencimiento = current_date + 30 where id = %s returning ''OK''', v_cxp_id));
  perform t227.afirma('L21 lo que no rompe el snapshot (observaciones, vencimiento) sí se edita', v_m = 'OK', v_m);
  v_m := t227.try(format('insert into public.cxp_pagos (cuenta_por_pagar_id, valor, tenant) values (%s, 100, ''mayorista'') returning ''OK''', v_cxp_id));
  perform t227.afirma('L22 los pagos a la obligación aceptada siguen permitidos (no se bloquean abonos)', v_m = 'OK', v_m);
  v_m := t227.try(format('insert into public.cuentas_por_pagar (numero_contrato, tenant, tipo_proveedor, valor_total, aceptacion_63_id, obligacion_63, valor_cop_63, trm_63) values (%L, ''mayorista'', ''otro'', 5, %s, ''x:1'', 5, 4000) returning ''OK''', v_num, v_acep));
  perform t227.afirma('L23 nadie fabrica una obligación marcada como aceptada fuera de la RPC financiera', v_m like '%p63_cxp_protegida%', v_m);
  v_m := t227.try(format('insert into public.cuentas_por_pagar (numero_contrato, tenant, tipo_proveedor, valor_total) values (%L, ''mayorista'', ''otro'', 5) returning ''OK''', v_num));
  perform t227.afirma('L24 una CxP adicional SIN marca (un costo extra real) sí se puede crear', v_m = 'OK', v_m);
  v_m := t227.try(format('update public.ventas set costo_hotel = 1 where numero_contrato = %L returning ''OK''', v_num));
  perform t227.afirma('L25 los costos del contrato aceptado no se editan (p63_protegido)', v_m like '%p63_protegido%', v_m);
  v_m := t227.try(format('update public.ventas set tours_traslados = ''x'', asistencia_medica = true where numero_contrato = %L returning ''OK''', v_num));
  perform t227.afirma('L26 las columnas de display del contrato siguen editables', v_m = 'OK', v_m);
  set constraints trg_cxp_borrada_63 immediate;
  v_m := t227.try(format('delete from public.cuentas_por_pagar where id = %s returning ''OK''', v_cxp_id));
  set constraints all deferred;
  perform t227.afirma('L27 una obligación aceptada no se elimina mientras el contrato exista', v_m like '%p63_cxp_protegida%', v_m);

  -- L28 eliminar_contrato (superadmin) SÍ puede borrar el contrato completo: el borrado diferido ve que la venta ya no existe
  delete from public.cxp_pagos where cuenta_por_pagar_id in (select id from public.cuentas_por_pagar where numero_contrato = v_num);
  v_m := t227.q(format('select public.eliminar_contrato(%L)::text', v_num), 'super');
  v_m2 := t227.msg('set constraints trg_cxp_borrada_63 immediate');
  perform t227.afirma('L28b el borrado diferido de las obligaciones aceptadas pasa cuando el contrato ya no existe (se fuerza el chequeo al instante)', v_m2 = 'OK', v_m2);
  set constraints all deferred;
  perform t227.afirma('L28 eliminar_contrato borra el contrato #63 con sus obligaciones (el borrado diferido no lo impide)', v_m not like 'ERR%'
    and not exists (select 1 from public.ventas where numero_contrato = v_num) and not exists (select 1 from public.cuentas_por_pagar where numero_contrato = v_num), v_m);
  perform t227.afirma('L29 la oferta convertida es TERMINAL: borrar el contrato no reabre ni descarta lo aceptado',
    (select estado from public.p63_aceptacion where id = v_acep) = 'completa' and (select estado from public.p63_oferta where cotizacion_id = v_cot::bigint) = 'aceptada');
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('L30 ...y volver a convertir esa cotización responde completa (terminal): nunca un intento nuevo ni otro número', v_m like '%"estado": "completa"%' and (select count(*) from public.p63_aceptacion where cotizacion_id = v_cot::bigint) = 1, v_m);
end $$;

-- ═ M · cortes y recuperación ═══════════════════════════════════════════════════════════════
do $$
declare v_cot text; v_a jsonb; v_num text; v_acep bigint; v_m text; v_der jsonb; v_r jsonb; v_b jsonb;
begin
  perform t227.republicar(227310);   -- los cambios de catálogo del bloque L invalidaron el tarifario
  -- M1 corte TRAS ACEPTAR (antes de la cabecera): el reintento recupera el MISMO intento y número
  v_cot := t227.cotizar();
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('M0 (precondición) la oferta del bloque M se acepta', v_m not like 'ERR%', v_m);
  v_a := v_m::jsonb;
  v_num := v_a->>'numero_contrato'; v_acep := (v_a->>'aceptacion_id')::bigint;
  v_b := t227.aceptar(v_cot)::jsonb;
  perform t227.afirma('M1 proceso muerto tras aceptar: el reintento retoma el MISMO número y el MISMO snapshot',
    v_b->>'numero_contrato' = v_num and v_b->'snapshot' = v_a->'snapshot' and v_b->>'estado' = 'preparada');

  -- M2 corte TRAS LA CABECERA, antes de los hijos: no hay takeover; la recuperación sin payload es REVERTIR
  perform t227.cabecera(v_num, v_acep);
  v_b := t227.aceptar(v_cot)::jsonb;
  perform t227.afirma('M2 proceso muerto tras la cabecera: no hay takeover automático (estado materializando, sin snapshot nuevo)', v_b->>'estado' = 'materializando' and not (v_b ? 'snapshot'));
  v_m := t227.pendiente(v_acep, v_num);
  perform t227.afirma('M3 sin los hijos el reconciliador NO puede dejar un pendiente que luego complete finanzas', v_m like '%p63_pendiente%', v_m);
  v_r := public.revertir_contrato_incompleto(v_num, 'mayorista');
  perform t227.afirma('M4 la recuperación sin payload revierte: intento descartado, número tombstone, oferta reabierta',
    v_r->>'estado' = 'revertido' and (select estado from public.p63_aceptacion where id = v_acep) = 'descartada'
    and (select estado from public.p63_oferta where cotizacion_id = v_cot::bigint) = 'abierta');

  -- M5 corte TRAS LOS HIJOS y tras guardar el pendiente (respuesta perdida): el reconciliador completa con lo aceptado,
  -- incluso si la fuente cambió después de aceptar
  v_a := t227.aceptar(v_cot)::jsonb;
  v_num := v_a->>'numero_contrato'; v_acep := (v_a->>'aceptacion_id')::bigint;
  perform t227.cabecera(v_num, v_acep);
  perform t227.hijos(v_num);
  perform t227.afirma('M5 el pendiente con los hijos completos se guarda', t227.pendiente(v_acep, v_num) = 'OK');
  update public.empaquetados set tarifa_proveedor = 999999 where id = 227507;
  v_der := public.p63_financiero_derivado(v_acep);
  v_m := t227.try(format($f$select public.registrar_financiero_contrato(%L, 'mayorista', (select costos from public.contrato_financiero_pendiente where numero_contrato = %L), (select cxp from public.contrato_financiero_pendiente where numero_contrato = %L))::text$f$, v_num, v_num, v_num));
  perform t227.afirma('M6 el reconciliador reintenta EXACTAMENTE el payload del pendiente aunque la fuente cambió después de aceptar',
    v_m like '%creadas%' and (select valor_total from public.cuentas_por_pagar where numero_contrato = v_num and tipo_proveedor = 'aereo') = 2080500, v_m);
  -- M7 respuesta perdida + compensación tardía + segundo intento: una sola finalización
  v_r := public.revertir_contrato_incompleto(v_num, 'mayorista');
  v_m := t227.finalizar(v_acep, v_num);
  perform t227.afirma('M7 compensación tardía y reintento: contrato intacto, una sola finalización, sin CxP duplicadas',
    v_r->>'estado' = 'ya_completo' and v_m like '%ya_completo%' and (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num and aceptacion_63_id = v_acep) = 2, v_m);
end $$;

-- ═ N · cobertura de revisión: cada dato leído entre T0 y la aceptación ═════════════════════
do $$
declare r bigint; r2 bigint; rf bigint;
begin
  -- tabla de cobertura (CI): el contador de costos / la revisión de fuente suben en la MISMA transacción del cambio
  r := (select p63_rev_costos from public.armado_paquetes where id = 227310);
  update public.hoteles set adults_only = true where id = 227600;
  perform t227.afirma('N1 hoteles.adults_only sube el contador del paquete que usa el hotel', (select p63_rev_costos from public.armado_paquetes where id = 227310) = r + 1);
  r := (select p63_rev_costos from public.armado_paquetes where id = 227310);
  update public.hoteles set pet_costo_neto = 5 where id = 227600;
  perform t227.afirma('N2 hoteles.pet_costo_neto (mascota) sube el contador', (select p63_rev_costos from public.armado_paquetes where id = 227310) = r + 1);
  r := (select p63_rev_costos from public.armado_paquetes where id = 227310);
  update public.hoteles set edad_infante_max = 3 where id = 227600;
  perform t227.afirma('N3 las edades del hotel suben el contador', (select p63_rev_costos from public.armado_paquetes where id = 227310) = r + 1);
  r := (select p63_rev_costos from public.armado_paquetes where id = 227310);
  insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max) values (227600, 'doble', 2, 4);
  perform t227.afirma('N4 una acomodación del hotel (pax/edades) sube el contador', (select p63_rev_costos from public.armado_paquetes where id = 227310) = r + 1);
  r := (select p63_rev_costos from public.armado_paquetes where id = 227310);
  update public.servicios_adicionales set proveedor_id = 227701 where id = 227650;
  perform t227.afirma('N5 el proveedor del servicio sube el contador', (select p63_rev_costos from public.armado_paquetes where id = 227310) = r + 1);
  r := (select p63_rev_costos from public.armado_paquetes where id = 227310);
  update public.servicios_adicionales set categoria = 'asistencia' where id = 227650;
  perform t227.afirma('N6 la categoría del servicio (tipo de CxP) sube el contador', (select p63_rev_costos from public.armado_paquetes where id = 227310) = r + 1);
  r := (select p63_rev_costos from public.armado_paquetes where id = 227310);
  update public.proveedores set aplica_retencion = not aplica_retencion where id = 227701;
  perform t227.afirma('N7 la retención de un proveedor del servicio sube el contador', (select p63_rev_costos from public.armado_paquetes where id = 227310) = r + 1);
  r := (select p63_rev_costos from public.armado_paquetes where id = 227310);
  update public.empaquetados set proveedor_id = 227700 where id = 227507;
  perform t227.afirma('N8 el proveedor del vuelo fuente sube el contador', (select p63_rev_costos from public.armado_paquetes where id = 227310) = r + 1);
  -- exentos con motivo
  r := (select p63_rev_costos from public.armado_paquetes where id = 227310);
  update public.hoteles set descripcion = 'texto comercial' where id = 227600;
  update public.servicios_adicionales set descripcion = 'texto comercial' where id = 227650;
  perform t227.afirma('N9 EXENTO: la descripción comercial del hotel/servicio no mueve ni el precio ni el costo', (select p63_rev_costos from public.armado_paquetes where id = 227310) = r);
  -- el paquete ajeno (modo 63 sin esos hoteles) no se toca
  perform t227.afirma('N10 el paquete que no usa esas fuentes no se incrementa', (select p63_rev_costos from public.armado_paquetes where id = 227311) = 0);
  -- precio: lo cubren los triggers de la 181/226 (revisión de fuente)
  rf := (select tarifario_revision_fuente from public.armado_paquetes where id = 227310);
  update public.armado_paquetes set impuesto_fijo = 12345 where id = 227310;
  perform t227.afirma('N11 PRECIO: los cambios de configuración del paquete suben tarifario_revision_fuente (181)', (select tarifario_revision_fuente from public.armado_paquetes where id = 227310) > rf);
  -- un paquete en modo legacy que usa el MISMO hotel no lleva contador
  insert into public.armado_hoteles (paquete_id, hotel_id) values (227302, 227600);
  r := (select p63_rev_costos from public.armado_paquetes where id = 227310);
  update public.hoteles set proveedor_id = 227701 where id = 227600;
  perform t227.afirma('N12 el contador solo se incrementa en paquetes en modo cop_trm_63 (un paquete legacy con el mismo hotel queda en 0)',
    (select p63_rev_costos from public.armado_paquetes where id = 227302) = 0 and (select p63_rev_costos from public.armado_paquetes where id = 227310) = r + 1);
end $$;



-- ═ O · ciclo 5: plan B2B congelado y contrastado; vigencias de compra de hotel y servicios; cruce de medianoche SIN UPDATE ═══════
insert into public.aliados (id, nombre, tipo, pct_comision) values (227800, 'T227 AGENCIA', 'agencia', 0.10), (227801, 'T227 AGENCIA 2', 'agencia', 0.10);
insert into public.parametros_tributarios (parametro, valor) values ('COMISION_AGENCIA', 0.12), ('COMISION_FREELANCE', 0.11), ('T227_OTRO', 1) on conflict do nothing;

create function t227.plan_neta(p_aliado bigint default 227800) returns jsonb language sql stable as $$
  -- PVP 3.360.000, BNC (impuesto) 2.260.000 → base 1.100.000; 10 % → comisión 110.000; neta: precio final 3.250.000.
  select jsonb_build_object('aliado_id', p_aliado, 'tipo_asesor', 'agencia', 'pct', 0.10, 'base', 1100000, 'comision', 110000,
                            'modo_compra', 'neta', 'comision_estado', 'descontada', 'precio_final', 3250000)
$$;

do $$
declare v_hoy date := public.p63_hoy_bogota(); v_cot text; v_m text; v_orig text; v_a jsonb; r bigint; v_antes bigint;
begin
  perform t227.republicar(227310);

  -- O1/O2 vigencia de compra de la TARIFA DE HOTEL que ganó la noche: cierra hoy; al cruzar la medianoche (SIN UPDATE) la oferta no aceptada se rechaza
  v_cot := t227.cotizar(227310, 'h1', 'f1', null, null, jsonb_build_array(jsonb_build_object('origen', 'hotel', 'ref', 'Base', 'compra_inicio', null, 'compra_fin', v_hoy::text)));
  perform t227.afirma('O0 (precondición) la oferta con la vigencia de compra de hotel se cotiza', v_cot ~ '^[0-9]+$', v_cot);
  v_orig := pg_get_functiondef('public.p63_hoy_bogota()'::regprocedure);
  create or replace function public.p63_hoy_bogota() returns date language sql stable as 'select (clock_timestamp() at time zone ''America/Bogota'')::date + 1';
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('O1 la compra de la tarifa de HOTEL cerró al cruzar la medianoche (sin UPDATE de por medio): la aceptación se rechaza', v_m like '%p63_oferta_cambio%' and v_m like '%vigencia de compra%' and v_m like '%hotel%', v_m);
  perform t227.afirma('O2 ...sin reservar número ni dejar intento', not exists (select 1 from public.p63_aceptacion where cotizacion_id = v_cot::bigint)
    and (select estado from public.p63_oferta where cotizacion_id = v_cot::bigint) = 'abierta');
  execute v_orig;
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('O3 ...y ANTES del cruce (mismo día, la misma oferta, ninguna revisión movida) sí se acepta: el rechazo era del reloj', v_m like '%numero_contrato%', v_m);

  -- O4/O5 vigencia de compra de un SERVICIO (temporada vigente del servicio)
  v_cot := t227.cotizar(227310, 'h1', 'f1', null, null, jsonb_build_array(jsonb_build_object('origen', 'servicio', 'ref', '227650|Temporada alta', 'compra_inicio', (v_hoy - 5)::text, 'compra_fin', v_hoy::text)));
  create or replace function public.p63_hoy_bogota() returns date language sql stable as 'select (clock_timestamp() at time zone ''America/Bogota'')::date + 1';
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('O4 la compra de la tarifa de SERVICIO cerró al cruzar la medianoche: se rechaza', v_m like '%p63_oferta_cambio%' and v_m like '%vigencia de compra%' and v_m like '%servicio%', v_m);
  execute v_orig;
  perform t227.afirma('O5 ...y el mismo día se acepta', t227.aceptar(v_cot) like '%numero_contrato%');

  -- O6 una vigencia que AÚN NO abre (compra_inicio futuro) tampoco se acepta; una abierta sin cierre sí
  v_cot := t227.cotizar(227310, 'h1', 'f1', null, null, jsonb_build_array(jsonb_build_object('origen', 'hotel', 'ref', 'Futura', 'compra_inicio', (v_hoy + 3)::text, 'compra_fin', null)));
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('O6 una tarifa cuya compra aún no abre se rechaza', v_m like '%p63_oferta_cambio%' and v_m like '%vigencia de compra%', v_m);
  -- O6b la apertura también se mide con el reloj de Bogotá: una tarifa que abre HOY, vista desde antes de la medianoche (día anterior), aún no abre
  v_cot := t227.cotizar(227310, 'h1', 'f1', null, null, jsonb_build_array(jsonb_build_object('origen', 'hotel', 'ref', 'Abre hoy', 'compra_inicio', v_hoy::text, 'compra_fin', null)));
  create or replace function public.p63_hoy_bogota() returns date language sql stable as 'select (clock_timestamp() at time zone ''America/Bogota'')::date - 1';
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('O6b la apertura de la compra se mide con el reloj de negocio (Bogotá), no con la fecha del servidor', v_m like '%p63_oferta_cambio%' and v_m like '%vigencia de compra%', v_m);
  execute v_orig;
  perform t227.afirma('O6c ...y con el reloj de vuelta a hoy esa misma oferta se acepta', t227.aceptar(v_cot) like '%numero_contrato%');
  v_cot := t227.cotizar(227310, 'h1', 'f1', null, null, jsonb_build_array(
    jsonb_build_object('origen', 'hotel', 'ref', 'Abierta', 'compra_inicio', (v_hoy - 30)::text, 'compra_fin', (v_hoy + 30)::text),
    jsonb_build_object('origen', 'servicio', 'ref', 'Sin límites', 'compra_inicio', null, 'compra_fin', null)));
  perform t227.afirma('O7 varias vigencias, todas abiertas (o sin límites): se acepta', t227.aceptar(v_cot) like '%numero_contrato%');
  -- O8 UNA sola cerrada entre varias abiertas basta para rechazar
  v_cot := t227.cotizar(227310, 'h1', 'f1', null, null, jsonb_build_array(
    jsonb_build_object('origen', 'hotel', 'ref', 'Abierta', 'compra_inicio', (v_hoy - 30)::text, 'compra_fin', (v_hoy + 30)::text),
    jsonb_build_object('origen', 'servicio', 'ref', 'Cerrada', 'compra_inicio', null, 'compra_fin', (v_hoy - 1)::text)));
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('O8 basta UNA vigencia cerrada entre varias para rechazar la aceptación', v_m like '%Cerrada%', v_m);
  -- O9 un intento ya aceptado ('preparada') NO se revalida al día siguiente (es lo aceptado antes de vencer)
  v_cot := t227.cotizar(227310, 'h1', 'f1', null, null, jsonb_build_array(jsonb_build_object('origen', 'hotel', 'ref', 'Base', 'compra_inicio', null, 'compra_fin', v_hoy::text)));
  v_a := t227.aceptar(v_cot)::jsonb;
  create or replace function public.p63_hoy_bogota() returns date language sql stable as 'select (clock_timestamp() at time zone ''America/Bogota'')::date + 1';
  perform t227.afirma('O9 lo ya ACEPTADO antes de vencer se recupera después del cruce (mismo intento y número)', t227.aceptar(v_cot)::jsonb ->> 'numero_contrato' = v_a ->> 'numero_contrato');
  execute v_orig;

  -- O10/O11 el % del aliado (o el parámetro general) cambia con el PVP igual: sube el contador de TODOS los paquetes en modo 63 y NO el de uno legacy
  perform t227.republicar(227310);
  r := (select p63_rev_costos from public.armado_paquetes where id = 227310);
  v_antes := (select p63_rev_costos from public.armado_paquetes where id = 227311);
  v_cot := t227.cotizar(227310, 'h1', 'f1', null, t227.plan_neta());
  update public.aliados set pct_comision = 0.12 where id = 227800;
  perform t227.afirma('O10 cambiar el % del aliado sube el contador de los paquetes en modo 63 (los dos) y no el de uno legacy',
    (select p63_rev_costos from public.armado_paquetes where id = 227310) = r + 1 and (select p63_rev_costos from public.armado_paquetes where id = 227311) = v_antes + 1
    and (select p63_rev_costos from public.armado_paquetes where id = 227302) = 0);
  v_m := t227.aceptar(v_cot);
  perform t227.afirma('O11 con el PVP igual y el % del aliado cambiado entre cotizar y aceptar, la aceptación se rechaza (sin número)', v_m like '%p63_oferta_cambio%'
    and not exists (select 1 from public.p63_aceptacion where cotizacion_id = v_cot::bigint), v_m);
  update public.aliados set pct_comision = 0.10 where id = 227800;
  update public.aliados set nombre = 'T227 AGENCIA RENOMBRADA' where id = 227800;
  r := (select p63_rev_costos from public.armado_paquetes where id = 227310);
  update public.aliados set telefono = '300' where id = 227801;
  perform t227.afirma('O12 EXENTO: nombre / teléfono del aliado no mueven el contador', (select p63_rev_costos from public.armado_paquetes where id = 227310) = r);
  r := (select p63_rev_costos from public.armado_paquetes where id = 227310);
  update public.parametros_tributarios set valor = 0.13 where parametro = 'COMISION_AGENCIA';
  perform t227.afirma('O13 el parámetro general de comisión B2B también sube el contador', (select p63_rev_costos from public.armado_paquetes where id = 227310) = r + 1);
  r := (select p63_rev_costos from public.armado_paquetes where id = 227310);
  update public.parametros_tributarios set valor = 2 where parametro = 'T227_OTRO';
  perform t227.afirma('O14 EXENTO: otro parámetro no lo mueve', (select p63_rev_costos from public.armado_paquetes where id = 227310) = r);
  update public.parametros_tributarios set valor = 0.12 where parametro = 'COMISION_AGENCIA';
end $$;

do $$
declare v_cot text; v_a jsonb; v_num text; v_acep bigint; v_m text;
begin
  perform t227.republicar(227310);
  -- O15 cabecera B2B NETA: se contrasta contra el plan ACEPTADO (aliado, modo, comisión, estado y precio final)
  v_cot := t227.cotizar(227310, 'h1', 'f1', null, t227.plan_neta());
  v_a := t227.aceptar(v_cot)::jsonb;
  v_num := v_a ->> 'numero_contrato'; v_acep := (v_a ->> 'aceptacion_id')::bigint;
  perform t227.afirma('O15 el snapshot trae el plan B2B congelado', (v_a -> 'snapshot' -> 'b2b' ->> 'comision')::numeric = 110000 and v_a -> 'snapshot' -> 'cabecera' ->> 'canal' = 'B2B');
  v_m := t227.cabecera(v_num, v_acep, 3360000, t227.plan_neta());
  perform t227.afirma('O16 la cabecera con el precio BRUTO (sin descontar la comisión) se rechaza (precio_venta)', v_m like '%p63_cabecera%' and v_m like '%precio_venta%', v_m);
  v_m := t227.cabecera(v_num, v_acep, 3250000, jsonb_set(t227.plan_neta(), '{comision}', '120000'));
  perform t227.afirma('O17 una comisión recalculada con otro % (120.000 vs 110.000 aceptada) se rechaza aunque el precio coincida (comision_b2b)', v_m like '%p63_cabecera%' and v_m like '%comision_b2b%', v_m);
  v_m := t227.cabecera(v_num, v_acep, 3250000, jsonb_set(t227.plan_neta(), '{aliado_id}', '227801'));
  perform t227.afirma('O18 otro aliado distinto al aceptado se rechaza', v_m like '%p63_cabecera%' and v_m like '%aliado%', v_m);
  v_m := t227.cabecera(v_num, v_acep, 3250000, jsonb_set(t227.plan_neta(), '{modo_compra}', '"comisionable"'));
  perform t227.afirma('O19 otro modo de compra (comisionable en vez de neta) se rechaza', v_m like '%p63_cabecera%' and v_m like '%modo_compra%', v_m);
  v_m := t227.cabecera(v_num, v_acep);
  perform t227.afirma('O20 una cabecera B2C (sin plan) para una oferta B2B se rechaza (tipo_asesor / canal / aliado)', v_m like '%p63_cabecera%' and v_m like '%tipo_asesor%', v_m);
  v_m := t227.cabecera(v_num, v_acep, 3250000, t227.plan_neta());
  perform t227.afirma('O21 la cabecera con EXACTAMENTE el plan aceptado se inserta', v_m = 'OK', v_m);
  perform public.revertir_contrato_incompleto(v_num, 'mayorista');

  -- O22 oferta B2C: no admite datos B2B en la cabecera
  v_cot := t227.cotizar(227310);
  v_a := t227.aceptar(v_cot)::jsonb;
  v_num := v_a ->> 'numero_contrato'; v_acep := (v_a ->> 'aceptacion_id')::bigint;
  v_m := t227.cabecera(v_num, v_acep, 3360000, t227.plan_neta());
  perform t227.afirma('O22 una cabecera B2B para una oferta B2C se rechaza', v_m like '%p63_cabecera%', v_m);
  v_m := t227.cabecera(v_num, v_acep);
  perform t227.afirma('O23 una oferta B2C con cabecera B2C se inserta (sin plan)', v_m = 'OK', v_m);
  perform public.revertir_contrato_incompleto(v_num, 'mayorista');
end $$;

-- Cobertura: el contador por trigger incluye el plan B2B (se cuenta junto a N1…N12)

-- ═ Y · conclusión de E/F/G: cada bloque nuevo corrió sus comprobaciones ═════════════════════
do $$
declare n_i integer; n_j integer; n_k integer; n_l integer; n_m integer; n_n integer; n_o integer;
begin
  select count(*) filter (where nombre ~ '^I[0-9]'), count(*) filter (where nombre ~ '^J[0-9]'), count(*) filter (where nombre ~ '^K[0-9]'),
         count(*) filter (where nombre ~ '^L[0-9]'), count(*) filter (where nombre ~ '^M[0-9]'), count(*) filter (where nombre ~ '^N[0-9]'), count(*) filter (where nombre ~ '^O[0-9]')
    into n_i, n_j, n_k, n_l, n_m, n_n, n_o from t227.res;
  perform t227.afirma('Y conclusiva E/F/G: cada bloque I–O corrió sus comprobaciones',
    least(n_i, n_j, n_k, n_l, n_m, n_n, n_o) >= 1, format('I=%s J=%s K=%s L=%s M=%s N=%s O=%s', n_i, n_j, n_k, n_l, n_m, n_n, n_o));
end $$;

-- ═ U · 230: Empaquetados y salidas vinculadas en USD ═════════════════════════════════════════
-- Mundo propio (ids 2305xx / 23031x): paquete Dinámico modo 63 con TRM 3.200, hotel USD, un Empaquetado en USD (N 380, R 415, F 45).
create schema t230;

create function t230.snap(p_paquete bigint, p_salida bigint, p_emp bigint) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'v', 1, 'paquete_id', p_paquete, 'salida_id', p_salida, 'empaquetado_id', p_emp, 'trm', 3200, 'moneda', 'COP',
    'cabecera', jsonb_build_object('tipo_paquete', 'dinamico', 'moneda', 'COP', 'fecha_salida', (current_date + 70)::text,
        'fecha_regreso', (current_date + 74)::text, 'pax', 2, 'destino', 'T227 CARTAGENA', 'hotel', 'T227 HOTEL',
        'precio_venta', 3456000, 'impuesto', 2656000, 'costo_aereo', 2576000, 'aerolinea', 'AEROTEST',
        'plan_nombre', 'ESTANDAR · PC', 'paquete_armado_id', p_paquete, 'n_tramos', 2, 'n_items', 1, 'n_hoteles', 1,
        'tipo_asesor', 'interno', 'canal', 'B2C'),
    'b2b', null, 'vigencias', '[]'::jsonb,
    'financiero', jsonb_build_object(
      'costos', jsonb_build_object('costo_hotel', 672000, 'costo_aereo', 2576000),
      'cxp', jsonb_build_array(
        jsonb_build_object('obligacion', 'aereo:0', 'tipo_proveedor', 'aereo', 'proveedor', 'AEROTEST', 'servicio', 'Aéreo AEROTEST',
          'valor_total', 805, 'moneda', 'USD', 'valor_cop', 2576000, 'trm', 3200, 'aplica_retencion', false, 'pct_retencion', 0,
          'observaciones', 'Generado automáticamente desde el tarifario', 'servicio_id', null),
        jsonb_build_object('obligacion', 'hotel:0', 'tipo_proveedor', 'hotel', 'proveedor', 'T227 PROV HOTEL', 'servicio', 'Hotel T227 HOTEL',
          'valor_total', 210, 'moneda', 'USD', 'valor_cop', 672000, 'trm', 3200, 'aplica_retencion', true, 'pct_retencion', 0.035,
          'observaciones', 'Generado automáticamente desde el tarifario', 'servicio_id', null))))
$$;

-- Republica con la TRM del paquete (t227.republicar usa 4.000 por omisión y el envoltorio descartaría la publicación).
create function t230.republicar(p_paquete bigint, p_trm numeric) returns text language plpgsql as $$
declare v_gen bigint;
begin
  select tarifario_generacion + 1 into v_gen from public.armado_paquetes where id = p_paquete;
  update public.armado_paquetes set tarifario_generacion = v_gen where id = p_paquete;
  return t227.publicar(p_paquete, '[]'::jsonb, 'oper', 'COP', 'cop_trm_63', p_trm);
end $$;

create function t230.cotizar(p_paquete bigint, p_emp bigint) returns text language plpgsql as $$
declare v_cot jsonb; v_snap jsonb;
begin
  v_snap := t230.snap(p_paquete, t227.salida63(p_paquete), p_emp);
  v_cot := jsonb_build_object('tenant', 'mayorista', 'payload', jsonb_build_object('x', 1), 'detalle', '{}'::jsonb, 'cliente', 'Cliente 230',
    'destino', 'T227 CARTAGENA', 'hotel', 'T227 HOTEL', 'modulo', 'dinamico', 'plan_nombre', 'ESTANDAR · PC', 'pax', 2, 'precio_venta', 3456000,
    'moneda', 'COP', 'fecha_salida', (current_date + 70)::text, 'fecha_regreso', (current_date + 74)::text, 'vigencia_hasta', (current_date + 1)::text,
    'paquete_armado_id', p_paquete, 'asesor', 'Asesor 230', 'creado_por', 'c230@x.test');
  return t227.try(format('select public.crear_cotizacion_oferta_63(%L::uuid, ''mayorista'', %L::jsonb, %L::jsonb, %L, %L, %L::jsonb)::text',
    t227.u('vent'), v_cot::text, v_snap::text, 'h230', 'f230', t227.t0(p_paquete)::text));
end $$;

create function t230.cabecera(p_numero text, p_acep bigint, p_paquete bigint) returns text language plpgsql as $$
begin
  return t227.try(format($f$insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, fecha_salida, fecha_regreso, pax, hotel, destino,
      precio_venta, impuesto, costo_aereo, aerolinea, estado, financiero_estado, plan_nombre, paquete_armado_id, aceptacion_63_id,
      tipo_asesor, canal, aliado_id, modo_compra, comision_b2b, comision_estado)
    values (%L, 'mayorista', 'Cliente 230', 'dinamico', 'COP', current_date + 70, current_date + 74, 2, 'T227 HOTEL', 'T227 CARTAGENA',
      3456000, 2656000, 2576000, 'AEROTEST', 'pendiente', 'pendiente', 'ESTANDAR · PC', %s, %s,
      'interno', 'B2C', null, null, null, null) returning 'OK'$f$, p_numero, p_paquete, p_acep));
end $$;

insert into public.empaquetados (id, record, aerolinea, ruta, destino_id, fecha_ida, fecha_regreso, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo, proveedor_id, moneda) values
  (230501, null, 'AEROTEST', 'MDE - SDQ - MDE', 227010, current_date + 70, current_date + 74, 380, 415, 45, true, 227700, 'USD'),
  (230502, null, 'AEROTEST', 'MDE - SDQ - MDE', 227010, current_date + 71, current_date + 75, 380, 415, 45, true, 227700, 'USD'),
  (230503, null, 'AEROTEST', 'MDE - SDQ - MDE', 227010, current_date + 72, current_date + 76, 380, 415, 45, true, 227700, 'USD'),
  (230504, null, 'AEROTEST', 'MDE - SDQ - MDE', 227010, current_date + 73, current_date + 77, 1000000, 1130000, 80500, true, 227700, 'COP');
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id, modo_oferta, trm_oferta) values
  (230310, 'T230 dinámico modo 63 con vuelo USD', 'dinamico', true, 227010, 'cop_trm_63', 3200),
  (230311, 'T230 bloqueo con un empaquetado', 'bloqueo', true, 227010, 'legacy', null);
insert into public.armado_hoteles (paquete_id, hotel_id) values (230310, 227600), (230311, 227600);
insert into public.armado_empaquetados (paquete_id, empaquetado_id, aplica_mk, ta) values (230311, 230504, true, 0);

do $$
declare v_m text;
begin
  -- U1 moneda del empaquetado: COP o USD
  perform t227.afirma('U1 un empaquetado se guarda en USD (antes: solo COP)', (select count(*) from public.empaquetados where id between 230501 and 230503 and moneda = 'USD') = 3);
  v_m := t227.msg('update public.empaquetados set moneda = ''EUR'' where id = 230501');
  perform t227.afirma('U2 una moneda distinta de COP/USD se rechaza (CHECK empaquetados_moneda_chk)', v_m like '23514%', v_m);
  v_m := t227.msg('update public.empaquetados set moneda = null where id = 230501');
  perform t227.afirma('U3 la moneda sigue siendo obligatoria (NOT NULL)', v_m like '23502%', v_m);
  perform t227.afirma('U4 el CHECK viejo (solo COP) ya no existe y el nuevo sí',
    not exists (select 1 from pg_constraint where conrelid = 'public.empaquetados'::regclass and conname = 'empaquetados_moneda_cop_chk')
    and exists (select 1 from pg_constraint where conrelid = 'public.empaquetados'::regclass and conname = 'empaquetados_moneda_chk'));

  -- U5.. salidas vinculadas
  insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, fee_infante, aplica_mk, ta, moneda)
  values (230310, 230501, current_date + 70, current_date + 74, 'MDE - SDQ - MDE', 'AEROTEST', 415, 45, false, 0, 'USD');
  perform t227.afirma('U5 una salida vinculada en USD a un vuelo USD se crea', exists (select 1 from public.salidas_dinamicas where paquete_id = 230310 and empaquetado_id = 230501 and moneda = 'USD'));
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, valor_tiquete, aplica_mk, ta, moneda) values (230310, 230502, current_date + 71, 415, false, 0, ''COP'')');
  perform t227.afirma('U6 una vinculada en COP a un vuelo USD se rechaza (salida_vinculada_moneda)', v_m like '%salida_vinculada_moneda%', v_m);
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, valor_tiquete, aplica_mk, ta) values (230310, 230502, current_date + 71, 415, false, 0)');
  perform t227.afirma('U7 una vinculada SIN moneda explícita (default COP) a un vuelo USD también se rechaza', v_m like '%salida_vinculada_moneda%', v_m);
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, valor_tiquete, aplica_mk, ta, moneda) values (230310, 230504, current_date + 73, 1130000, false, 0, ''USD'')');
  perform t227.afirma('U8 una vinculada en USD a un vuelo COP se rechaza (la moneda debe coincidir en ambos sentidos)', v_m like '%salida_vinculada_moneda%', v_m);
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, valor_tiquete, aplica_mk, ta, moneda) values (230310, 230502, current_date + 71, 415, true, 0, ''USD'')');
  perform t227.afirma('U9 sigue prohibido el doble margen en USD: markup en una vinculada rechazado (CHECK)', v_m like '23514%', v_m);
  v_m := t227.msg('insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, valor_tiquete, aplica_mk, ta, moneda) values (230310, 230502, current_date + 71, 415, false, 10, ''USD'')');
  perform t227.afirma('U10 ...y la TA también', v_m like '23514%', v_m);
  v_m := t227.msg('update public.salidas_dinamicas set moneda = ''COP'' where paquete_id = 230310 and empaquetado_id = 230501');
  perform t227.afirma('U11 cambiar la moneda de una vinculada para que difiera de su fuente se rechaza (UPDATE OF moneda vigilado)', v_m like '%salida_vinculada_moneda%', v_m);

  -- U12 invalidación: la moneda del empaquetado mueve la revisión de las dos vías
  insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, fee_infante, aplica_mk, ta, moneda)
  values (230310, 230503, current_date + 72, current_date + 76, 'MDE - SDQ - MDE', 'AEROTEST', 415, 45, false, 0, 'USD');
end $$;

do $$
declare v_rev_bloq bigint; v_rev_dyn bigint; v_costos bigint; v_n_cop integer;
begin
  select tarifario_revision_fuente into v_rev_bloq from public.armado_paquetes where id = 230311;
  select tarifario_revision_fuente, p63_rev_costos into v_rev_dyn, v_costos from public.armado_paquetes where id = 230310;
  update public.empaquetados set moneda = 'USD' where id = 230504;       -- vuelo del Bloqueo/Porción (vía armado_empaquetados)
  perform t227.afirma('U12 cambiar la moneda de un empaquetado invalida el tarifario de un Bloqueo/Porción que lo usa (trigger 226 + moneda)',
    (select tarifario_revision_fuente from public.armado_paquetes where id = 230311) > v_rev_bloq);
  update public.empaquetados set moneda = 'COP' where id = 230504;
  update public.empaquetados set moneda = 'COP' where id = 230503;       -- vuelo vinculado a 230310
  perform t227.afirma('U13 ...y el de un Dinámico con una salida vinculada a él (trigger propio de la 227)',
    (select tarifario_revision_fuente from public.armado_paquetes where id = 230310) > v_rev_dyn);
  perform t227.afirma('U14 ...y el contador de costos de #63 (p63_rev_costos) también se mueve con la moneda',
    (select p63_rev_costos from public.armado_paquetes where id = 230310) > v_costos);
  update public.empaquetados set moneda = 'USD' where id = 230503;       -- se restablece la coherencia con su salida
  select count(*) into v_n_cop from public.salidas_dinamicas s join public.empaquetados e on e.id = s.empaquetado_id where s.paquete_id = 230310 and s.moneda is distinct from e.moneda;
  perform t227.afirma('U15 (precondición) las salidas vinculadas de 230310 vuelven a coincidir con su fuente', v_n_cop = 0);
end $$;

-- ═ V · cotizar y aceptar una oferta con el vuelo en USD ═════════════════════════════════════
do $$
declare v_cot text; v_a text; v_j jsonb; v_m text; v_num text; v_acep bigint; v_der jsonb; v_cxp record; v_aereo jsonb;
begin
  perform t230.republicar(230310, 3200);
  v_cot := t230.cotizar(230310, 230501);
  perform t227.afirma('V1 se cotiza una oferta cuyo CxP aéreo está en USD', v_cot ~ '^[0-9]+$', v_cot);
  v_a := t227.aceptar(v_cot, 'h230', 'f230');
  perform t227.afirma('V2 aceptar_oferta_63 acepta un vuelo vinculado en USD (antes exigía COP)', v_a like '%numero_contrato%', v_a);
  v_j := v_a::jsonb;
  v_num := v_j->>'numero_contrato'; v_acep := (v_j->>'aceptacion_id')::bigint;
  v_aereo := (select e from jsonb_array_elements(public.p63_financiero_derivado(v_acep)->'cxp') e where e->>'tipo_proveedor' = 'aereo');
  perform t227.afirma('V3 la obligación aérea derivada de lo aceptado conserva USD y su equivalente COP congelado',
    v_aereo->>'moneda' = 'USD' and (v_aereo->>'valor_total')::numeric = 805 and (v_aereo->>'valor_cop')::numeric = 2576000 and (v_aereo->>'trm')::numeric = 3200, v_aereo::text);

  -- V4 contrato completo: cabecera + hijos + pendiente + RPC financiera
  v_m := t230.cabecera(v_num, v_acep, 230310);
  perform t227.afirma('V4 la cabecera del contrato (COP, costo aéreo = equivalente COP) pasa el fencing de la base', v_m = 'OK', v_m);
  perform t227.hijos(v_num);
  v_m := t227.pendiente(v_acep, v_num);
  perform t227.afirma('V4b el payload aceptado se guarda como pendiente (con los hijos completos)', v_m = 'OK', v_m);
  v_m := t227.finalizar(v_acep, v_num);
  perform t227.afirma('V5 la RPC financiera escribe las CxP desde lo aceptado', v_m like '%creadas%' or v_m like '%"estado"%', v_m);
  select valor_total, moneda, valor_cop_63, trm_63 into v_cxp from public.cuentas_por_pagar where numero_contrato = v_num and tipo_proveedor = 'aereo';
  perform t227.afirma('V6 la CxP aérea queda en USD 805 con valor_cop_63 = 2.576.000 y trm_63 = 3.200',
    v_cxp.valor_total = 805 and v_cxp.moneda = 'USD' and v_cxp.valor_cop_63 = 2576000 and v_cxp.trm_63 = 3200, format('%s %s %s %s', v_cxp.valor_total, v_cxp.moneda, v_cxp.valor_cop_63, v_cxp.trm_63));
  perform t227.afirma('V7 el equivalente COP coincide con valor × TRM (no hay segunda conversión ni markup)', (select abs(valor_cop_63 - round(valor_total * trm_63, 2)) <= 0.01 from public.cuentas_por_pagar where numero_contrato = v_num and tipo_proveedor = 'aereo'));
  perform t227.afirma('V8 la venta queda en COP y su costo aéreo es el equivalente COP', (select moneda = 'COP' and costo_aereo = 2576000 from public.ventas where numero_contrato = v_num));
end $$;

-- ═ W · la moneda se vigila hasta el último instante ═══════════════════════════════════════════
do $$
declare v_cot text; v_m text;
begin
  perform t230.republicar(230310, 3200);
  v_cot := t230.cotizar(230310, 230501);
  update public.empaquetados set moneda = 'COP' where id = 230501;   -- entre cotizar y aceptar
  v_m := t227.aceptar(v_cot, 'h230', 'f230');
  perform t227.afirma('W1 si la moneda de la fuente cambia entre cotizar y aceptar, la oferta se rechaza (p63_oferta_cambio)', v_m like '%p63_oferta_cambio%', v_m);
  update public.empaquetados set moneda = 'USD' where id = 230501;
  perform t230.republicar(230310, 3200);
  v_cot := t230.cotizar(230310, 230501);
  v_m := t227.aceptar(v_cot, 'h230', 'f230');
  perform t227.afirma('W2 con la fuente y la salida coherentes en USD la oferta se acepta', v_m like '%numero_contrato%', v_m);
  perform t227.afirma('W3 aceptar_oferta_63 sigue siendo solo para service_role (ACL intacta)',
    has_function_privilege('service_role', 'public.aceptar_oferta_63(bigint, text, uuid, text, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.aceptar_oferta_63(bigint, text, uuid, text, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.aceptar_oferta_63(bigint, text, uuid, text, text)', 'EXECUTE'));
end $$;

-- ═ Z · conclusión ═════════════════════════════════════════════════════════════════════════
do $$
declare n_total integer; n_fallos integer; n_a integer; n_b integer; n_c integer; n_d integer; n_e integer; n_f integer; n_g integer; n_h integer;
begin
  select count(*), count(*) filter (where not ok),
         count(*) filter (where nombre like 'A%'), count(*) filter (where nombre like 'B%'), count(*) filter (where nombre like 'C%'),
         count(*) filter (where nombre like 'D%'), count(*) filter (where nombre like 'E%'), count(*) filter (where nombre like 'F%'),
         count(*) filter (where nombre like 'G%'), count(*) filter (where nombre like 'H%')
    into n_total, n_fallos, n_a, n_b, n_c, n_d, n_e, n_f, n_g, n_h from t227.res;
  perform t227.afirma('Z conclusiva: cada bloque corrió sus comprobaciones (A–H todos con al menos una)',
    least(n_a, n_b, n_c, n_d, n_e, n_f, n_g, n_h) >= 1, format('A=%s B=%s C=%s D=%s E=%s F=%s G=%s H=%s', n_a, n_b, n_c, n_d, n_e, n_f, n_g, n_h));
  perform t227.afirma('Z2 las secciones U, V y W (USD) corrieron comprobaciones',
    (select count(*) from t227.res where nombre like 'U%') >= 10 and (select count(*) from t227.res where nombre like 'V%') >= 6 and (select count(*) from t227.res where nombre like 'W%') >= 2);
  select count(*), count(*) filter (where not ok) into n_total, n_fallos from t227.res;
  if n_fallos > 0 then
    raise notice 'TEST 230 SQL: % FALLO(S) de %', n_fallos, n_total;
    raise exception 'TEST 230 SQL en rojo';
  end if;
  raise notice 'TEST 230 SQL: TODO OK (% comprobaciones)', n_total;
end $$;

rollback;
