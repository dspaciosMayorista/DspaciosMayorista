-- ───────────────────────────────────────────────────────────────────────────
-- PLANTILLA 213 · destino PROVISIONAL «Por clasificar» para el despliegue.
--
-- Qué hace: crea (si no existe) el destino provisional —identificado por su marca
-- `es_provisional = true`, NUNCA por su nombre— y le asigna EXACTAMENTE los programas cuyos ids se
-- le entreguen. La lista debe ser el INVENTARIO COMPLETO de programas con destino_fijo_id = NULL (fila N1V
-- del preflight: publicados, borradores e inactivos), no solo H1: así ningún programa existente queda sin
-- destino y los publicados siguen visibles en el tarifario público cuando se despliegue el código.
-- Después los destinos reales se crean y se reasignan desde la app (Producto > Destinos > Listas
-- fijas, y General > «Destino del programa»). Esta plantilla NO clasifica nada:
--   · NO lee la Ruta ni los nombres para deducir destinos;
--   · NO asigna programas que no estén en la lista que le das;
--   · RECHAZA (aborta todo, sin dejar nada) ids duplicados, ids que no existen, ids que ya tienen un
--     destino real (contradicción) y un destino real que ya se llame «Por clasificar»;
--   · RECHAZA el resultado si quedaría algún programa PUBLICADO y ACTIVO sin destino (verificación H1 de
--     visibilidad pública) o CUALQUIER otro programa sin destino, borradores e inactivos incluidos
--     (verificación de inventario).
--
-- Cómo se usa (SOLO por el usuario, en el SQL editor, DESPUÉS de aplicar la 213 y ANTES de
-- desplegar el código):
--   1. Corre el preflight y copia la fila N1V (TODOS los ids sin destino, ya en formato de valores; el
--      detalle uno por uno está en las filas N1L).
--   2. Pégalos en el INSERT de abajo (quita el `--`). La lista debe ser COMPLETA: si falta cualquier
--      programa sin destino, el script aborta y el mensaje de error dice cuáles faltan.
--   3. Ejecuta tal cual: termina en ROLLBACK y muestra la VISTA PREVIA (una sola tabla: provisional,
--      programas que quedarán en él, programas que seguirán sin destino y la VERIFICACIÓN).
--      No persiste nada.
--   4. Si todo es correcto, cambia la última línea `rollback;` por `commit;` y ejecuta de nuevo.
--      La plantilla es idempotente: repetirla no duplica el provisional ni cambia lo ya asignado.
--   5. Corre el postcheck y el preflight (H1 y N1 deben quedar en 0) y recién entonces despliega el código.
-- ───────────────────────────────────────────────────────────────────────────
begin;

-- Candado corto: nadie crea ni asigna destinos mientras se valida y se escribe (sin carreras).
lock table public.programa_destinos_fijos, public.programas in share row exclusive mode;

create temp table _ids (programa_id bigint) on commit drop;

-- ▼▼▼ COMPLETAR (ejemplo comentado; quita el `--` y pega los ids de N1V) ▼▼▼
-- insert into _ids (programa_id) values (12), (15), (21);
-- ▲▲▲ FIN DE LO QUE SE COMPLETA ▲▲▲

-- 0) Validaciones: cualquier error aborta TODO el script (nada queda aplicado).
do $$
declare
  v text;
begin
  if to_regclass('public.programa_destinos_fijos') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'programa_destinos_fijos' and column_name = 'es_provisional')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'programas' and column_name = 'destino_fijo_id') then
    raise exception 'PLANTILLA 213 ABORTADA: la migración 213 no está aplicada (faltan la tabla de destinos, es_provisional o programas.destino_fijo_id).';
  end if;

  if exists (select 1 from _ids where programa_id is null) then
    raise exception 'PLANTILLA 213 ABORTADA: la lista trae un id vacío (NULL).';
  end if;

  select string_agg(programa_id::text, ', ' order by programa_id) into v
    from (select programa_id from _ids group by programa_id having count(*) > 1) d;
  if v is not null then
    raise exception 'PLANTILLA 213 ABORTADA: ids DUPLICADOS en la lista: %. Deja cada programa una sola vez.', v;
  end if;

  select string_agg(i.programa_id::text, ', ' order by i.programa_id) into v
    from _ids i
   where not exists (select 1 from public.programas p where p.id = i.programa_id);
  if v is not null then
    raise exception 'PLANTILLA 213 ABORTADA: estos ids NO existen en programas: %.', v;
  end if;

  select string_agg(p.id || ' (ya tiene el destino real «' || d.nombre || '»)', ', ' order by p.id) into v
    from _ids i
    join public.programas p on p.id = i.programa_id
    join public.programa_destinos_fijos d on d.id = p.destino_fijo_id
   where not d.es_provisional;
  if v is not null then
    raise exception 'PLANTILLA 213 ABORTADA: ids CONTRADICTORIOS —ya tienen un destino real y esta plantilla no lo pisa—: %. Quítalos de la lista.', v;
  end if;

  if exists (select 1 from public.programa_destinos_fijos
              where not es_provisional and public.clave_ciudad_ruta(nombre) = public.clave_ciudad_ruta('Por clasificar')) then
    raise exception 'PLANTILLA 213 ABORTADA: ya existe un destino REAL llamado «Por clasificar» que no es el provisional. Renómbralo antes de crear el provisional.';
  end if;
