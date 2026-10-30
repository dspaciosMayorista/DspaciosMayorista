-- ─────────────────────────────────────────────────────────────────────────
-- BATERÍA SQL · 231 (moneda de la fuente en Bloqueos). SOLO bases desechables (CI o local); nunca una base remota.
-- Corre en UNA transacción que termina en ROLLBACK.
--
-- Uso:  psql -X -q -v ON_ERROR_STOP=1 -f test_231_moneda_bloqueos.sql   (base con 001-231)
-- Cierre esperado: "TEST 231 SQL: TODO OK".
--
--   A  columnas y CHECK: moneda solo COP/USD/NULL; moneda NULL <=> sin constancia
--   B  trigger: la constancia la escribe el servidor (en/por/ref), no el cliente; no se reescribe si la moneda no cambia;
--      una moneda acreditada no vuelve a NULL; GUC p90.moneda_ref se respeta; en COP un importe positivo < 1.000 se rechaza
--      (neta, reventa, fee) al insertar y al editar; USD y NULL no se rechazan
--   C  crear_bloqueo (RPC real, AUT-1): guarda la moneda, no la supone, rechaza la inválida y COP < 1.000; interruptor estricto
--   D  invalidación: NULL -> COP NO invalida; NULL -> USD, COP -> USD y USD -> COP SÍ; un paquete ajeno no se toca
--   E  ACL: anon no escribe; authenticated no ejecuta las funciones de trigger ni lee p90_priv
--   F  nada congelado se toca (ventas, abonos, CxP)
--   Z  conclusión: las pruebas fueron concluyentes
-- ─────────────────────────────────────────────────────────────────────────
begin;

create schema t231;
create table t231.res (nombre text, ok boolean, detalle text);

create function t231.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void
language plpgsql as $$
begin
  insert into t231.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre;
  else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;

create function t231.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000231' || case p_k
    when 'super' then '001' when 'oper' then '004' when 'ctrl' then '005' when 'vent' then '006' else '999' end)::uuid
$$;

-- Ejecuta UNA consulta que devuelve un solo texto como el usuario `p_k` con el rol de Postgres `p_rol`. Devuelve el texto o
-- 'ERR <sqlstate> <mensaje>'. `set local role` es imprescindible: un superusuario SE SALTA la RLS.
create function t231.q(p_sql text, p_k text, p_rol text default 'authenticated') returns text
language plpgsql as $$
declare v_res text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_k is null then '' else json_build_object('sub', t231.u(p_k), 'role', p_rol)::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(t231.u(p_k)::text, ''), true);
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

-- ── Usuarios de prueba ──────────────────────────────────────────────────────────────────────
insert into auth.users (id, email)
select t231.u(k), 'c231-' || k || '@x.test' from unnest(array['super','oper','ctrl','vent']) k
on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t231.u(v.k), 'c231-' || v.k || '@x.test', 'C231 ' || v.k, v.r::rol_usuario, true, 'mayorista'
from (values ('super','superadmin'), ('oper','operaciones'), ('ctrl','control_vuelo'), ('vent','venta')) v(k, r)
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (231010, 'T231 DESTINO', 'CTG', 'Colombia', true);
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id) values
  (231301, 'T231 paquete con bloqueo', 'bloqueo', true, 231010),
  (231302, 'T231 paquete ajeno', 'bloqueo', true, 231010);
select setval(pg_get_serial_sequence('public.armado_paquetes', 'id'), greatest((select max(id) from public.armado_paquetes), 231302));

-- Bloqueos creados por SQL directo (superusuario) SIN moneda: simulan los 95 existentes (NULL = sin acreditar).
insert into public.bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, fecha_regreso, tarifa_neta, tarifa_para_empaquetar, fee_infante, cupos_total, destino_id)
values ('T231A', 'AEROTEST', 'BOG - CTG - BOG', '2030-01-10', '2030-01-13', 200000, 242022, 0, 0, 231010),
       ('T231B', 'AEROTEST', 'BOG - CTG - BOG', '2030-02-10', '2030-02-13', 200000, 242022, 0, 0, 231010);
insert into public.armado_vuelos (paquete_id, bloqueo_id) select 231301, id from public.bloqueos_vuelo where record = 'T231A';

create function t231.id(p_record text) returns bigint language sql stable as $$ select id from public.bloqueos_vuelo where record = p_record $$;
create function t231.rev(p_paquete bigint) returns bigint language sql stable as $$ select tarifario_revision_fuente from public.armado_paquetes where id = p_paquete $$;
create function t231.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'sin error'; exception when others then return sqlstate || ' ' || sqlerrm; end $$;

