-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 219 · personas de cotizaciones en el CRM (#42).
--
-- Deshace la 219 y deja la 214 EXACTA. Corre en UNA transacción, bloquea persona_capturas y
-- cotizacion_participantes antes de comprobar nada y ABORTA SIN BORRAR NADA (RAISE EXCEPTION,
-- nunca CASCADE) si:
--   1. hay cualquier captura con fuente `cotizacion`;
--   2. hay cualquier fila en cotizacion_participantes;
--   3. otro objeto ajeno depende de la tabla de vínculo o de las funciones de la 219;
--   4. falta la foto de la 214 (p214_priv.r219_foto_214) o está incompleta.
-- Vacío: elimina lo nuevo, recrea las 5 funciones y las 4 restricciones de la 214 desde la foto
-- (pg_get_functiondef / pg_get_constraintdef tomados al aplicar la 219), restaura los GRANT de la
-- 214 y COMPRUEBA que definición, huella y ACL coinciden con la foto; si algo difiere, se revierte
-- todo. Después de esto `postcheck_214` debe dar 20/20 y la prueba SQL 214 volver a pasar (E8g).
-- El mensaje trae siempre los conteos, nunca datos personales.
-- Lo ejecuta SOLO el usuario, con autorización separada; nunca desde un agente.
-- ───────────────────────────────────────────────────────────────────────────
begin;

set local lock_timeout = '10s';

do $$
declare
  v_capturas bigint := 0;
  v_puestos bigint := 0;
  v_conteos text;
  v_dependientes text;
  v_funciones oid[];
  f record;
  v_mal text;
begin
  if to_regclass('public.cotizacion_participantes') is null and to_regclass('p214_priv.r219_foto_214') is null
     and to_regprocedure('public.registrar_personas_cotizacion(bigint,uuid,jsonb)') is null
     and to_regprocedure('p214_priv.upsert_persona(uuid,text,text,text,text,text,jsonb,text,bigint,uuid,text,bigint,uuid,text)') is null then
    raise notice 'ROLLBACK 219: no hay objetos de la 219; nada que hacer.';
    return;
  end if;

  -- Bloqueo antes de comprobar: ninguna escritura puede colarse entre la comprobación y el cambio.
  lock table public.persona_capturas in access exclusive mode;
  if to_regclass('public.cotizacion_participantes') is not null then
    lock table public.cotizacion_participantes in access exclusive mode;
    select count(*) into v_puestos from public.cotizacion_participantes;
  end if;
  if exists (select 1 from pg_catalog.pg_attribute a
              where a.attrelid = 'public.persona_capturas'::regclass and a.attname = 'cotizacion_id'
                and a.attnum > 0 and not a.attisdropped) then
    select count(*) into v_capturas from public.persona_capturas c where c.fuente = 'cotizacion';
  end if;
  v_conteos := format('capturas_cotizacion=%s, puestos=%s', v_capturas, v_puestos);

  if v_capturas > 0 then
    raise exception 'ROLLBACK 219 ABORTADO (1: hay capturas de cotización; no se borró nada). %', v_conteos;
  end if;
  if v_puestos > 0 then
    raise exception 'ROLLBACK 219 ABORTADO (2: hay puestos de cotización; no se borró nada). %', v_conteos;
  end if;

  -- 3. Dependencias ajenas sobre la tabla de vínculo o sobre las funciones nuevas.
  select coalesce(array_agg(x.oid), '{}'::oid[]) into v_funciones
    from (select to_regprocedure(s) as oid
            from unnest(array[
              'public.registrar_personas_cotizacion(bigint,uuid,jsonb)',
              'public.actualizar_titular_cotizacion(bigint,uuid,jsonb,integer,uuid)',
              'public.sellar_creador_cotizacion(bigint,uuid)',
              'public.crm_personas_cotizacion_buscar(text,text,integer,integer)',
              'p214_priv.trg_participante_guardas()',
              'p214_priv.trg_participante_sin_borrado()',
              'p214_priv.cotizacion_anonima(text,text,uuid,uuid,bigint)',
              'p214_priv.autorizar_actor_cotizacion(uuid,text,uuid,boolean,boolean)',
              'p214_priv.validar_campos_participante(text,jsonb)',
              'p214_priv.texto_entrada(jsonb,text)',
              'p214_priv.participante_identificado(text,jsonb)']) s) x
   where x.oid is not null;
  select string_agg(distinct pg_describe_object(d.classid, d.objid, d.objsubid), ', ') into v_dependientes
    from pg_depend d
   where d.deptype in ('n', 'a')
     and (   (d.refclassid = 'pg_class'::regclass and d.refobjid = to_regclass('public.cotizacion_participantes'))
          or (d.refclassid = 'pg_proc'::regclass and d.refobjid = any (v_funciones)))
     and not (d.classid = 'pg_class'::regclass
              and (d.objid = to_regclass('public.cotizacion_participantes')
                   or d.objid in (select i.indexrelid from pg_index i where i.indrelid = to_regclass('public.cotizacion_participantes'))))
     and not (d.classid = 'pg_constraint'::regclass
              and d.objid in (select c.oid from pg_constraint c where c.conrelid = to_regclass('public.cotizacion_participantes')))
     and not (d.classid = 'pg_trigger'::regclass
              and d.objid in (select t.oid from pg_trigger t where t.tgrelid = to_regclass('public.cotizacion_participantes')))
     and not (d.classid = 'pg_attrdef'::regclass
              and d.objid in (select a.oid from pg_attrdef a where a.adrelid = to_regclass('public.cotizacion_participantes')))
     and not (d.classid = 'pg_type'::regclass
              and d.objid in (select c.reltype from pg_class c where c.oid = to_regclass('public.cotizacion_participantes')))
     and not (d.classid = 'pg_proc'::regclass and d.objid = any (v_funciones));
  if v_dependientes is not null then
    raise exception 'ROLLBACK 219 ABORTADO (3: objetos ajenos dependen de la 219: %; no se borró nada). %', v_dependientes, v_conteos;
  end if;

  -- 4. La foto debe estar completa: sin ella no se puede restaurar la 214 exacta.
  if to_regclass('p214_priv.r219_foto_214') is null
     or (select count(*) from p214_priv.r219_foto_214) <> 9
     or (select count(*) from p214_priv.r219_foto_214 where tipo = 'funcion') <> 5 then
    raise exception 'ROLLBACK 219 ABORTADO (4: falta la foto de la 214 o está incompleta; restaurar a mano). %', v_conteos;
  end if;

  -- Sin ninguna condición: eliminar lo nuevo (sin CASCADE), en orden inverso.
  drop function if exists public.crm_personas_cotizacion_buscar(text, text, integer, integer);
  drop function if exists public.sellar_creador_cotizacion(bigint, uuid);
  drop function if exists public.actualizar_titular_cotizacion(bigint, uuid, jsonb, integer, uuid);
  drop function if exists public.registrar_personas_cotizacion(bigint, uuid, jsonb);
  drop table if exists public.cotizacion_participantes;
  drop function if exists p214_priv.trg_participante_guardas();
  drop function if exists p214_priv.trg_participante_sin_borrado();
  drop function if exists p214_priv.cotizacion_anonima(text, text, uuid, uuid, bigint);
  drop function if exists p214_priv.autorizar_actor_cotizacion(uuid, text, uuid, boolean, boolean);
  drop function if exists p214_priv.validar_campos_participante(text, jsonb);
  drop function if exists p214_priv.texto_entrada(jsonb, text);
  drop function if exists p214_priv.participante_identificado(text, jsonb);
  drop function if exists p214_priv.upsert_persona(uuid, text, text, text, text, text, jsonb, text, bigint, uuid, text, bigint, uuid, text);
  drop function if exists p214_priv.captura_coincide(uuid, uuid, text, text, text, text, text, text, bigint, jsonb, bigint, uuid, text);
  drop function if exists p214_priv.validar_entrada_captura(uuid, text, text, text, text, text, bigint, bigint, uuid, text);
  drop function if exists p214_priv.captura_visible(uuid, text, text, text, text, bigint, text, text, uuid);

  -- Restricciones: fuera las de la 219, de vuelta las de la 214 (mismos nombres, misma definición).
  alter table public.persona_capturas
    drop constraint if exists persona_capturas_puesto_uk,
    drop constraint if exists persona_capturas_fuente_ck,
    drop constraint if exists persona_capturas_nivel_ck,
    drop constraint if exists persona_capturas_fuente_check,
    drop constraint if exists persona_capturas_nivel_check;
  drop index if exists public.idx_persona_capturas_cotizacion;
  alter table public.persona_capturas
    drop column if exists cotizacion_id,
    drop column if exists participante_ref,
    drop column if exists rol;
  for f in select * from p214_priv.r219_foto_214 where tipo = 'restriccion' order by objeto loop
    execute format('alter table public.persona_capturas add constraint %I %s', f.objeto, f.definicion);
  end loop;

  -- Funciones de la 214, tal como estaban (la definición completa es un CREATE OR REPLACE).
  for f in select * from p214_priv.r219_foto_214 where tipo = 'funcion' order by objeto loop
    execute f.definicion;
  end loop;

  -- GRANT de la 214 (sección 8), idénticos.
  revoke all on all functions in schema p214_priv from public, anon, authenticated, service_role;
  grant execute on function
    p214_priv.norm_documento(text, text, boolean, text),
    p214_priv.dv_nit_valido(text),
    p214_priv.exigir_read_committed(),
    p214_priv.validar_entrada_captura(uuid, text, text, text, text, text, bigint),
    p214_priv.observaciones_de_entrada(jsonb),
    p214_priv.carga_esperada(jsonb, text),
    p214_priv.marca_nit(text, text, text),
    p214_priv.captura_coincide(uuid, uuid, text, text, text, text, text, text, bigint, jsonb),
    p214_priv.upsert_persona(uuid, text, text, text, text, text, jsonb, text, bigint, uuid, text),
    p214_priv.promover_persona(uuid, uuid, text, text, text, jsonb, text, text, bigint, uuid, text)
    to service_role;
  revoke all on function public.buscar_personas_documento(text, text, text, integer, integer)
    from public, anon, authenticated, service_role;
  grant execute on function public.buscar_personas_documento(text, text, text, integer, integer) to authenticated;

  -- Comprobación: cada función y restricción restaurada es IDÉNTICA a la foto.
  select string_agg(x.objeto, ', ') into v_mal
    from p214_priv.r219_foto_214 x
   where (x.tipo = 'funcion'
          and (to_regprocedure(x.objeto) is null
               or (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid = to_regprocedure(x.objeto)) is distinct from x.huella
               or (select p.proacl::text from pg_proc p where p.oid = to_regprocedure(x.objeto)) is distinct from x.acl))
      or (x.tipo = 'restriccion'
          and (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c
                where c.conrelid = 'public.persona_capturas'::regclass and c.conname = x.objeto) is distinct from x.huella);
  if v_mal is not null then
    raise exception 'ROLLBACK 219: la restauración no coincide con la foto de la 214 (%); se revierte todo. %', v_mal, v_conteos;
  end if;

  drop table p214_priv.r219_foto_214;

  if to_regclass('public.cotizacion_participantes') is not null or to_regclass('p214_priv.r219_foto_214') is not null
     or to_regprocedure('public.registrar_personas_cotizacion(bigint,uuid,jsonb)') is not null
     or to_regprocedure('p214_priv.upsert_persona(uuid,text,text,text,text,text,jsonb,text,bigint,uuid,text)') is null
     or exists (select 1 from pg_catalog.pg_attribute a
                 where a.attrelid = 'public.persona_capturas'::regclass and a.attname in ('cotizacion_id', 'participante_ref', 'rol')
                   and a.attnum > 0 and not a.attisdropped) then
    raise exception 'ROLLBACK 219: quedó algún objeto de la 219 o falta uno de la 214; se revierte todo.';
  end if;
  raise notice 'ROLLBACK 219 COMPLETO: 214 restaurada exacta (5 funciones y 4 restricciones verificadas) (%).', v_conteos;
end $$;

notify pgrst, 'reload schema';

commit;
