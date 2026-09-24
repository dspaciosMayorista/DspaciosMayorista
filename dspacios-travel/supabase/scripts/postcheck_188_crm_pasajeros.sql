-- ─────────────────────────────────────────────────────────────────────────
-- POSTCHECK 188 (crm_pasajeros_contrato_lectura) — SOLO LECTURA
-- ─────────────────────────────────────────────────────────────────────────

create temp table if not exists pg_temp.postcheck_188_crm_reporte (
  seccion text, nombre text, estado text, detalle text
);
truncate pg_temp.postcheck_188_crm_reporte;

insert into pg_temp.postcheck_188_crm_reporte
select '188crm-existencia', 'crm_pasajeros_contrato_buscar',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'crm_pasajeros_contrato_buscar'
  ) then 'OK' else 'FALLA' end,
  'Función debe existir.';

insert into pg_temp.postcheck_188_crm_reporte
select '188crm-forma-retorno', 'incluye numero_contrato/tenant/nombre/total_filas',
  case when (
    select count(*) from information_schema.parameters
     where specific_schema = 'public'
       and specific_name in (select specific_name from information_schema.routines where routine_name = 'crm_pasajeros_contrato_buscar' and routine_schema = 'public')
       and parameter_name in ('numero_contrato', 'tenant', 'nombre', 'total_filas')
  ) = 4 then 'OK' else 'FALLA' end,
  'La función debe devolver estas 4 columnas (agencia/contrato de origen + paginación).';

insert into pg_temp.postcheck_188_crm_reporte
select '188crm-forma-retorno', 'NO expone responsable_id/es_infante',
  case when (
    select count(*) from information_schema.parameters
     where specific_schema = 'public'
       and specific_name in (select specific_name from information_schema.routines where routine_name = 'crm_pasajeros_contrato_buscar' and routine_schema = 'public')
       and parameter_name in ('responsable_id', 'es_infante')
  ) = 0 then 'OK' else 'FALLA' end,
  'Atributos del contrato de origen, no de la persona — nunca deben salir.';

insert into pg_temp.postcheck_188_crm_reporte
select '188crm-grants', 'revoke de anon',
  case when has_function_privilege('anon', 'public.crm_pasajeros_contrato_buscar(text, integer, integer)', 'execute')
    then 'FALLA' else 'OK' end,
  'anon NO debe poder ejecutar la búsqueda.';

insert into pg_temp.postcheck_188_crm_reporte
select '188crm-grants', 'grant a authenticated',
  case when has_function_privilege('authenticated', 'public.crm_pasajeros_contrato_buscar(text, integer, integer)', 'execute')
    then 'OK' else 'FALLA' end,
  'authenticated SÍ debe poder ejecutar — el candado real es el rol interno dentro de la función.';

insert into pg_temp.postcheck_188_crm_reporte
select '188crm-no-escribe', 'sin GRANT de insert/update/delete a nadie',
  case when not exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'crm_pasajeros_contrato_buscar'
       and privilege_type not in ('EXECUTE')
  ) then 'OK' else 'FALLA' end,
  'Es una función de lectura — nunca debería tener privilegios más allá de EXECUTE.';

-- Nunca escribe crm_contactos ni marca acepta_publicidad — chequeo estructural:
-- la definición de la función no debe mencionar la tabla en absoluto.
insert into pg_temp.postcheck_188_crm_reporte
select '188crm-no-toca-crm-contactos', 'crm_contactos ausente del cuerpo',
  case when pg_get_functiondef('public.crm_pasajeros_contrato_buscar(text, integer, integer)'::regprocedure) not ilike '%crm_contactos%'
    then 'OK' else 'FALLA' end,
  'La función NUNCA debe leer ni escribir crm_contactos — son bases separadas a propósito.';

select * from pg_temp.postcheck_188_crm_reporte order by seccion, nombre;

select
  case when exists (select 1 from pg_temp.postcheck_188_crm_reporte where estado like 'FALLA%')
    then '❌ FALLA — revisar filas FALLA arriba.'
    else '✅ OK — postcheck pasó (falta correr test_188_crm_pasajeros.sql para aislamiento por rol/tenant).'
  end as resultado_postcheck_188_crm;
