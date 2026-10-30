-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la 252: restaura la definición PREVIA EXACTA (la de la 244) guardada en public.respaldo_252 y verifica que pg_get_functiondef vuelve a ser idéntico (md5)
-- a lo respaldado; si no lo es, aborta TODO. Reafirma los permisos de la 244. Después borra el respaldo (un segundo rollback aborta). No toca datos.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
declare r record;
begin
  if to_regclass('public.respaldo_252') is null then
    raise exception 'ROLLBACK 252 ABORTADO: la 252 no está aplicada (no existe public.respaldo_252).';
  end if;
  if (select count(*) from public.respaldo_252) <> 1 then
    raise exception 'ROLLBACK 252 ABORTADO: el respaldo no tiene la definición esperada.';
  end if;
  for r in select * from public.respaldo_252 order by nombre loop
    if md5(r.definicion) <> r.md5 then
      raise exception 'ROLLBACK 252 ABORTADO: el respaldo de % está alterado (md5 no coincide).', r.nombre;
    end if;
    execute r.definicion;
    if md5(pg_get_functiondef(to_regprocedure(r.firma))) <> r.md5 then
      raise exception 'ROLLBACK 252 ABORTADO: la definición restaurada de % no es idéntica a la respaldada.', r.nombre;
    end if;
  end loop;
end;
$$;

revoke all on function public.guardar_programa_hoteles(bigint, jsonb) from public;
revoke all on function public.guardar_programa_hoteles(bigint, jsonb) from anon;
grant execute on function public.guardar_programa_hoteles(bigint, jsonb) to authenticated;

drop table public.respaldo_252;

commit;
