-- Rollback de la migración 237 (frontera D8/D9). NO borra datos de catálogos.
--  1) quita las policies restrictivas;
--  2) RESTAURA las 4 funciones SECURITY DEFINER a su definición EXACTA previa, leyéndola del respaldo
--     que la propia 237 guardó antes de reemplazarlas (catalogos_funciones_previas_237), y VERIFICA
--     que el md5 del cuerpo restaurado coincida con el guardado: si no, aborta TODO el rollback;
--  3) elimina el contexto por sesión y el respaldo.
-- Si el respaldo no existe (la 237 no se aplicó, o ya se revirtió) el script se detiene sin cambiar nada.
-- Efecto: vuelve a regir solo la matriz de roles/tenant home de antes.
begin;
set local lock_timeout = '5s';

do $$
declare
  t text;
  r record;
  v_md5 text;
begin
  if to_regclass('public.catalogos_funciones_previas_237') is null then
    raise exception 'rollback 237: no existe catalogos_funciones_previas_237 (la 237 no está aplicada o ya se revirtió)';
  end if;
  if (select count(*) from public.catalogos_funciones_previas_237) <> 4 then
    raise exception 'rollback 237: el respaldo de funciones no tiene las 4 filas esperadas';
  end if;

  foreach t in array public.catalogos_globales_registro() loop
    execute format('drop policy if exists %I on public.%I', 'catalogo global: insertar solo Mayorista', t);
    execute format('drop policy if exists %I on public.%I', 'catalogo global: actualizar solo Mayorista', t);
    execute format('drop policy if exists %I on public.%I', 'catalogo global: borrar solo Mayorista', t);
  end loop;

  for r in select firma, md5_prosrc, definicion from public.catalogos_funciones_previas_237 order by firma loop
    execute r.definicion;                                   -- CREATE OR REPLACE con el texto exacto previo
    select md5(p.prosrc) into v_md5
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = r.firma;
    if v_md5 is distinct from r.md5_prosrc then
      raise exception 'rollback 237: % restaurada con md5 % (esperado %)', r.firma, v_md5, r.md5_prosrc;
    end if;
  end loop;
end;
$$;

drop trigger if exists usuarios_invalidar_contexto_agencia on public.usuarios;
drop function if exists public.invalidar_contexto_agencia_usuario();
drop function if exists public.cambiar_contexto_agencia(uuid, text);
drop function if exists public.iniciar_contexto_agencia(uuid, text, interval);
drop function if exists public.puede_escribir_catalogo_global();
drop function if exists public.agencia_activa_sesion();
drop function if exists public.catalogos_globales_registro();
drop table if exists public.sesion_agencia;
drop table if exists public.sesion_agencia_inicio;
drop table if exists public.catalogos_funciones_previas_237;
commit;
