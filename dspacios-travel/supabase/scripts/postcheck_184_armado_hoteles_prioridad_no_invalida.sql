-- Postcheck 184. Corre DESPUÉS de aplicar la migración 184.
--
-- ⚠️ Devuelve UNA SOLA fila JSON como último (y único) resultado: el editor SQL
-- de Supabase muestra principalmente el ÚLTIMO result set. Las comprobaciones de
-- catálogo y el resultado del bloque mutante van consolidados ahí.
--
-- El bloque mutante (§6) corre sobre datos REALES y NO asume nada del estado
-- previo: primero captura revisión/estado/publicable, después pone en NULL las
-- prioridades de TODAS las filas del paquete (demostrando que esa limpieza, por
-- ser solo `prioridad`, tampoco invalida), y recién entonces prueba NULL→1. Todo
-- dentro de BEGIN/ROLLBACK: ninguna fila real queda modificada.
--
-- Cómo se comprueba el flujo (sin tablas temporales, que un ROLLBACK se llevaría):
--   · "el bloque mutante llegó al final" ⇒ si alguna aserción hubiera fallado, el
--     DO habría lanzado excepción y NUNCA se vería este JSON (el script aborta en
--     el primer fallo). Los NOTICE de cada caso quedan en el log.
--   · "el ROLLBACK no dejó nada" ⇒ el bloque marca su cambio "real" con un valor
--     centinela (`POSTCHECK184_PROBE` en `categorias`) y este JSON comprueba que
--     ese centinela NO existe en ningún lado. Es una verificación de DATOS, no una
--     afirmación.

-- ── §6: bloque mutante (notices + aborta al primer fallo) ────────────────────
begin;

do $$
declare
  v_paquete_id bigint;
  v_hoteles    bigint[];
  v_hotel_a    bigint;
  v_rev        bigint;
  v_rev_antes  bigint;
  v_estado     text;
  v_publicable boolean;
