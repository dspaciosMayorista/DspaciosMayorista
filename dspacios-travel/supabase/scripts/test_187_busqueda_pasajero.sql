-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA · búsqueda de pasajero por documento (migración 187) — datos reales
-- correr en el editor SQL de Supabase, DESPUÉS de aplicar la 187.
--
-- ⚠️ El aislamiento por rol/agencia/contrato propio (sin sesión, venta
-- propio/ajeno, Mayorista/Minorista, gerencia, operaciones, usuario externo,
-- usuario inactivo) se prueba en `test_187_seguridad_rls.sql`, que es
-- AUTO-CONTENIDO (crea sus propios contratos/usuarios de prueba dentro de la
-- transacción) y por eso NUNCA omite un escenario crítico por falta de datos
-- en esta base en particular. Este archivo se queda con lo que sí conviene
-- probar contra datos REALES (agrupación/conflicto de datos existentes,
-- forma exacta del retorno, que las 5 funciones del núcleo de la 167 siguen
-- EXISTIENDO con ese nombre) — correr AMBOS, nunca uno solo.
--
-- Es de solo lectura sobre los datos reales: los pasajeros de prueba que
-- inserta son TEMPORALES, viven dentro de esta misma transacción y se
-- descartan con ROLLBACK al final — nunca quedan en la base.
--
-- Escenarios cubiertos aquí (7 casos en una corrida completa; ver la nota de
-- conteo de filas más abajo):
--   1) Documento inexistente                → 0 filas, sin error.
--   2) Datos históricos incompletos: una fila con fecha_nacimiento Y
--      nacionalidad null A LA VEZ (mismo campo, misma fila — no dos filas
--      distintas cada una con un dato faltante) → se devuelve igual, con
--      ambos null, nunca se descartan ni se inventan.
--   3) Conflicto de datos: el mismo documento con NOMBRE distinto en dos
--      contratos visibles → dos filas separadas, nunca se fusiona/sobrescribe.
--   4) PAS vs. PASAPORTE: tipo_id compara EXACTO — un pasaporte guardado con
--      un valor y buscado con el otro NO cruza (documenta por qué los 5
--      formularios deben usar el MISMO valor 'PAS'). Cuenta como DOS casos
--      (4a "encuentra lo suyo", 4b "no cruza") — de ahí el total de 7.
--   5) Nunca expone id/responsable_id/es_infante (chequeo de columnas).
--   6) Las 5 funciones del núcleo de la migración 167 (pasajeros + sillas +
--      infantes) siguen EXISTIENDO con ese nombre — esta migración no las
--      reemplazó. ⚠️ Es una verificación de PRESENCIA por nombre
--      (`pg_proc`/`pg_namespace`), NO de comportamiento ni de firma: no
--      detectaría un cambio de argumentos, de cuerpo, ni una regresión en la
--      atomicidad pasajeros↔sillas. La prueba de COMPORTAMIENTO real de ese
--      núcleo es `test_167_concurrencia.sh`/`test_167_atomicidad_fallo.sh`,
--      no este archivo — nunca llamar "intacto" a esta verificación como si
--      cubriera lo mismo.
--
-- LECTURA DEL RESULTADO: un único SELECT final devuelve JSON con
-- `veredicto` + `mensaje` + el detalle de los `casos` registrados. Cualquier
-- caso cuyo `resultado` EMPIECE por 'FALLA' (con o sin sufijo entre
-- paréntesis) hace fallar el veredicto — comparación con `like 'FALLA%'`,
-- nunca igualdad exacta. El veredicto exige EXACTAMENTE 7 filas de caso — ni
-- una corrida parcial (menos de 7, el DO abortó a mitad de camino) ni una
-- duplicada (más de 7) cuentan como 'OK'; cualquier conteo distinto de 7 da
-- 'INCOMPLETO'. Un caso 'OMITIDO' NUNCA cuenta como aprobado, y una corrida
-- que no produjo NINGUNA fila (fallo catastrófico antes del primer INSERT)
-- tampoco — todos esos casos dan 'FALLA'/'INCOMPLETO' explícito, nunca 'OK'
-- por defecto.
-- ─────────────────────────────────────────────────────────────────────────

begin;

create temp table _t187_out (caso text, resultado text, detalle text) on commit drop;

-- ⚠️ Mismo motivo que en test_187_seguridad_rls.sql: varios de los casos de
-- abajo escriben en `_t187_out` TODAVÍA impersonando `authenticated` (antes
-- de `reset role`) — sin este GRANT, esos INSERT fallan con "permission
-- denied for table _t187_out" (la tabla la crea el rol de la sesión, que por
-- defecto es el único con acceso), la excepción se propaga al catch-all de
-- más afuera y el test aborta a mitad de camino. Este archivo no impersona
-- `anon` en ningún punto, así que el GRANT alcanza con `authenticated`.
grant select, insert on _t187_out to authenticated;

