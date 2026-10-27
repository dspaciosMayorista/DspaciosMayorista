-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la 251: restaura la definición PREVIA EXACTA (la de la 250) guardada en f211_priv.respaldo_251 y verifica que pg_get_functiondef vuelve a ser idéntico (md5)
-- a lo respaldado; si no lo es, aborta TODO. Después borra el respaldo (un segundo rollback aborta). No toca datos: las hijas ya creadas no se modifican.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
declare r record;
begin
  if to_regclass('f211_priv.respaldo_251') is null then
    raise exception 'ROLLBACK 251 ABORTADO: la 251 no está aplicada (no existe f211_priv.respaldo_251).';
  end if;
  if (select count(*) from f211_priv.respaldo_251) <> 1 then
    raise exception 'ROLLBACK 251 ABORTADO: el respaldo no tiene la definición esperada.';
  end if;
  for r in select * from f211_priv.respaldo_251 order by nombre loop
    if md5(r.definicion) <> r.md5 then
      raise exception 'ROLLBACK 251 ABORTADO: el respaldo de % está alterado (md5 no coincide).', r.nombre;
    end if;
    execute r.definicion;
    if md5(pg_get_functiondef(to_regprocedure(r.firma))) <> r.md5 then
      raise exception 'ROLLBACK 251 ABORTADO: la definición restaurada de % no es idéntica a la respaldada.', r.nombre;
    end if;
  end loop;
end;
$$;

drop table f211_priv.respaldo_251;

commit;
