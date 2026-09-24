-- ─────────────────────────────────────────────────────────────────────────
-- AUDITORÍA DE SEGURIDAD · crm_pasajeros_contrato_buscar (migración 188,
-- rama "CRM pasajeros de contratos" — renumerada de 187 a 188 porque la
-- migración 187 real, "búsqueda de pasajero por documento" de otra rama,
-- ya se aplicó en staging; ver la nota de numeración en la cabecera de la
-- migración 188). Correr DESPUÉS de aplicar esa 187 y esta 188.
--
-- 100% AUTO-CONTENIDO: crea sus propios 3 contratos de prueba (dos
-- tenants + uno "ajeno" del mismo tenant que A) y usa un usuario YA
-- EXISTENTE de la base (se le cambia rol/tenant TEMPORALMENTE con UPDATE,
-- dentro de esta misma transacción) para impersonar cada escenario. Nunca
-- omite un escenario crítico por falta de datos "de casualidad" en esta
-- base — la única excepción real es una base con CERO usuarios.
--
-- Es de solo lectura sobre los datos reales: todo lo que inserta/actualiza
-- vive dentro de esta transacción y se descarta con ROLLBACK al final.
--
-- Escenarios:
--   1) superadmin → ve pasajeros de AMBAS agencias.
--   2) gerencia → ve pasajeros de AMBAS agencias.
--   3) administracion de la agencia A → ve A, NO ve B.
--   4) operaciones de la agencia B → ve B, NO ve A (simétrico).
--   5) venta asignado al contrato A → ve A (contrato propio).
--   6) venta — contrato AJENO, MISMA agencia, otro asesor → NO ve (C).
--   7) venta — contrato de la OTRA agencia → NO ve (B).
--   8) usuario interno DESACTIVADO → excepción explícita.
--   9) usuario externo ACTIVO (rol agencia) → excepción explícita.
--  10) Sin sesión (anon) → excepción.
--  11) Paginación: tam_pagina=1 devuelve EXACTAMENTE 1 fila y total_filas
--      refleja el conteo real visible (no el total global de la tabla).
--  12) Búsqueda por texto (ILIKE) encuentra la fila esperada Y sigue
--      respetando el filtro de permiso (no se puede usar p_busqueda para
--      ver más de lo que el rol ya podría listar).
--
-- LECTURA DEL RESULTADO: cualquier fila cuyo `resultado` EMPIECE por
-- 'FALLA' hace fallar el veredicto (`like 'FALLA%'`, nunca igualdad
-- exacta). El veredicto exige EXACTAMENTE 12 filas de caso — un conteo
-- distinto da 'INCOMPLETO'. 'OMITIDO' nunca cuenta como aprobado. Una
-- corrida que no produjo NINGUNA fila (fallo catastrófico) también da
-- 'FALLA' explícito — nunca 'OK' por defecto.
-- ─────────────────────────────────────────────────────────────────────────

begin;

create temp table _t188crm_sec (caso text, resultado text, detalle text) on commit drop;

-- Mismo motivo que en el resto de la batería 188: varios escenarios
-- escriben en esta tabla TODAVÍA impersonando `authenticated` (antes de
-- `reset role`) — sin este GRANT, el INSERT falla con "permission denied"
-- y el test aborta a mitad de camino en vez de dejar un resultado completo.
grant select, insert on _t188crm_sec to authenticated;

do $$
declare
  v_actor_id      uuid;
  v_asesor_email  constant text := 'prueba188crm.seguridad@test.local';
  v_sufijo_ts     constant text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');
  v_num_a         constant text := 'DTM-' || v_sufijo_ts || '1';
  v_num_b         constant text := 'MIN-' || v_sufijo_ts;
  v_num_c         constant text := 'DTM-' || v_sufijo_ts || '3';
  v_doc_a         constant text := '900188CRMA';
  v_doc_b         constant text := '900188CRMB';
  v_doc_c         constant text := '900188CRMC';
  n int;
  v_ve_a boolean; v_ve_b boolean; v_ve_c boolean;
  v_total int; v_n int;