do $$
declare
  v_tipo   constant text := 'CC';
  v_doc    constant text := '900187187';

  v_venta_a  record;  -- contrato de un tenant, con asesor conocido
  v_venta_b  record;  -- contrato del OTRO tenant
  v_pid_a bigint; v_pid_b bigint;
  v_super record;
  n int;
  v_n_combos int; v_tiene_null boolean;
begin
  -- ── Preparación: tomar contratos REALES para no inventar FKs (numero_contrato
  -- referencia ventas) — ver test_187_seguridad_rls.sql para la versión
  -- 100% auto-contenida que ni siquiera depende de esto.
  select v.numero_contrato, v.tenant into v_venta_a
    from public.ventas v where v.tenant is not null order by v.numero_contrato limit 1;
  select v.numero_contrato, v.tenant into v_venta_b
    from public.ventas v where v.tenant is not null and v.tenant <> v_venta_a.tenant
    order by v.numero_contrato limit 1;
  select id into v_super from public.usuarios where rol = 'superadmin' and activo limit 1;

  if v_venta_a.numero_contrato is null or v_super.id is null then
    insert into _t187_out values ('setup', 'OMITIDO', 'No hay contratos o superadmin activo en esta base — correr contra una base con datos reales, o confiar en test_187_seguridad_rls.sql para la cobertura crítica.');
  end if;

  if v_venta_a.numero_contrato is not null then
    insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, nacionalidad, orden)
      values (v_venta_a.numero_contrato, 'PRUEBA187 CONTRATO A', v_tipo, v_doc, '1990-01-01', 'Colombiana', 999)
      returning id into v_pid_a;
  end if;
  if v_venta_b.numero_contrato is not null then
    insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, nacionalidad, orden)
      values (v_venta_b.numero_contrato, 'PRUEBA187 CONTRATO B', v_tipo, v_doc, null, null, 999)
      returning id into v_pid_b;
  end if;

  if v_super.id is null then
    insert into _t187_out values ('1/2/3-superadmin', 'OMITIDO', 'No hay superadmin activo — no se pudo probar con datos reales.');
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_super.id, 'role', 'authenticated')::text, true);

    -- 1) Documento inexistente → 0 filas.
    select count(*) into n from public.buscar_pasajero_por_documento('CC', '000000000000-no-existe');
    insert into _t187_out values ('1-documento-inexistente', case when n = 0 then 'OK' else 'FALLA' end, n || ' filas (esperado 0)');

    if v_pid_a is not null and v_pid_b is not null then
      -- 2/3) Datos incompletos + conflicto de datos.
      -- ⚠️ El chequeo exige AMBOS campos null EN LA MISMA fila (fixture del
      -- contrato B: fecha_nacimiento y nacionalidad, los dos null a la vez —
      -- ver el INSERT de v_pid_b más arriba). `bool_or` de cada columna por
      -- separado no bastaría: pasaría igual si, por ejemplo, otra fila
      -- REAL de esta base tuviera nacionalidad null pero fecha_nacimiento sí
      -- puesta (o viceversa), sin que eso pruebe lo que el escenario dice
      -- probar — que UNA fila histórica con AMBOS datos faltantes se
      -- devuelve tal cual, sin inventar ninguno de los dos.
      select count(*), bool_or(fecha_nacimiento is null and nacionalidad is null) into v_n_combos, v_tiene_null
        from public.buscar_pasajero_por_documento(v_tipo, v_doc);
      insert into _t187_out values ('2-datos-incompletos', case when v_tiene_null then 'OK' else 'FALLA' end, 'Debe aparecer una fila con fecha_nacimiento Y nacionalidad null A LA VEZ (fixture del contrato B), sin inventar ninguno de los dos.');
      insert into _t187_out values ('3-conflicto-datos', case when v_n_combos >= 2 then 'OK' else 'FALLA' end, v_n_combos || ' combinaciones distintas (esperado >= 2, nunca fusionadas).');
    else
      insert into _t187_out values ('2/3-datos-incompletos-conflicto', 'OMITIDO', 'Faltan los contratos de prueba A/B (¿solo un tenant en esta base?).');
    end if;

    -- 4) PAS vs. PASAPORTE: match EXACTO, nunca normaliza.
    declare v_pid_pas bigint; v_n_pas int; v_n_pasaporte int;
    begin
      insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion, orden)
        values (v_venta_a.numero_contrato, 'PRUEBA187 PASAPORTE', 'PAS', '900187PAS', 999)
        returning id into v_pid_pas;
      select count(*) into v_n_pas from public.buscar_pasajero_por_documento('PAS', '900187PAS');
      select count(*) into v_n_pasaporte from public.buscar_pasajero_por_documento('PASAPORTE', '900187PAS');
      insert into _t187_out values ('4a-pas-encuentra-lo-suyo', case when v_n_pas = 1 then 'OK' else 'FALLA' end, v_n_pas || ' filas buscando tipo_id=PAS (esperado 1).');
      insert into _t187_out values ('4b-pasaporte-no-cruza-con-pas', case when v_n_pasaporte = 0 then 'OK' else 'FALLA' end, v_n_pasaporte || ' filas buscando tipo_id=PASAPORTE (esperado 0 — match exacto, confirma por qué los 5 formularios deben usar "PAS").');
    end;

    reset role;
    perform set_config('request.jwt.claims', null, true);
  end if;

  -- 5) Nunca expone id/responsable_id/es_infante (chequeo de columnas del RPC).
  select count(*) into n
    from information_schema.parameters
   where specific_schema = 'public'
     and specific_name in (select specific_name from information_schema.routines where routine_name = 'buscar_pasajero_por_documento' and routine_schema = 'public')
     and parameter_name in ('id', 'responsable_id', 'es_infante');
  insert into _t187_out values ('5-no-expone-pk', case when n = 0 then 'OK' else 'FALLA' end, 'La función no debe devolver id/responsable_id/es_infante.');

  -- 6) Las 5 funciones del núcleo de la 167 siguen EXISTIENDO con ese
  -- nombre — chequeo de PRESENCIA por catálogo (pg_proc/pg_namespace), no
  -- de comportamiento ni de firma. No confundir con "sigue intacto": una
  -- firma/cuerpo distinto bajo el mismo nombre pasaría esta prueba igual.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in
     ('_reemplazar_pasajeros_nucleo', '_guardar_pasajeros_nucleo', 'guardar_pasajeros_contrato', 'crear_pasajeros_contrato', 'crear_pasajeros_contrato_multi');
  insert into _t187_out values ('6-nucleo-167-presente', case when n = 5 then 'OK' else 'FALLA' end, n || '/5 funciones del núcleo 167 presentes por nombre (NO verifica comportamiento ni firma).');

