-- Hotfix mínimo para 20260601000180_tarifario_resultado_procedencia.sql —
-- SOLO si la migración 180 ya se aplicó en el entorno remoto CON el defecto
-- (comparaciones `<>` en vez de `IS DISTINCT FROM`) ANTES de que se corrigiera
-- en el repo. NO ejecutado por esta sesión — entregado como bloque de
-- referencia, listo para correr a mano cuando corresponda.
--
-- Por qué es seguro correrlo solo (sin las columnas/CHECK/`add column`/`do $$
-- ... add constraint` del resto de la migración 180): las columnas y los 4
-- CHECK ya existen (la migración 180 ya corrió); `create or replace function`
-- reemplaza el CUERPO de la función EN EL MISMO OID — el CHECK
-- `tarifario_resultado_procedencia_elementos_validos_check`, que solo
-- referencia la función por NOMBRE, empieza a usar la lógica corregida de
-- inmediato, sin necesidad de `drop`/`add constraint` (que además
-- re-validaría TODAS las filas existentes de la tabla — innecesario, más
-- lento, y evitado a propósito).
--
-- Por qué es seguro correrlo YA, sin coordinar con el código desplegado: el
-- defecto solo afecta la VALIDACIÓN (más estricta después del fix, nunca más
-- laxa) — ninguna fila que hoy es válida deja de serlo; el único cambio es
-- que un arreglo con un elemento MALFORMADO (clave ausente o en JSON null)
-- que antes se colaba en un arreglo MIXTO ahora se rechaza. Como en este
-- momento (según el enunciado de esta ronda) TODAVÍA no hay ninguna fila con
-- procedencia poblada en `tarifario_resultado` (el código que la escribe no
-- se ha desplegado), este hotfix no puede romper ningún dato existente — se
-- corre ANTES de desplegar el código, igual que el resto de la migración 180.
--
-- Defecto corregido (detalle completo en la cabecera de la migración 180 y
-- junto a la función en el archivo de la migración): `jsonb_typeof(elem->
-- 'campo') <> 'tipo'` es NULL (no `true`) cuando la clave `campo` está
-- ausente — una condición NULL no selecciona la fila en el `where` de `not
-- exists`, así que un elemento con una clave FALTANTE se colaba como
-- "válido" dentro de un arreglo MIXTO. `IS DISTINCT FROM` nunca produce
-- NULL: con clave ausente, rechaza igual que con el tipo explícitamente
-- equivocado.
--
-- Verificado en PostgreSQL 16 (Docker desechable, nunca contra Supabase):
-- 1) se simuló la versión ANTERIOR (con `<>`) ya aplicada — un arreglo mixto
--    con un elemento sin `temporada` se aceptó (bug reproducido);
-- 2) se aplicó ESTE bloque encima — mismos OID de función y de los 4 CHECK
--    (ninguno se recreó), y el mismo arreglo mixto pasó a rechazarse;
-- 3) se re-aplicó dos veces sin error (create or replace es idempotente).
--
-- Uso: pegar y ejecutar en el editor SQL de Supabase (o `psql` contra el
-- proyecto remoto) del entorno donde la migración 180 ya corrió. No requiere
-- `begin`/`commit` explícito (una sola sentencia DDL), pero se envuelve en
-- una transacción por higiene y para poder abortar si el estado remoto no es
-- el esperado.

begin;

do $$
begin
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = '_procedencia_temporadas_elementos_validos'
  ) then
    raise exception 'HOTFIX ABORTADO: no existe public._procedencia_temporadas_elementos_validos — la migración 180 no está aplicada en este entorno. Aplicar la migración 180 completa, no este hotfix.';
  end if;
end $$;

create or replace function public._procedencia_temporadas_elementos_validos(p jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when p is null then true
    when jsonb_typeof(p) <> 'array' then false
    else not exists (
      select 1
      from jsonb_array_elements(p) as elem
      where jsonb_typeof(elem) is distinct from 'object'
         or jsonb_typeof(elem->'temporada') is distinct from 'string'
         or btrim(coalesce(elem->>'temporada', '')) = ''
         or jsonb_typeof(elem->'es_promocion') is distinct from 'boolean'
         or jsonb_typeof(elem->'precio_final_autoritativo') is distinct from 'boolean'
    )
  end;
$$;

commit;

-- Verificación de humo (solo lectura, no modifica nada): confirma que un
-- arreglo mixto con un elemento sin `temporada` ahora se rechaza.
begin;
do $$
begin
  begin
    perform 1 where public._procedencia_temporadas_elementos_validos(
      '[{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false},{"es_promocion":true,"precio_final_autoritativo":false}]'::jsonb
    );
    if public._procedencia_temporadas_elementos_validos(
      '[{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false},{"es_promocion":true,"precio_final_autoritativo":false}]'::jsonb
    ) then
      raise exception 'HOTFIX NO APLICADO CORRECTAMENTE: un elemento sin `temporada` sigue considerándose válido.';
    end if;
  end;
  raise notice 'OK: hotfix aplicado — un elemento sin `temporada` en un arreglo mixto ahora se rechaza (la función devuelve false).';
end $$;
rollback;