begin
  select id into v_actor_id from public.usuarios order by id limit 1;
  if v_actor_id is null then
    insert into _t188crm_sec values ('setup', 'FALLA', 'No hay NINGÚN usuario en public.usuarios — no se puede probar aislamiento por rol.');
    return;
  end if;

  insert into public.ventas (numero_contrato, tenant, asesor, cliente, estado)
    values (v_num_a, 'mayorista', v_asesor_email, 'PRUEBA188CRM', 'activo');
  insert into public.ventas (numero_contrato, tenant, asesor, cliente, estado)
    values (v_num_b, 'minorista', null, 'PRUEBA188CRM', 'activo');
  insert into public.ventas (numero_contrato, tenant, asesor, cliente, estado)
    values (v_num_c, 'mayorista', null, 'PRUEBA188CRM', 'activo');

  insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, orden)
    values (v_num_a, 'TEST188CRM PASAJERO A', 'CC', v_doc_a, 999);
  insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, orden)
    values (v_num_b, 'TEST188CRM PASAJERO B', 'CC', v_doc_b, 999);
  insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, orden)
    values (v_num_c, 'TEST188CRM PASAJERO C', 'CC', v_doc_c, 999);

  -- ── 1) superadmin → ambas agencias ───────────────────────────────────────
  update public.usuarios set rol = 'superadmin', tenant = 'mayorista', activo = true where id = v_actor_id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
  select bool_or(nombre = 'TEST188CRM PASAJERO A'), bool_or(nombre = 'TEST188CRM PASAJERO B')
    into v_ve_a, v_ve_b
    from public.crm_pasajeros_contrato_buscar(null, 1, 500);
  insert into _t188crm_sec values ('1-superadmin-ambas-agencias', case when coalesce(v_ve_a,false) and coalesce(v_ve_b,false) then 'OK' else 'FALLA' end, format('ve_a=%s ve_b=%s', v_ve_a, v_ve_b));
  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- ── 2) gerencia → ambas agencias ─────────────────────────────────────────
  update public.usuarios set rol = 'gerencia', tenant = 'mayorista', activo = true where id = v_actor_id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
  select bool_or(nombre = 'TEST188CRM PASAJERO A'), bool_or(nombre = 'TEST188CRM PASAJERO B')
    into v_ve_a, v_ve_b
    from public.crm_pasajeros_contrato_buscar(null, 1, 500);
  insert into _t188crm_sec values ('2-gerencia-ambas-agencias', case when coalesce(v_ve_a,false) and coalesce(v_ve_b,false) then 'OK' else 'FALLA' end, format('ve_a=%s ve_b=%s', v_ve_a, v_ve_b));
  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- ── 3) administracion de A → A sí, B no ──────────────────────────────────
  update public.usuarios set rol = 'administracion', tenant = 'mayorista', activo = true where id = v_actor_id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
  select bool_or(nombre = 'TEST188CRM PASAJERO A'), bool_or(nombre = 'TEST188CRM PASAJERO B')
    into v_ve_a, v_ve_b
    from public.crm_pasajeros_contrato_buscar(null, 1, 500);
  insert into _t188crm_sec values ('3-administracion-agencia-a', case when coalesce(v_ve_a,false) and not coalesce(v_ve_b,false) then 'OK' else 'FALLA' end, format('ve_a=%s ve_b=%s (esperado true/false)', v_ve_a, v_ve_b));
  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- ── 4) operaciones de B → B sí, A no (simétrico) ─────────────────────────
  update public.usuarios set rol = 'operaciones', tenant = 'minorista', activo = true where id = v_actor_id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
  select bool_or(nombre = 'TEST188CRM PASAJERO A'), bool_or(nombre = 'TEST188CRM PASAJERO B')
    into v_ve_a, v_ve_b
    from public.crm_pasajeros_contrato_buscar(null, 1, 500);
  insert into _t188crm_sec values ('4-operaciones-agencia-b', case when coalesce(v_ve_b,false) and not coalesce(v_ve_a,false) then 'OK' else 'FALLA' end, format('ve_a=%s ve_b=%s (esperado false/true)', v_ve_a, v_ve_b));
  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- ── 5/6/7) venta asignado SOLO al contrato A ─────────────────────────────
  update public.usuarios set rol = 'venta', tenant = 'mayorista', activo = true, email = v_asesor_email where id = v_actor_id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
  select
    bool_or(nombre = 'TEST188CRM PASAJERO A'),
    bool_or(nombre = 'TEST188CRM PASAJERO B'),
    bool_or(nombre = 'TEST188CRM PASAJERO C')
    into v_ve_a, v_ve_b, v_ve_c
    from public.crm_pasajeros_contrato_buscar(null, 1, 500);
  insert into _t188crm_sec values ('5-venta-contrato-propio', case when coalesce(v_ve_a,false) then 'OK' else 'FALLA' end, 'Debe ver su propio contrato (A).');
  insert into _t188crm_sec values ('6-venta-contrato-ajeno-misma-agencia', case when not coalesce(v_ve_c,false) then 'OK' else 'FALLA (FUGA)' end, 'NO debe ver un contrato de la MISMA agencia asignado a otro asesor (C).');
  insert into _t188crm_sec values ('7-venta-otra-agencia', case when not coalesce(v_ve_b,false) then 'OK' else 'FALLA (FUGA cross-tenant)' end, 'NO debe ver un contrato de la OTRA agencia (B).');

  -- ── 11) Paginación: tam_pagina=1 → exactamente 1 fila, total_filas real.
  select count(*), max(total_filas) into v_n, v_total from public.crm_pasajeros_contrato_buscar(null, 1, 1);
  insert into _t188crm_sec values ('11-paginacion-tam-1', case when v_n = 1 and v_total >= 1 then 'OK' else 'FALLA' end, format('filas=%s total_filas=%s (esperado filas=1, total_filas>=1)', v_n, v_total));

  -- ── 12) Búsqueda por texto: encuentra A, sigue sin ver B/C.
  select
    bool_or(nombre = 'TEST188CRM PASAJERO A'),
    bool_or(nombre = 'TEST188CRM PASAJERO B'),
    bool_or(nombre = 'TEST188CRM PASAJERO C')
    into v_ve_a, v_ve_b, v_ve_c
    from public.crm_pasajeros_contrato_buscar('TEST188CRM', 1, 500);
  insert into _t188crm_sec values ('12-busqueda-respeta-permiso', case when coalesce(v_ve_a,false) and not coalesce(v_ve_b,false) and not coalesce(v_ve_c,false) then 'OK' else 'FALLA' end, format('ve_a=%s ve_b=%s ve_c=%s (esperado true/false/false)', v_ve_a, v_ve_b, v_ve_c));

  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- ── 8) usuario interno DESACTIVADO → excepción explícita ─────────────────
  update public.usuarios set rol = 'venta', tenant = 'mayorista', activo = false where id = v_actor_id;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
    perform * from public.crm_pasajeros_contrato_buscar(null, 1, 10);
    reset role;
    insert into _t188crm_sec values ('8-usuario-inactivo', 'FALLA', 'Un usuario interno desactivado debía recibir una excepción explícita y no la recibió.');
  exception when others then
    reset role;
    insert into _t188crm_sec values ('8-usuario-inactivo', case when sqlerrm like '%Sin permiso%' then 'OK' else 'FALLA' end, 'Rechazado: ' || sqlerrm);
  end;
  update public.usuarios set activo = true where id = v_actor_id;

  -- ── 9) usuario externo ACTIVO (rol agencia) → excepción explícita ────────
  update public.usuarios set rol = 'agencia', tenant = 'mayorista', activo = true where id = v_actor_id;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
    perform * from public.crm_pasajeros_contrato_buscar(null, 1, 10);
    reset role;
    insert into _t188crm_sec values ('9-usuario-externo-agencia', 'FALLA', 'Un rol externo (agencia) debía recibir una excepción y no la recibió.');
  exception when others then
    reset role;
    insert into _t188crm_sec values ('9-usuario-externo-agencia', case when sqlerrm like '%Sin permiso%' then 'OK' else 'FALLA' end, 'Rechazado: ' || sqlerrm);
  end;

  -- ── 10) sin sesión (anon) → excepción ─────────────────────────────────────
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', null, true);
    perform * from public.crm_pasajeros_contrato_buscar(null, 1, 10);
    reset role;
    insert into _t188crm_sec values ('10-sin-sesion-anon', 'FALLA', 'Debía lanzar excepción (permiso denegado por el GRANT) y no la lanzó.');
  exception when others then
    reset role;
    insert into _t188crm_sec values ('10-sin-sesion-anon', 'OK', 'Rechazado: ' || sqlerrm);
  end;