-- ═ A · columnas y CHECK ═══════════════════════════════════════════════════════════════════
do $$
declare v text;
begin
  perform t231.afirma('A1 los Bloqueos existentes nacen sin acreditar (moneda NULL y sin constancia)',
    (select moneda is null and moneda_acreditada_en is null and moneda_acreditada_por is null and moneda_acreditada_ref is null from public.bloqueos_vuelo where record = 'T231A'));
  v := t231.err($q$update public.bloqueos_vuelo set moneda = 'EUR' where record = 'T231A'$q$);
  perform t231.afirma('A2 una moneda distinta de COP/USD se rechaza (check_violation)', v like '23514%', v);
  -- El CHECK de constancia: no se puede dejar constancia sin moneda ni moneda sin constancia (el trigger mantiene la coherencia, así que se
  -- prueba desactivándolo dentro de la transacción).
  alter table public.bloqueos_vuelo disable trigger trg_bloqueos_moneda_90;
  v := t231.err($q$update public.bloqueos_vuelo set moneda = 'COP' where record = 'T231A'$q$);
  perform t231.afirma('A3 moneda sin constancia viola el CHECK de coherencia', v like '23514%', v);
  v := t231.err($q$update public.bloqueos_vuelo set moneda_acreditada_en = now() where record = 'T231A'$q$);
  perform t231.afirma('A4 constancia sin moneda viola el CHECK de coherencia', v like '23514%', v);
  alter table public.bloqueos_vuelo enable trigger trg_bloqueos_moneda_90;
end $$;

-- ═ B · trigger de la moneda ═══════════════════════════════════════════════════════════════
do $$
declare v text; r record; t0 timestamptz;
begin
  -- B1 acreditar: la constancia la escribe el servidor aunque el cliente mande otra
  update public.bloqueos_vuelo set moneda = 'COP', moneda_acreditada_ref = 'FALSA', moneda_acreditada_por = t231.u('vent'),
         moneda_acreditada_en = '2000-01-01' where record = 'T231A';
  select * into r from public.bloqueos_vuelo where record = 'T231A';
  perform t231.afirma('B1 al acreditar, en = now(), por = auth.uid() (NULL sin sesión) y ref = ''app'' aunque el cliente mande otros valores',
    r.moneda = 'COP' and r.moneda_acreditada_en > now() - interval '1 minute' and r.moneda_acreditada_por is null and r.moneda_acreditada_ref = 'app',
    format('en=%s por=%s ref=%s', r.moneda_acreditada_en, r.moneda_acreditada_por, r.moneda_acreditada_ref));
  t0 := r.moneda_acreditada_en;

  -- B2 sin cambio de moneda la constancia no se reescribe ni se puede falsear
  update public.bloqueos_vuelo set notas = 'x', moneda_acreditada_ref = 'OTRA', moneda_acreditada_en = '2001-01-01' where record = 'T231A';
  select * into r from public.bloqueos_vuelo where record = 'T231A';
  perform t231.afirma('B2 editar otra cosa (o intentar reescribir la constancia) la deja intacta', r.moneda_acreditada_ref = 'app' and r.moneda_acreditada_en = t0);
  update public.bloqueos_vuelo set moneda = 'COP' where record = 'T231A';
  select * into r from public.bloqueos_vuelo where record = 'T231A';
  perform t231.afirma('B3 guardar la MISMA moneda no cambia la constancia', r.moneda_acreditada_en = t0);

  -- B4 una moneda acreditada no vuelve a NULL
  v := t231.err($q$update public.bloqueos_vuelo set moneda = null where record = 'T231A'$q$);
  perform t231.afirma('B4 una moneda acreditada no se puede dejar en blanco', v like '22023%MONEDA_BLOQUEO%', v);

  -- B5 cambiar de moneda: nueva constancia
  -- now() no avanza dentro de una transacción: la constancia nueva se reconoce por su referencia.
  perform set_config('p90.moneda_ref', 'cambio a USD', true);
  update public.bloqueos_vuelo set moneda = 'USD', tarifa_neta = 380, tarifa_para_empaquetar = 415 where record = 'T231A';
  perform set_config('p90.moneda_ref', '', true);
  select * into r from public.bloqueos_vuelo where record = 'T231A';
  perform t231.afirma('B5 COP -> USD con importes pequeños: acepta y estampa una constancia NUEVA', r.moneda = 'USD' and r.moneda_acreditada_ref = 'cambio a USD');

  -- B6 GUC de la decisión
  perform set_config('p90.moneda_ref', 'D2 prueba', true);
  update public.bloqueos_vuelo set moneda = 'COP', tarifa_neta = 200000, tarifa_para_empaquetar = 242022 where record = 'T231B';
  perform set_config('p90.moneda_ref', '', true);
  perform t231.afirma('B6 la referencia de una acreditación en bloque viaja en el parámetro local p90.moneda_ref',
    (select moneda_acreditada_ref from public.bloqueos_vuelo where record = 'T231B') = 'D2 prueba');
