-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 212 · alojamiento previsto por ciudad + reemplazo atómico de la ruta.
-- SOLO LECTURA (transacción read only, termina en ROLLBACK). Correr ANTES de aplicar la 212.
-- Una fila por verificación: codigo | nivel | cantidad | detalle.
-- Niveles: BLOQUEANTE (no aplicar hasta resolver) · REVISAR · INFO.
-- La 212 NO depende de la 211 (cotizaciones comparativas): ninguna verificación la exige.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
col as (
  select data_type from information_schema.columns
   where table_schema = 'public' and table_name = 'programa_ciudades' and column_name = 'alojamiento_previsto'
),
largos as (
  -- to_jsonb permite leer la columna aunque todavía no exista (212 sin aplicar).
  select count(*) n from public.programa_ciudades pc
   where char_length(coalesce(to_jsonb(pc)->>'alojamiento_previsto', '')) > 200
),
chequeos as (
  select 'P1' as codigo,
         case when to_regclass('public.programas') is null or to_regclass('public.programa_ciudades') is null
                or to_regprocedure('public.mi_rol()') is null then 'BLOQUEANTE' else 'INFO' end as nivel,
         (to_regclass('public.programas') is not null)::int + (to_regclass('public.programa_ciudades') is not null)::int
           + (to_regprocedure('public.mi_rol()') is not null)::int as cantidad,
         'Tablas programas / programa_ciudades (migración 031) y mi_rol() presentes (esperado: 3)' as detalle
  union all
  select 'P2',
         case when exists (select 1 from col where data_type <> 'text') then 'BLOQUEANTE'
              when exists (select 1 from col) then 'REVISAR' else 'INFO' end,
         (select count(*)::int from col),
         case when exists (select 1 from col where data_type <> 'text')
              then 'La columna alojamiento_previsto YA existe con un tipo distinto de text: no aplicar'
              when exists (select 1 from col) then 'La columna ya existe (212 aplicada o parcial): la migración es idempotente y no la duplica'
              else '212 aún no aplicada (la columna no existe)' end
  union all
  select 'P3',
         case when (select n from largos) > 0 then 'BLOQUEANTE' else 'INFO' end,
         (select n from largos)::int,
         'Filas con alojamiento_previsto de más de 200 caracteres (el CHECK de la 212 no se podría crear): ' || (select n from largos)
  union all
  select 'P4',
         case when n > 0 then 'REVISAR' else 'INFO' end,
         n,
         'Funciones clave_ciudad_ruta / reemplazar_ruta_programa ya presentes (CREATE OR REPLACE las reemplaza; revisar que sean de la 212)'
    from (select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname in ('clave_ciudad_ruta', 'reemplazar_ruta_programa')) x
  union all
  select 'P5', 'INFO', (select count(*)::int from public.programas),
         'Programas: ' || (select count(*) from public.programas) || ' · con ruta: '
         || (select count(distinct programa_id) from public.programa_ciudades) || ' · ciudades en total: '
         || (select count(*) from public.programa_ciudades)
  union all
  select 'P6',
         case when not coalesce((select relrowsecurity from pg_class where oid = 'public.programa_ciudades'::regclass), false)
                or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'programa_ciudades' and cmd in ('ALL', 'DELETE'))
              then 'REVISAR' else 'INFO' end,
         (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'programa_ciudades'),
         'RLS activa y política de escritura en programa_ciudades (la RPC es SECURITY INVOKER: manda esa política; si falta, ningún rol podrá reemplazar la ruta)'
  union all
  select 'P7', 'INFO', 0,
         'La 211 (cotizaciones comparativas) NO es requerida ni tocada por la 212; pueden aplicarse en cualquier orden'
  union all
  select 'P8', 'INFO', 1,
         'Despliegue: aplicar la 212 ANTES del código nuevo (el código llama a la RPC y lee la columna). El código viejo sigue funcionando con la 212 aplicada.'
)
select codigo, nivel, cantidad, left(detalle, 700) as detalle from chequeos order by length(codigo), codigo;

select case when to_regclass('public.programa_ciudades') is null or to_regprocedure('public.mi_rol()') is null
              or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programa_ciudades'
                           and column_name = 'alojamiento_previsto' and data_type <> 'text')
              or exists (select 1 from public.programa_ciudades pc where char_length(coalesce(to_jsonb(pc)->>'alojamiento_previsto', '')) > 200)
            then 'PREFLIGHT: hay BLOQUEANTES (P1/P2/P3); no aplicar.'
            else 'PREFLIGHT: sin bloqueantes; revisa P2/P4/P6.' end as veredicto;

rollback;