exception when others then
  reset role;
  insert into _t187_out values ('EXCEPCION-NO-CAPTURADA', 'FALLA', sqlerrm);
end $$;

-- Un único SELECT final — JSON con `veredicto` + `mensaje` + el detalle de
-- los casos (`casos`) — en vez de dos SELECTs sueltos. 'FALLA'/'INCOMPLETO'
-- explícitos ante 0 filas, cualquier FALLA, un conteo de casos distinto a 7
-- (una corrida completa SIEMPRE deja exactamente 7 — ver la cabecera del
-- archivo), o cualquier OMITIDO — nunca 'OK' por defecto ante un test que no
-- corrió o corrió a medias. Mismo orden de gravedad que
-- test_187_seguridad_rls.sql: sin filas → conteo distinto de 7 → OMITIDO.
select jsonb_build_object(
  'veredicto',
    case
      when not exists (select 1 from _t187_out) then 'FALLA'
      when exists (select 1 from _t187_out where resultado like 'FALLA%') then 'FALLA'
      when (select count(*) from _t187_out) <> 7 then 'INCOMPLETO'
      when exists (select 1 from _t187_out where resultado = 'OMITIDO') then 'INCOMPLETO'
      else 'OK'
    end,
  'mensaje',
    case
      when not exists (select 1 from _t187_out)
        then 'El test no produjo NINGÚN resultado (posible error catastrófico antes del primer INSERT); esto NUNCA es una aprobación.'
      when exists (select 1 from _t187_out where resultado like 'FALLA%')
        then 'Revisar los casos con resultado FALLA en "casos".'
      when (select count(*) from _t187_out) <> 7
        then 'Se esperaban exactamente 7 casos (ver la cabecera del archivo) y se registraron ' || (select count(*)::text from _t187_out) || '; una corrida parcial u OMITIDA nunca cuenta como aprobación completa.'
      when exists (select 1 from _t187_out where resultado = 'OMITIDO')
        then 'Hay casos OMITIDOS (ver "casos"); esto NO es una aprobación. Correr también test_187_seguridad_rls.sql.'
      else 'Los 7 casos pasaron contra datos reales de esta base.'
    end,
  'casos', coalesce((select jsonb_agg(jsonb_build_object('caso', caso, 'resultado', resultado, 'detalle', detalle) order by caso) from _t187_out), '[]'::jsonb)
) as resultado_test_187_busqueda;

-- Nada de esto se conserva: los pasajeros temporales y cualquier cambio de
-- rol/config de sesión desaparecen aquí.
rollback;