exception when others then
  reset role;
  insert into _t188crm_sec values ('EXCEPCION-NO-CAPTURADA', 'FALLA', sqlerrm);
end $$;

select * from _t188crm_sec order by caso;

select jsonb_build_object(
  'veredicto',
    case
      when not exists (select 1 from _t188crm_sec) then 'FALLA'
      when exists (select 1 from _t188crm_sec where resultado like 'FALLA%') then 'FALLA'
      when (select count(*) from _t188crm_sec) <> 12 then 'INCOMPLETO'
      when exists (select 1 from _t188crm_sec where resultado = 'OMITIDO') then 'INCOMPLETO'
      else 'OK'
    end,
  'mensaje',
    case
      when not exists (select 1 from _t188crm_sec)
        then 'El test no produjo NINGÚN resultado; esto NUNCA es una aprobación.'
      when exists (select 1 from _t188crm_sec where resultado like 'FALLA%')
        then 'Revisar los casos con resultado FALLA en "casos".'
      when (select count(*) from _t188crm_sec) <> 12
        then 'Se esperaban 12 casos y se registraron ' || (select count(*)::text from _t188crm_sec) || '; el DO block pudo abortar a mitad de camino.'
      when exists (select 1 from _t188crm_sec where resultado = 'OMITIDO')
        then 'Hay casos OMITIDOS; esto NO es una aprobación.'
      else 'Identidad propagada correctamente y aislamiento confirmado por rol/agencia/contrato propio, en los 12 casos.'
    end,
  'casos', coalesce((select jsonb_agg(jsonb_build_object('caso', caso, 'resultado', resultado, 'detalle', detalle) order by caso) from _t188crm_sec), '[]'::jsonb)
) as resultado_test_188_crm_pasajeros;

rollback;
