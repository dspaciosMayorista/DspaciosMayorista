-- ROLLBACK 259 · publicador del tarifario con límite propio.
-- Quita los dos límites que puso la 259, pero SOLO en la función cuya configuración propia sea EXACTAMENTE la configuración COMPLETA de la 259:
--     search_path=public, pg_temp  +  statement_timeout=30s  +  lock_timeout=8s
-- Por función, de forma independiente:
--   · configuración completa de la 259 → RESET de statement_timeout y lock_timeout (vuelve a regirse por los límites del rol).
--   · sin límites propios y search_path de siempre → no hace nada (ya está así).
--   · cualquier otra cosa (un límite distinto, un parámetro nuevo, o un search_path que cambió DESPUÉS de la 259) → NO la toca y avisa con WARNING;
--     revisar a mano. La otra función sí se revierte si sigue exactamente en estado 259.
-- Al final dice si el rollback quedó COMPLETO o INCOMPLETO (WARNING «ROLLBACK 259 INCOMPLETO»): un rollback parcial NO debe darse por terminado.
-- ⚠️ NUNCA `RESET ALL`: borraría también el `search_path` de estas funciones SECURITY DEFINER.
-- No toca cuerpos, grants ni roles. Idempotente.
begin;

do $$
declare
  v_firma text;
  v_oid   oid;
  v_extra text[];
  v_sp    text[];
  v_pend  text[] := '{}';
begin
  foreach v_firma in array array[
    'public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)',
    'public.publicar_tarifario_resultado_63(bigint,bigint,bigint,text,jsonb,text,numeric)'
  ] loop
    v_oid := to_regprocedure(v_firma);
    if v_oid is null then
      raise warning 'rollback 259: no existe %; no hay nada que revertir ahí.', v_firma;
      v_pend := v_pend || v_firma;
      continue;
    end if;
    select array_agg(c order by c) filter (where c not like 'search_path=%'),
           array_agg(c order by c) filter (where c like 'search_path=%')
      into v_extra, v_sp
      from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c
     where p.oid = v_oid;
    if v_sp is distinct from array['search_path=public, pg_temp'] then
      raise warning 'rollback 259: % tiene un search_path que NO es el de la 259 (%) o configuración que NO es la de la 259 (%); NO se toca. Revisar a mano.', v_firma, coalesce(v_sp::text, '(ninguno)'), coalesce(v_extra::text, '(sin límites)');
      v_pend := v_pend || v_firma;
    elsif v_extra is null then
      raise notice 'rollback 259: % ya no tiene límites propios; sin cambios.', v_firma;
    elsif v_extra = array['lock_timeout=8s', 'statement_timeout=30s'] then
      execute format('alter function %s reset statement_timeout reset lock_timeout', v_firma);
      raise notice 'rollback 259: % vuelve a regirse por los límites del rol.', v_firma;
    else
      raise warning 'rollback 259: % tiene configuración que NO es la de la 259 (%); NO se toca. Revisar a mano.', v_firma, v_extra::text;
      v_pend := v_pend || v_firma;
    end if;
  end loop;
  if cardinality(v_pend) = 0 then
    raise notice 'ROLLBACK 259 COMPLETO: las dos entradas quedaron sin los límites de la 259.';
  else
    raise warning 'ROLLBACK 259 INCOMPLETO: no se tocaron % función(es): %. Revisar a mano; el rollback NO está terminado.', cardinality(v_pend), array_to_string(v_pend, ', ');
  end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- Estado final (ejecutar aparte si se quiere verlo):
-- select proname, case when (select array_agg(c order by c) from unnest(proconfig) c where c not like 'search_path=%') is null then 'SIN_LIMITES'
--                      when (select array_agg(c order by c) from unnest(proconfig) c where c not like 'search_path=%') = array['lock_timeout=8s','statement_timeout=30s'] then 'APLICADA_259'
--                      else 'AJENA' end as estado, proconfig
--   from pg_proc where proname in ('publicar_tarifario_resultado', 'publicar_tarifario_resultado_63');