end $$;

-- 1) Destino provisional (a lo sumo uno: lo garantiza el índice único parcial). Idempotente.
insert into public.programa_destinos_fijos (nombre, es_provisional)
select 'Por clasificar', true
 where not exists (select 1 from public.programa_destinos_fijos where es_provisional);

-- 2) Asignación: SOLO los ids de la lista y solo los que aún no tienen destino.
update public.programas p
   set destino_fijo_id = (select d.id from public.programa_destinos_fijos d where d.es_provisional)
 where p.id in (select programa_id from _ids)
   and p.destino_fijo_id is null;

-- 3) VERIFICACIÓN: ningún programa PUBLICADO y ACTIVO puede quedar sin destino (se ocultaría del tarifario).
--    Si falla, el script aborta con la lista de los que faltan y no persiste nada (ni siquiera con commit).
do $$
declare
  v text;
  n int;
begin
  select count(*), string_agg(id || ' ' || nombre, ' · ' order by id) into n, v
    from public.programas
   where publicado and activo and destino_fijo_id is null;
  if n > 0 then
    raise exception 'VERIFICACIÓN FALLIDA: quedarían % programa(s) publicados y activos SIN destino (se ocultarían del tarifario): %. Agrégalos a la lista.', n, v;
  end if;

  -- Inventario: ningún programa existente (borradores e inactivos incluidos) puede quedar sin destino.
  select count(*), string_agg(id || ' [' || case when activo then 'borrador' else 'inactivo' end || '] ' || nombre, ' · ' order by id)
    into n, v
    from public.programas
   where destino_fijo_id is null;
  if n > 0 then
    raise exception 'VERIFICACIÓN DE INVENTARIO FALLIDA: quedarían % programa(s) SIN destino (borradores o inactivos): %. Pega la fila N1V completa del preflight.', n, v;
  end if;
end $$;

-- ═══ VISTA PREVIA / VERIFICACIÓN (una sola tabla) ═══
select seccion, id, nombre, detalle
  from (
    select 1 as orden, 'DESTINO PROVISIONAL' as seccion, d.id, d.nombre::text as nombre,
           ('es_provisional = true · programas en él ahora: ' || (select count(*) from public.programas where destino_fijo_id = d.id))::text as detalle
      from public.programa_destinos_fijos d where d.es_provisional
    union all
    select 2, 'EN «POR CLASIFICAR» (de tu lista)', p.id, p.nombre::text,
           case when p.publicado and p.activo then 'publicado y activo: seguirá visible'
                when p.activo then 'borrador: no es público; queda con destino provisional'
                else 'inactivo: no es público; queda con destino provisional' end
      from public.programas p where p.id in (select programa_id from _ids)
    union all
    select 3, 'VERIFICACIÓN H1 (visibilidad pública)', null::bigint, null::text,
           'publicados y activos SIN destino = ' || (select count(*) from public.programas where publicado and activo and destino_fijo_id is null)
           || ' (debe ser 0; si no, el script ya habría abortado)'
    union all
    select 4, 'VERIFICACIÓN DE INVENTARIO', null::bigint, null::text,
           'programas SIN destino (cualquier estado) = ' || (select count(*) from public.programas where destino_fijo_id is null)
           || ' · borradores en «Por clasificar»: ' || (select count(*) from public.programas p join public.programa_destinos_fijos d on d.id = p.destino_fijo_id where d.es_provisional and p.activo and not p.publicado)
           || ' · inactivos en «Por clasificar»: ' || (select count(*) from public.programas p join public.programa_destinos_fijos d on d.id = p.destino_fijo_id where d.es_provisional and not p.activo)
           || ' (debe ser 0 sin destino; si no, el script ya habría abortado)'
  ) x
 order by orden, id;

-- ▼ Cambia `rollback;` por `commit;` SOLO después de revisar la vista previa. ▼
rollback;