end $$;

do $$
declare v text;
begin
  -- COP < 1.000 (regla del dueño): insertar y editar
  v := t231.err($q$insert into public.bloqueos_vuelo (record, tarifa_neta, tarifa_para_empaquetar, moneda) values ('T231C1', 380, 242022, 'COP')$q$);
  perform t231.afirma('B7 insertar en COP con tarifa neta < 1.000 se rechaza con la pregunta del USD', v like '22023%¿Este valor está en USD?%Tarifa neta%', v);
  v := t231.err($q$insert into public.bloqueos_vuelo (record, tarifa_neta, tarifa_para_empaquetar, moneda) values ('T231C2', 200000, 415, 'COP')$q$);
  perform t231.afirma('B8 insertar en COP con tarifa de reventa < 1.000 se rechaza', v like '22023%Tarifa empaquetar (reventa)%', v);
  v := t231.err($q$insert into public.bloqueos_vuelo (record, tarifa_neta, tarifa_para_empaquetar, fee_infante, moneda) values ('T231C3', 200000, 242022, 45, 'COP')$q$);
  perform t231.afirma('B9 insertar en COP con fee de infante < 1.000 se rechaza', v like '22023%Fee de infante%', v);
  v := t231.err($q$update public.bloqueos_vuelo set fee_infante = 45 where record = 'T231B'$q$);
  perform t231.afirma('B10 editar a un fee < 1.000 en un Bloqueo COP se rechaza', v like '22023%Fee de infante%', v);
  v := t231.err($q$update public.bloqueos_vuelo set moneda = 'COP' where record = 'T231A'$q$);
  perform t231.afirma('B11 cambiar a COP un Bloqueo con importes pequeños (USD) se rechaza', v like '22023%¿Este valor está en USD?%', v);
  v := t231.err($q$insert into public.bloqueos_vuelo (record, tarifa_neta, tarifa_para_empaquetar, fee_infante, moneda) values ('T231C4', 380, 415, 45, 'USD')$q$);
  perform t231.afirma('B12 los mismos importes en USD se aceptan', v = 'sin error', v);
  v := t231.err($q$insert into public.bloqueos_vuelo (record, tarifa_neta, tarifa_para_empaquetar, fee_infante, moneda) values ('T231C5', 200000, 242022, 0, 'COP')$q$);
  perform t231.afirma('B13 COP con importes reales y fee 0 se acepta (0 no es sospechoso)', v = 'sin error', v);
  v := t231.err($q$insert into public.bloqueos_vuelo (record, tarifa_neta, tarifa_para_empaquetar, fee_infante, moneda) values ('T231C6', 1000, 999.99, 0, 'COP')$q$);
  perform t231.afirma('B14 el umbral es 1.000 exclusivo: 999,99 se rechaza', v like '22023%Tarifa empaquetar%', v);
  insert into public.bloqueos_vuelo (record, tarifa_neta, tarifa_para_empaquetar) values ('T231C7', 380, 415);
  perform t231.afirma('B15 sin moneda (NULL) no se juzga el importe: se acepta (interruptor apagado)', true);
  update public.bloqueos_vuelo set notas = 'sigue editable' where record = 'T231C7';
  perform t231.afirma('B16 un Bloqueo sin acreditar con importes pequeños sigue siendo editable en lo demás', true);
end $$;