begin
  -- Se elige un paquete con AL MENOS 2 hoteles (para poder probar con una fila
  -- mientras la otra conserva su prioridad). Da igual si hoy tiene prioridades:
  -- el caso 6a las limpia.
  select paquete_id into v_paquete_id
  from public.armado_hoteles group by paquete_id having count(*) >= 2
  order by paquete_id limit 1;

  if v_paquete_id is null then
    raise notice 'AVISO: no hay ningún paquete con 2+ hoteles asociados en armado_hoteles — el bloque mutante de la 184 NO se pudo ejecutar de verdad. Vuelve a correr este postcheck sobre un entorno con datos reales.';
    return;
  end if;

  select array_agg(hotel_id order by hotel_id) into v_hoteles
    from public.armado_hoteles where paquete_id = v_paquete_id;
  v_hotel_a := v_hoteles[1];

  -- Estado "listo y publicable" de partida (esas columnas no las vigila ningún
  -- trigger de invalidación, así que normalizarlas no ensucia la medición).
  update public.armado_paquetes
    set tarifario_estado = 'listo', tarifario_snapshot_publicable = true
    where id = v_paquete_id;
  select tarifario_revision_fuente into v_rev_antes from public.armado_paquetes where id = v_paquete_id;
  raise notice 'Paquete probado: % (hoteles=%, revisión inicial=%)', v_paquete_id, v_hoteles, v_rev_antes;

  -- 6a) La limpieza previa: TODAS las prioridades del paquete -> NULL. Es un
  --     cambio de SOLO `prioridad`, así que no puede invalidar.
  update public.armado_hoteles set prioridad = null where paquete_id = v_paquete_id;
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev, v_estado, v_publicable from public.armado_paquetes where id = v_paquete_id;
  if v_rev <> v_rev_antes or v_estado <> 'listo' or v_publicable is not true then
    raise exception 'FALLO POSTCHECK 184 (6a): limpiar las prioridades del paquete invalidó (revisión % -> %, estado=%, publicable=%).', v_rev_antes, v_rev, v_estado, v_publicable;
  end if;
  raise notice 'OK 6a: limpiar TODAS las prioridades (solo prioridad) no invalidó — revisión sigue %.', v_rev;

  -- 6b) NULL -> 1 (la fila elegida ahora está garantizado en NULL, sin importar
  --     lo que tuviera antes) NO debe invalidar.
  update public.armado_hoteles set prioridad = 1 where paquete_id = v_paquete_id and hotel_id = v_hotel_a;
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev, v_estado, v_publicable from public.armado_paquetes where id = v_paquete_id;
  if v_rev <> v_rev_antes or v_estado <> 'listo' or v_publicable is not true then
    raise exception 'FALLO POSTCHECK 184 (6b): prioridad NULL -> 1 invalidó (revisión % -> %, estado=%, publicable=%).', v_rev_antes, v_rev, v_estado, v_publicable;
  end if;
  raise notice 'OK 6b: prioridad NULL -> 1 no invalidó (revisión sigue %, estado=%, publicable=%).', v_rev, v_estado, v_publicable;

  -- 6c) Un cambio REAL (categorias) SÍ debe invalidar: revisión +1 y bloqueo.
  --     El valor centinela es lo que este script comprueba después del ROLLBACK.
  update public.armado_hoteles set categorias = array['POSTCHECK184_PROBE']
    where paquete_id = v_paquete_id and hotel_id = v_hotel_a;
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev, v_estado, v_publicable from public.armado_paquetes where id = v_paquete_id;
  if v_rev <> v_rev_antes + 1 or v_estado <> 'pendiente' or v_publicable is not false then
    raise exception 'FALLO POSTCHECK 184 (6c): categorias debía invalidar (revisión % -> %, estado=%, publicable=%).', v_rev_antes, v_rev, v_estado, v_publicable;
  end if;
  raise notice 'OK 6c: un cambio real (categorias) invalidó (revisión % -> %, pendiente, publicable=false).', v_rev_antes, v_rev;

  -- 6d) Con el paquete YA bloqueado, cambiar prioridad no lo rehabilita ni
  --     vuelve a mover la revisión.
  select tarifario_revision_fuente into v_rev_antes from public.armado_paquetes where id = v_paquete_id;
  update public.armado_hoteles set prioridad = 2 where paquete_id = v_paquete_id and hotel_id = v_hoteles[2];
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev, v_estado, v_publicable from public.armado_paquetes where id = v_paquete_id;
  if v_publicable is not false or v_estado <> 'pendiente' or v_rev <> v_rev_antes then
    raise exception 'FALLO POSTCHECK 184 (6d): cambiar prioridad con el paquete bloqueado lo alteró (revisión % -> %, estado=%, publicable=%).', v_rev_antes, v_rev, v_estado, v_publicable;
  end if;
  raise notice 'OK 6d: con el paquete ya bloqueado, cambiar prioridad no lo rehabilita ni mueve la revisión (%).', v_rev;

  raise notice 'POSTCHECK 184 (mutante): todos los casos pasaron. El ROLLBACK deshace las modificaciones.';
end $$;

rollback;

-- ── Resultado consolidado (única salida) ─────────────────────────────────────
with
  trg as (
    select t.tgname, p.proname as funcion, t.tgenabled, pg_get_triggerdef(t.oid) as definicion
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.armado_hoteles'::regclass and not t.tgisinternal
      and t.tgname = 'tarifario_trg_armado_hoteles'
  ),
  f184 as (
    select p.prosecdef, pg_get_functiondef(p.oid) as definicion
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tarifario_trg_bump_armado_hoteles'
  ),
  generica as (
    select pg_get_functiondef(p.oid) as definicion
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tarifario_trg_bump_armado_directo'
  ),
  otras as (
    select c.relname as tabla, p.proname as funcion
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and t.tgname like 'tarifario_trg_armado_%'
      and c.relname in ('armado_vuelos', 'armado_servicios', 'armado_empaquetados')
  ),
  permisos as (
    select p.proname,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_puede,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_puede
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('tarifario_trg_bump_armado_hoteles', 'tarifario_trg_bump_armado_directo')
  ),
  residuo as (
    -- El centinela que el bloque mutante escribió (§6c) NO puede sobrevivir al
    -- ROLLBACK: si aparece, algo quedó persistido.
    select count(*) as filas_centinela from public.armado_hoteles
    where categorias is not null and categorias @> array['POSTCHECK184_PROBE']
  ),
  elegible as (
    select count(*) as paquetes_con_2_mas
    from (select paquete_id from public.armado_hoteles group by paquete_id having count(*) >= 2) x
  )
