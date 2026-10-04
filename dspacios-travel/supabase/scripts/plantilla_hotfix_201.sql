-- ───────────────────────────────────────────────────────────────────────────
-- PLANTILLA · HOTFIX FUERA DE BANDA de UNA función de Vuelos de la 201,
-- para un defecto SQL que aparece DESPUÉS del cierre irreversible, cuando
-- todavía no se puede corregir con una migración normal de Vuelos (los
-- números 202–204 están reservados para CRM, Tarifas y Contabilidad). No es
-- una migración: no ocupa ningún número ni presupone saltarse uno reservado.
-- Ver el procedimiento completo y los riesgos en
-- docs/tecnico/vuelos-201-despliegue-y-cierre.md.
--
-- ⚠️ REQUIERE AUTORIZACIÓN SEPARADA DEL DUEÑO PARA CADA INCIDENTE. Sin ella,
-- la función queda solo contenida (contener_funcion_201.sql).
--
-- Cómo se usa (copiar a hotfix_201_<funcion>_<fecha>.sql, nunca editar esta):
--   0. Obtener la autorización del dueño para ESTE incidente y anotarla en el motivo.
--   1. Contener primero si el defecto puede dañar datos (contener_funcion_201.sql).
--   2. Escribir el cuerpo corregido en lugar de @@CUERPO@@: un
--      `create or replace function` de la MISMA firma, con el mismo
--      `security definer`, `search_path` y `lock_timeout` que la 201.
--   3. Probarlo en Docker sobre un clon con la 201 (y el cierre cumplido):
--      obtener el hash del cuerpo nuevo y ponerlo en c_hash_hotfix; correr las
--      baterías de la 201 y el postcheck.
--   4. Aplicarlo en el editor SQL. Es re-ejecutable (acepta el cuerpo de la
--      201 o el ya corregido) y todo o nada.
--   5. Levantar la contención (levantar_contencion_201.sql).
--   6. Consolidar en una migración NORMAL de Vuelos con el siguiente número
--      libre del repositorio, solo cuando los números reservados anteriores
--      (204 de Contabilidad, y 202/203 si siguen pendientes) ya estén aplicados;
--      nunca un número reservado ni una 205 antes de la 204. Mismo cuerpo, con
--      guarda que acepte cualquiera de los dos hashes.
-- Revertir este hotfix: el mismo esquema con el cuerpo literal de la 201 y los
-- hashes intercambiados. Eso devuelve la función a la 201; no reabre ninguna
-- firma vieja ni toca el estado del cierre (la guarda lo prohíbe).
-- ───────────────────────────────────────────────────────────────────────────
begin;

create temp table hotfix_201 on commit drop as select
  'PEGAR_FIRMA'::text       as firma,          -- p. ej. public.editar_contrato_manual(bigint,text,jsonb)
  'PEGAR_HASH_201'::text    as hash_201,       -- hash con que la dejó la 201 (postcheck_201_flujo_vuelos.sql)
  'PEGAR_HASH_HOTFIX'::text as hash_hotfix,    -- hash del cuerpo corregido, medido en Docker
  'PEGAR_MOTIVO'::text      as motivo,
  'PEGAR_AUTORIZACION'::text as autorizacion,  -- quién del lado del dueño autorizó ESTE incidente, cuándo y por qué medio
  (select estado || '|' || coalesce(cierra_en::text, '-') || '|' || public._firmas_antiguas_cerradas()::text
     from public.vuelos_cierre_firmas_201) as cierre_antes;

do $$
declare h record; v_hash text;
begin
  select * into h from hotfix_201;
  if h.firma in ('public.liberar_silla(bigint)', 'public.asignar_contrato_manual(bigint,text)', 'public.quitar_contrato_manual(bigint)',
                 'public._registrar_firma_antigua(text,bigint)', 'public._firmas_antiguas_cerradas()',
                 'public._vuelos_cierre_firmas_201_monotono()', 'public.programar_cierre_firmas_antiguas(integer,text)',
                 'public.cancelar_cierre_firmas_antiguas(text)', 'public._registrar_firma_nueva()') then
    raise exception 'Un hotfix no toca las firmas viejas ni las piezas del cierre (no se reabre nada): %. No se cambió nada.', h.firma;
  end if;
  if coalesce(btrim(h.autorizacion), '') = '' or h.autorizacion ~ '^PEGAR_' then
    raise exception 'Falta la autorización del dueño para ESTE incidente (cada hotfix fuera de banda se autoriza por separado). No se cambió nada.';
  end if;
  if h.hash_201 !~ '^[0-9a-f]{32}$' or h.hash_hotfix !~ '^[0-9a-f]{32}$' or coalesce(btrim(h.motivo), '') = '' or h.motivo ~ '^PEGAR_' then
    raise exception 'Faltan los hashes (201 y corregido) o el motivo. No se cambió nada.';
  end if;
  select md5(replace(prosrc, chr(13), '')) into v_hash from pg_proc where oid = to_regprocedure(h.firma);
  if v_hash is null then
    raise exception 'No existe la función %. No se cambió nada.', h.firma;
  end if;
  if v_hash not in (h.hash_201, h.hash_hotfix) then
    raise exception 'La función % no está ni como la dejó la 201 ni corregida (hash %): alguien la cambió; revisar antes. No se cambió nada.', h.firma, v_hash;
  end if;
  if v_hash = h.hash_hotfix then
    raise notice 'El hotfix ya estaba aplicado: se vuelve a escribir el mismo cuerpo (sin cambios).';
  end if;
end $$;

-- ═══ Cuerpo corregido ════════════════════════════════════════════════════
@@CUERPO@@

-- ═══ Verificación en la misma transacción ═════════════════════════════════
do $$
declare h record;
begin
  select * into h from hotfix_201;
  if (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure(h.firma)) is distinct from h.hash_hotfix then
    raise exception 'El cuerpo aplicado no es el que se probó en Docker (hash distinto). No se cambió nada.';
  end if;
  if (select estado || '|' || coalesce(cierra_en::text, '-') || '|' || public._firmas_antiguas_cerradas()::text
        from public.vuelos_cierre_firmas_201) is distinct from h.cierre_antes then
    raise exception 'El estado del cierre de firmas cambió durante el hotfix. No se cambió nada.';
  end if;
  if has_function_privilege('anon', h.firma, 'execute') then
    raise exception 'El hotfix dejó la función abierta a anon. No se cambió nada.';
  end if;
  raise notice 'HOTFIX aplicado a % (%; autorizado: %). El cierre de firmas sigue igual.', h.firma, h.motivo, h.autorizacion;
end $$;

commit;