-- ═ C · crear_bloqueo (RPC real) ═══════════════════════════════════════════════════════════
do $$
declare v text; r record;
begin
  v := t231.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't231r1', 'modalidad_emision', 'serie', 'moneda', 'USD',
         'tarifa_neta', 380, 'tarifa_para_empaquetar', 415, 'fee_infante', 45), 2))->>'id'$q$, 'ctrl');
  select * into r from public.bloqueos_vuelo where record = 'T231R1';
  perform t231.afirma('C1 crear_bloqueo con moneda USD la guarda y deja la constancia del usuario',
    r.moneda = 'USD' and r.moneda_acreditada_por = t231.u('ctrl') and r.moneda_acreditada_ref = 'app', coalesce(v, '') || ' / ' || coalesce(r.moneda, '<sin fila>'));
  perform t231.afirma('C2 crear_bloqueo crea también las 2 sillas', (select count(*) from public.sillas where bloqueo_id = r.id) = 2);

  v := t231.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't231r2', 'modalidad_emision', 'serie', 'tarifa_neta', 200000), 1))->>'id'$q$, 'ctrl');
  select * into r from public.bloqueos_vuelo where record = 'T231R2';
  perform t231.afirma('C3 sin moneda se crea SIN ACREDITAR (NULL), nunca COP implícito, mientras el interruptor está apagado', r.id is not null and r.moneda is null and r.moneda_acreditada_en is null, v);

  v := t231.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't231r3', 'modalidad_emision', 'serie', 'moneda', 'EUR'), 1))->>'id'$q$, 'ctrl');
  perform t231.afirma('C4 moneda inválida se rechaza con mensaje legible y no crea nada', v like 'ERR 22023%MONEDA_BLOQUEO%COP o USD%' and not exists (select 1 from public.bloqueos_vuelo where record = 'T231R3'), v);

  v := t231.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't231r4', 'modalidad_emision', 'serie', 'moneda', 'COP', 'tarifa_para_empaquetar', 415), 1))->>'id'$q$, 'ctrl');
  perform t231.afirma('C5 COP con reventa 415 se rechaza ("¿Este valor está en USD?") y no deja Bloqueo ni sillas',
    v like 'ERR 22023%¿Este valor está en USD?%' and not exists (select 1 from public.bloqueos_vuelo where record = 'T231R4'), v);

  v := t231.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't231r5', 'modalidad_emision', 'serie', 'moneda', 'cop', 'tarifa_neta', 200000), 1))->>'id'$q$, 'ctrl');
  perform t231.afirma('C6 la moneda se normaliza a mayúsculas', (select moneda from public.bloqueos_vuelo where record = 'T231R5') = 'COP', v);

  -- Interruptor estricto
  update p90_priv.config set exigir_moneda_bloqueo = true where id;
  v := t231.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't231r6', 'modalidad_emision', 'serie', 'tarifa_neta', 200000), 1))->>'id'$q$, 'ctrl');
  perform t231.afirma('C7 con el interruptor ENCENDIDO, crear sin moneda se rechaza', v like 'ERR 22023%elige la moneda%' and not exists (select 1 from public.bloqueos_vuelo where record = 'T231R6'), v);
  v := t231.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't231r7', 'modalidad_emision', 'serie', 'moneda', 'COP', 'tarifa_neta', 200000), 1))->>'id'$q$, 'ctrl');
  perform t231.afirma('C8 con el interruptor encendido, crear con moneda funciona', exists (select 1 from public.bloqueos_vuelo where record = 'T231R7'), v);
  v := t231.err($q$update public.bloqueos_vuelo set tarifa_neta = 250000 where record = 'T231C7'$q$);
  perform t231.afirma('C9 encendido, cambiar la tarifa de un Bloqueo sin acreditar exige moneda', v like '22023%elige la moneda%', v);
  update public.bloqueos_vuelo set notas = 'otra nota' where record = 'T231C7';
  perform t231.afirma('C10 encendido, editar lo que no es tarifa sigue permitido', true);
  update p90_priv.config set exigir_moneda_bloqueo = false where id;
  v := t231.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't231r8', 'modalidad_emision', 'serie'), 1))->>'id'$q$, 'ctrl');
  perform t231.afirma('C11 el interruptor se apaga y vuelve a crear sin moneda', exists (select 1 from public.bloqueos_vuelo where record = 'T231R8' and moneda is null), v);
  perform t231.afirma('C12 existe exactamente una fila de configuración del interruptor',
    (select count(*) from p90_priv.config) = 1);
end $$;

