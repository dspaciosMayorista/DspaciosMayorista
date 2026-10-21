-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 221 · Clientes de contratos en el CRM (#68).
-- La 221 solo creó dos funciones de LECTURA (ninguna tabla, columna, política ni dato): revertirla es
-- eliminarlas. No toca ventas, ventas_basica, usuarios, crm_contactos ni ningún helper. Aborta, sin cambiar
-- nada, si algún objeto AJENO depende de alguna de las dos funciones (p. ej., una vista que las use).
-- Correr con el MISMO rol que aplicó la 221. Idempotente: sin las funciones, no hace nada.
-- Después de revertir, el código de la sección «Clientes de contratos» deja de funcionar (devuelve error de
-- función inexistente): retirar o apagar la sección antes si el código ya está desplegado.
-- ───────────────────────────────────────────────────────────────────────────
begin;

set local lock_timeout = '10s';

do $$
declare
  v_dep text;
begin
  select string_agg(distinct d.classid::regclass::text || ':' || d.objid::text, ', ') into v_dep
    from pg_catalog.pg_depend d
   where d.refobjid in (coalesce(to_regprocedure('public.crm_contratos_clientes_buscar(text,text,text,integer)')::oid, 0::oid),
                        coalesce(to_regprocedure('public.crm_contrato_cliente_ficha(text)')::oid, 0::oid))
     and d.deptype in ('n', 'a')
     and d.classid <> 'pg_catalog.pg_type'::regclass;
  if v_dep is not null then
    raise exception 'ROLLBACK 221 ABORTADO (objetos ajenos dependen de las funciones): %', v_dep;
  end if;
end $$;

drop function if exists public.crm_contratos_clientes_buscar(text, text, text, integer);
drop function if exists public.crm_contrato_cliente_ficha(text);

do $$
begin
  if to_regprocedure('public.crm_contratos_clientes_buscar(text,text,text,integer)') is not null
     or to_regprocedure('public.crm_contrato_cliente_ficha(text)') is not null then
    raise exception 'ROLLBACK 221 FALLÓ: las funciones siguen existiendo.';
  end if;
end $$;

commit;
