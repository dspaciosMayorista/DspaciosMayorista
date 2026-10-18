-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 214 · registro central de personas (#32).
--
-- Solo para deshacer la 214 cuando sus tablas están VACÍAS. Corre en UNA transacción, bloquea
-- las tres tablas antes de comprobar nada y ABORTA SIN BORRAR NADA (RAISE EXCEPTION, nunca
-- CASCADE) si se cumple cualquiera de (documento técnico, 3.4):
--   1-3. hay cualquier fila en personas, persona_capturas o persona_observaciones (se cuentan
--        las tres por separado aunque las FK bastarían: pueden desactivarse con
--        session_replication_role = replica);
--   4.   otra tabla tiene una FK hacia cualquiera de las tres, tenga o no filas;
--   5.   existe una columna ajena llamada persona_id, captura_id o *_persona_id (referencia blanda);
--   6.   un objeto ajeno depende de las tablas, de sus funciones o del esquema p214_priv
--        (pg_depend: vistas, triggers, policies, funciones con dependencias registradas).
--        Límite conocido: una función plpgsql que nombre las tablas en su cuerpo NO deja
--        dependencia registrada y no se detecta aquí.
-- El mensaje siempre trae los tres conteos y nunca datos personales. Recuperar con datos
-- presentes es otra operación (exportación y aprobación explícita), no este script.
-- Lo ejecuta SOLO el usuario, con autorización separada; nunca desde un agente.
-- ───────────────────────────────────────────────────────────────────────────
begin;

set local lock_timeout = '10s';

do $$
declare
  v_personas bigint := 0;
  v_capturas bigint := 0;
  v_observaciones bigint := 0;
  v_fk text;
  v_blandas text;
  v_dependientes text;
  v_conteos text;
  v_tablas oid[];
  v_funciones oid[];
begin
  if to_regclass('public.personas') is null and to_regclass('public.persona_capturas') is null
     and to_regclass('public.persona_observaciones') is null and to_regnamespace('p214_priv') is null
     and to_regprocedure('public.buscar_personas_documento(text,text,text,integer,integer)') is null then
    raise notice 'ROLLBACK 214: no hay objetos de la 214; nada que hacer.';
    return;
  end if;

  -- Bloqueo antes de comprobar: ninguna escritura puede colarse entre la comprobación y el DROP.
  if to_regclass('public.personas') is not null then
    lock table public.personas in access exclusive mode;
  end if;
  if to_regclass('public.persona_capturas') is not null then
    lock table public.persona_capturas in access exclusive mode;
  end if;
  if to_regclass('public.persona_observaciones') is not null then
    lock table public.persona_observaciones in access exclusive mode;
  end if;

  if to_regclass('public.personas') is not null then
    select count(*) into v_personas from public.personas;
  end if;
  if to_regclass('public.persona_capturas') is not null then
    select count(*) into v_capturas from public.persona_capturas;
  end if;
  if to_regclass('public.persona_observaciones') is not null then
    select count(*) into v_observaciones from public.persona_observaciones;
  end if;
  v_conteos := format('personas=%s, capturas=%s, observaciones=%s', v_personas, v_capturas, v_observaciones);

  if v_personas > 0 or v_capturas > 0 or v_observaciones > 0 then
    raise exception 'ROLLBACK 214 ABORTADO (1-3: hay filas; no se borró nada). %', v_conteos;
  end if;

  v_tablas := array_remove(array[to_regclass('public.personas')::oid, to_regclass('public.persona_capturas')::oid,
                                 to_regclass('public.persona_observaciones')::oid], null);
  select coalesce(array_agg(p.oid), '{}'::oid[]) into v_funciones
    from pg_proc p where p.pronamespace = to_regnamespace('p214_priv');
  if to_regprocedure('public.buscar_personas_documento(text,text,text,integer,integer)') is not null then
    v_funciones := v_funciones || to_regprocedure('public.buscar_personas_documento(text,text,text,integer,integer)')::oid;
  end if;

  select string_agg(format('%s.%s', c.conrelid::regclass, c.conname), ', ') into v_fk
    from pg_constraint c
   where c.contype = 'f' and c.confrelid = any (v_tablas) and not (c.conrelid = any (v_tablas));
  if v_fk is not null then
    raise exception 'ROLLBACK 214 ABORTADO (4: FK ajenas hacia la 214: %; no se borró nada). %', v_fk, v_conteos;
  end if;

  -- Por catálogo, no por information_schema: este oculta las tablas sobre las que el rol que ejecuta
  -- no tiene privilegios, y una referencia blanda invisible dejaría pasar el DROP.
  select string_agg(format('%s.%s', a.attrelid::regclass, quote_ident(a.attname)), ', ' order by 1) into v_blandas
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (a.attname in ('persona_id', 'captura_id') or a.attname like '%\_persona\_id' escape '\')
     and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_toast'
     and not pg_catalog.pg_is_other_temp_schema(n.oid)
     and not (c.oid = any (v_tablas));
  if v_blandas is not null then
    raise exception 'ROLLBACK 214 ABORTADO (5: referencias blandas: %; no se borró nada). %', v_blandas, v_conteos;
  end if;

  -- Dependencias ajenas: cualquier objeto que dependa de las tablas, de sus funciones o del
  -- esquema, salvo los que forman parte de la propia 214.
  select string_agg(distinct pg_describe_object(d.classid, d.objid, d.objsubid), ', ') into v_dependientes
    from pg_depend d
   where d.deptype in ('n', 'a')
     and (   (d.refclassid = 'pg_class'::regclass and d.refobjid = any (v_tablas))
          or (d.refclassid = 'pg_proc'::regclass and d.refobjid = any (v_funciones))
          or (d.refclassid = 'pg_namespace'::regclass and d.refobjid = to_regnamespace('p214_priv')::oid))
     and not (d.classid = 'pg_class'::regclass
              and (d.objid = any (v_tablas)
                   or d.objid in (select i.indexrelid from pg_index i where i.indrelid = any (v_tablas))))
     and not (d.classid = 'pg_constraint'::regclass
              and d.objid in (select c.oid from pg_constraint c where c.conrelid = any (v_tablas)))
     and not (d.classid = 'pg_trigger'::regclass
              and d.objid in (select t.oid from pg_trigger t where t.tgrelid = any (v_tablas)))
     and not (d.classid = 'pg_attrdef'::regclass
              and d.objid in (select a.oid from pg_attrdef a where a.adrelid = any (v_tablas)))
     and not (d.classid = 'pg_proc'::regclass and d.objid = any (v_funciones))
     and not (d.classid = 'pg_type'::regclass
              and d.objid in (select c.reltype from pg_class c where c.oid = any (v_tablas)));
  if v_dependientes is not null then
    raise exception 'ROLLBACK 214 ABORTADO (6: objetos ajenos dependen de la 214: %; no se borró nada). %', v_dependientes, v_conteos;
  end if;

  -- Sin ninguna condición: eliminar en orden inverso, sin CASCADE.
  drop function if exists public.buscar_personas_documento(text, text, text, integer, integer);
  drop table if exists public.persona_observaciones;
  drop table if exists public.persona_capturas;
  drop table if exists public.personas;
  declare
    f record;
  begin
    for f in select p.oid::regprocedure as firma from pg_proc p where p.pronamespace = to_regnamespace('p214_priv') loop
      execute format('drop function %s', f.firma);
    end loop;
  end;
  if to_regnamespace('p214_priv') is not null then
    drop schema p214_priv;
  end if;

  if to_regclass('public.personas') is not null or to_regclass('public.persona_capturas') is not null
     or to_regclass('public.persona_observaciones') is not null or to_regnamespace('p214_priv') is not null
     or to_regprocedure('public.buscar_personas_documento(text,text,text,integer,integer)') is not null then
    raise exception 'ROLLBACK 214: quedó algún objeto de la 214; se revierte todo.';
  end if;
  raise notice 'ROLLBACK 214 COMPLETO: objetos de la 214 eliminados (%).', v_conteos;
end $$;

commit;