-- ═ D · invalidación del tarifario ═════════════════════════════════════════════════════════
do $$
declare r0 bigint; r1 bigint; v_b bigint := t231.id('T231B');
begin
  -- Se parte de un Bloqueo SIN acreditar, enlazado al paquete 231301.
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, fecha_regreso, tarifa_neta, tarifa_para_empaquetar, fee_infante, destino_id)
  values ('T231D', 'AEROTEST', 'BOG - CTG - BOG', '2030-03-10', '2030-03-13', 200000, 242022, 0, 231010);
  insert into public.armado_vuelos (paquete_id, bloqueo_id) select 231301, id from public.bloqueos_vuelo where record = 'T231D';
  r0 := t231.rev(231301);
  perform set_config('p90.moneda_ref', 'D2 prueba', true);
  update public.bloqueos_vuelo set moneda = 'COP' where record = 'T231D';
  perform set_config('p90.moneda_ref', '', true);
  r1 := t231.rev(231301);
  perform t231.afirma('D1 acreditar NULL -> COP sin otro cambio NO invalida el tarifario del paquete (no cambia ningún precio)', r1 = r0, format('r0=%s r1=%s', r0, r1));

  r0 := t231.rev(231301);
  update public.bloqueos_vuelo set moneda = 'USD', tarifa_neta = 380, tarifa_para_empaquetar = 415 where record = 'T231D';
  r1 := t231.rev(231301);
  perform t231.afirma('D2 COP -> USD invalida el tarifario del paquete enlazado', r1 > r0 and (select tarifario_estado from public.armado_paquetes where id = 231301) = 'pendiente', format('r0=%s r1=%s', r0, r1));

  r0 := t231.rev(231301);
  update public.bloqueos_vuelo set moneda = 'COP', tarifa_neta = 200000, tarifa_para_empaquetar = 242022 where record = 'T231D';
  r1 := t231.rev(231301);
  perform t231.afirma('D3 USD -> COP también invalida', r1 > r0, format('r0=%s r1=%s', r0, r1));

  -- NULL -> USD: bloqueo sin acreditar que se acredita en USD (con importes de dólares)
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, fecha_regreso, tarifa_neta, tarifa_para_empaquetar, destino_id)
  values ('T231E', 'AEROTEST', 'BOG - CTG - BOG', '2030-04-10', '2030-04-13', 380, 415, 231010);
  insert into public.armado_vuelos (paquete_id, bloqueo_id) select 231301, id from public.bloqueos_vuelo where record = 'T231E';
  r0 := t231.rev(231301);
  update public.bloqueos_vuelo set moneda = 'USD' where record = 'T231E';
  r1 := t231.rev(231301);
  perform t231.afirma('D4 acreditar NULL -> USD SÍ invalida (cambia el significado de los importes)', r1 > r0, format('r0=%s r1=%s', r0, r1));

  -- NULL -> COP junto con un cambio de tarifa: la excepción no aplica
  insert into public.bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, fecha_regreso, tarifa_neta, tarifa_para_empaquetar, destino_id)
  values ('T231F', 'AEROTEST', 'BOG - CTG - BOG', '2030-05-10', '2030-05-13', 200000, 242022, 231010);
  insert into public.armado_vuelos (paquete_id, bloqueo_id) select 231301, id from public.bloqueos_vuelo where record = 'T231F';
  r0 := t231.rev(231301);
  update public.bloqueos_vuelo set moneda = 'COP', tarifa_para_empaquetar = 250000 where record = 'T231F';
  r1 := t231.rev(231301);
  perform t231.afirma('D5 NULL -> COP junto con un cambio de tarifa SÍ invalida', r1 > r0, format('r0=%s r1=%s', r0, r1));

  -- Un paquete ajeno no se toca
  r0 := t231.rev(231302);
  update public.bloqueos_vuelo set moneda = 'USD', tarifa_neta = 380, tarifa_para_empaquetar = 415 where record = 'T231D';
  perform t231.afirma('D6 un paquete ajeno (231302) no se invalida', t231.rev(231302) = r0);
end $$;