select jsonb_pretty(jsonb_build_object(
  'script', 'postcheck_184_armado_hoteles_prioridad_no_invalida',
  'ok', (
    (select count(*) from trg) = 1
    and (select funcion from trg) = 'tarifario_trg_bump_armado_hoteles'
    and (select prosecdef from f184) is true
    and (select definicion from f184) like '%search_path%public%pg_temp%'
    and (select definicion from f184) like '%to_jsonb(NEW) - ''prioridad''%'
    and (select definicion from f184) like '%tarifario_invalidar%'
    and (select definicion from generica) not like '%prioridad%'
    and (select count(*) from otras where funcion = 'tarifario_trg_bump_armado_directo') = 3
    and (select bool_and(not anon_puede and not authenticated_puede) from permisos)
    and (select filas_centinela from residuo) = 0
  ),
  'mutante', jsonb_build_object(
    -- ⚠️ NO se afirma que corrió cuando se omitió: `bloque_llego_a_ok` es true
    -- SOLO si había un paquete elegible (2+ hoteles) — el DO retorna sin ejecutar
    -- ningún caso cuando no lo hay, y en ese caso esto queda en false.
    'bloque_llego_a_ok', (select paquetes_con_2_mas from elegible) > 0,
    'ejecutado_sobre_datos_reales', (select paquetes_con_2_mas from elegible) > 0,
    'paquetes_elegibles_con_2_mas_hoteles', (select paquetes_con_2_mas from elegible),
    'como_se_sabe', case
      when (select paquetes_con_2_mas from elegible) > 0
        then 'El bloque §6 aborta con excepción en la PRIMERA aserción que falle; había un paquete elegible y este JSON es visible, así que todos sus casos pasaron (los NOTICE de cada uno quedan en el log).'
      else 'El bloque §6 NO se ejecutó: no hay ningún paquete con 2+ hoteles. Este JSON solo reporta el catálogo; NO afirma nada sobre los casos mutantes.'
    end,
    'casos', case
      when (select paquetes_con_2_mas from elegible) > 0 then jsonb_build_array(
        '6a limpiar TODAS las prioridades del paquete (solo prioridad) no invalida',
        '6b prioridad NULL -> 1 no invalida',
        '6c cambio real (categorias) invalida: revisión +1 y bloqueo',
        '6d cambiar prioridad con el paquete ya bloqueado no lo rehabilita ni mueve la revisión'
      )
      else '[]'::jsonb
    end,
    'aviso', case when (select paquetes_con_2_mas from elegible) > 0 then null
                  else 'NO HABÍA ningún paquete con 2+ hoteles: el bloque mutante se omitió (ver el NOTICE) y sus campos quedan en false, no en "todos los casos pasaron". Vuelve a correrlo donde haya datos reales.' end
  ),
  'rollback_sin_cambios_persistentes', jsonb_build_object(
    'cero_cambios', (select filas_centinela from residuo) = 0,
    'filas_con_el_centinela', (select filas_centinela from residuo),
    'nota', 'El bloque mutante marcó su cambio real con el centinela POSTCHECK184_PROBE: si el ROLLBACK no hubiera deshecho todo, quedaría al menos una fila con él.'
  ),
  'trigger_armado_hoteles', jsonb_build_object(
    'funcion', (select funcion from trg),
    'habilitado', (select tgenabled from trg),
    'definicion', (select definicion from trg)
  ),
  'funcion_184', jsonb_build_object(
    'security_definer', (select prosecdef from f184),
    'tiene_search_path_fijo', (select definicion from f184) like '%SET search_path TO ''public'', ''pg_temp''%',
    'ignora_el_cambio_de_solo_prioridad', (select definicion from f184) like '%to_jsonb(NEW) - ''prioridad''%'
  ),
  'funcion_generica_intacta', jsonb_build_object(
    'existe', (select count(*) from generica) = 1,
    'sin_rastro_de_prioridad', (select definicion from generica) not like '%prioridad%'
  ),
  'otras_tablas_de_armado', jsonb_build_object(
    'tablas', coalesce((select jsonb_agg(to_jsonb(otras) order by tabla) from otras), '[]'::jsonb),
    'todas_con_la_funcion_generica', (select count(*) from otras where funcion = 'tarifario_trg_bump_armado_directo') = 3
  ),
  'revokes', jsonb_build_object(
    'detalle', coalesce((select jsonb_agg(to_jsonb(permisos) order by proname) from permisos), '[]'::jsonb),
    'anon_y_authenticated_sin_execute', (select bool_and(not anon_puede and not authenticated_puede) from permisos)
  )
)) as postcheck_184;
