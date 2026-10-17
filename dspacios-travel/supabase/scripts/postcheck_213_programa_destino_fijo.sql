-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 213 · SOLO LECTURA (read only + ROLLBACK). Correr DESPUÉS de aplicar la 213.
-- Una fila por verificación: codigo | ok | detalle. Todas deben dar ok = true.
-- No escribe. C11/C12 son informativas (ok siempre true): muestran qué quedó ya asignado.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

select * from (
  select 'C1' as codigo,
         to_regclass('public.programa_destinos_fijos') is not null as ok,
         'Tabla programa_destinos_fijos existe' as detalle
  union all
  select 'C2',
         exists (select 1 from information_schema.columns where table_schema='public' and table_name='programas'
                   and column_name='destino_fijo_id' and data_type='bigint' and is_nullable='YES'),
         'programas.destino_fijo_id bigint NULL'
  union all
  select 'C3',
         exists (select 1 from pg_constraint where conrelid='public.programas'::regclass and conname='programas_destino_fijo_fk'
                   and contype='f' and confdeltype='r' and convalidated),
         'FK programas.destino_fijo_id → programa_destinos_fijos con ON DELETE RESTRICT (validada)'
  union all
  select 'C4',
         exists (select 1 from pg_indexes where schemaname='public' and tablename='programa_destinos_fijos'
                   and indexname='programa_destinos_fijos_clave_uk' and indexdef ilike '%UNIQUE%clave_ciudad_ruta%'),
         'Índice único sobre clave_ciudad_ruta(nombre) (sin duplicados por mayúsculas/tildes/espacios)'
  union all
  select 'C5',
         exists (select 1 from pg_constraint where conrelid = to_regclass('public.programa_destinos_fijos') and conname='programa_destinos_fijos_nombre_ck'),
         'CHECK de nombre (recortado, 1–80 caracteres)'
  union all
  select 'C6',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.programa_destinos_fijos')), false)
         and exists (select 1 from pg_policies where schemaname='public' and tablename='programa_destinos_fijos' and cmd='SELECT')
         and exists (select 1 from pg_policies where schemaname='public' and tablename='programa_destinos_fijos' and cmd='ALL'),
         'RLS activa con lectura pública y escritura interna'
  union all
  select 'C7',
         to_regclass('public.programa_destinos_fijos') is not null
         and has_table_privilege('anon','public.programa_destinos_fijos','select')
         and not has_table_privilege('anon','public.programa_destinos_fijos','insert')
         and not has_table_privilege('anon','public.programa_destinos_fijos','update')
         and not has_table_privilege('anon','public.programa_destinos_fijos','delete'),
         'anon solo lee la lista (sin insert/update/delete)'
  union all
  select 'C8',
         to_regclass('public.programa_destinos_fijos') is not null
         and has_table_privilege('authenticated','public.programa_destinos_fijos','select,insert,update,delete'),
         'authenticated puede leer y escribir (la RLS decide el rol)'
  union all
  select 'C9',
         exists (select 1 from pg_policies where schemaname='public' and tablename='programa_destinos_fijos' and cmd='ALL'
                   and qual ilike '%superadmin%' and qual ilike '%operaciones%' and qual not ilike '%venta%' and qual not ilike '%agencia%'),
         'Escritura limitada a superadmin/gerencia/administracion/operaciones'
  union all
  select 'C10',
         exists (select 1 from pg_trigger where tgrelid = to_regclass('public.programa_destinos_fijos') and tgname = 'trg_auditoria' and not tgisinternal),
         'Auditoría genérica (trg_auditoria) en la tabla nueva'
  union all
  select 'C13',
         exists (select 1 from information_schema.columns where table_schema='public' and table_name='programa_destinos_fijos'
                   and column_name='es_provisional' and data_type='boolean' and is_nullable='NO' and column_default='false'),
         'programa_destinos_fijos.es_provisional boolean NOT NULL default false (identifica el destino provisional por marca, no por nombre)'
  union all
  select 'C14',
         exists (select 1 from pg_indexes where schemaname='public' and tablename='programa_destinos_fijos'
                   and indexname='programa_destinos_fijos_provisional_uk' and indexdef ilike '%UNIQUE%es_provisional%WHERE%es_provisional%'),
         'Índice único parcial: a lo sumo UN destino provisional'
  union all
  select 'C11', true,
         'Destinos en la lista: ' || case when to_regclass('public.programa_destinos_fijos') is null then 'n/a (tabla ausente)'
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.programa_destinos_fijos', false, true, '')))[1]::text end
  union all
  select 'C12', true,
         'Programas ya con destino asignado: ' || coalesce((select count(*)::text from public.programas where to_jsonb(programas)->>'destino_fijo_id' is not null), 'n/a')
         || ' · activos SIN destino (los que verá el aviso): '
         || coalesce((select count(*)::text from public.programas where activo and to_jsonb(programas)->>'destino_fijo_id' is null), 'n/a')
         || ' (inmediatamente tras aplicar se espera 0 asignados: la 213 no asigna nada)'
) c order by length(codigo), codigo;

rollback;