-- ═ E · ACL ════════════════════════════════════════════════════════════════════════════════
do $$
declare v text;
begin
  perform t231.afirma('E1 anon no escribe en bloqueos_vuelo',
    not has_table_privilege('anon', 'public.bloqueos_vuelo', 'INSERT') and not has_table_privilege('anon', 'public.bloqueos_vuelo', 'UPDATE')
    and not has_table_privilege('anon', 'public.bloqueos_vuelo', 'DELETE'));
  perform t231.afirma('E2 anon no ejecuta crear_bloqueo; authenticated sí (la autorización real es el rol interno)',
    not has_function_privilege('anon', 'public.crear_bloqueo(jsonb, integer)', 'EXECUTE') and has_function_privilege('authenticated', 'public.crear_bloqueo(jsonb, integer)', 'EXECUTE'));
  v := t231.q('select public.trg_bloqueos_moneda_90()::text', 'oper');
  perform t231.afirma('E3 la API no ejecuta la función del trigger de la moneda', v like 'ERR%', v);
  perform t231.afirma('E4 authenticated/anon no tienen acceso al esquema privado p90_priv ni a su interruptor',
    not has_schema_privilege('authenticated', 'p90_priv', 'USAGE') and not has_schema_privilege('anon', 'p90_priv', 'USAGE')
    and not has_table_privilege('authenticated', 'p90_priv.config', 'SELECT') and not has_function_privilege('authenticated', 'p90_priv.exigir_moneda_bloqueo()', 'EXECUTE'));
  v := t231.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't231v', 'modalidad_emision', 'serie', 'moneda', 'COP'), 1))->>'id'$q$, 'vent');
  perform t231.afirma('E5 un rol sin acceso a vuelos (venta) no crea Bloqueos aunque mande moneda', v like 'ERR%' and not exists (select 1 from public.bloqueos_vuelo where record = 'T231V'), v);
  v := t231.q($q$update public.bloqueos_vuelo set moneda = 'USD' where record = 'T231C5'$q$, 'vent');
  perform t231.afirma('E6 un rol sin permiso no cambia la moneda por la API (RLS)', (select moneda from public.bloqueos_vuelo where record = 'T231C5') = 'COP', v);
end $$;

-- ═ F · lo congelado no se toca ═════════════════════════════════════════════════════════════
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta) values ('DTM-923101', 'Cliente prueba 231', 'mayorista', 4765000);
insert into public.abonos (numero_contrato, tenant, valor_abono, fecha_abono) values ('DTM-923101', 'mayorista', 1000000, current_date);
insert into public.cuentas_por_pagar (numero_contrato, tenant, tipo_proveedor, servicio, valor_total) values ('DTM-923101', 'mayorista', 'hotel', 'Hotel T231', 860000);
do $$
declare v_antes text; v_despues text;
begin
  v_antes := (select md5(string_agg(x, '|' order by x)) from (
    select v::text as x from public.ventas v where numero_contrato = 'DTM-923101'
    union all select a::text from public.abonos a where numero_contrato = 'DTM-923101'
    union all select c::text from public.cuentas_por_pagar c where numero_contrato = 'DTM-923101') s);
  update public.bloqueos_vuelo set moneda = 'USD', tarifa_neta = 380, tarifa_para_empaquetar = 415 where record = 'T231B';
  update public.bloqueos_vuelo set moneda = 'COP', tarifa_neta = 200000, tarifa_para_empaquetar = 242022 where record = 'T231B';
  v_despues := (select md5(string_agg(x, '|' order by x)) from (
    select v::text as x from public.ventas v where numero_contrato = 'DTM-923101'
    union all select a::text from public.abonos a where numero_contrato = 'DTM-923101'
    union all select c::text from public.cuentas_por_pagar c where numero_contrato = 'DTM-923101') s);
  perform t231.afirma('F1 ventas, abonos y cuentas por pagar quedan idénticos', v_antes is not null and v_antes = v_despues);
end $$;

-- ═ Z · conclusión ═════════════════════════════════════════════════════════════════════════
do $$
declare n_total integer; n_fallos integer; n_a integer; n_b integer; n_c integer; n_d integer; n_e integer; n_f integer;
begin
  select count(*), count(*) filter (where not ok),
         count(*) filter (where nombre like 'A%'), count(*) filter (where nombre like 'B%'), count(*) filter (where nombre like 'C%'),
         count(*) filter (where nombre like 'D%'), count(*) filter (where nombre like 'E%'), count(*) filter (where nombre like 'F%')
    into n_total, n_fallos, n_a, n_b, n_c, n_d, n_e, n_f from t231.res;
  perform t231.afirma('Z conclusiva: cada bloque corrió sus comprobaciones (A,B,C,D,E,F todos con al menos una)',
    least(n_a, n_b, n_c, n_d, n_e, n_f) >= 1, format('A=%s B=%s C=%s D=%s E=%s F=%s', n_a, n_b, n_c, n_d, n_e, n_f));
  select count(*), count(*) filter (where not ok) into n_total, n_fallos from t231.res;
  if n_fallos > 0 then
    raise notice 'TEST 231 SQL: % FALLO(S) de %', n_fallos, n_total;
    raise exception 'TEST 231 SQL en rojo';
  end if;
  raise notice 'TEST 231 SQL: TODO OK (% comprobaciones)', n_total;
end $$;

rollback;
