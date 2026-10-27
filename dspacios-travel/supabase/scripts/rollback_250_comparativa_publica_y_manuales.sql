-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la 250: restaura las definiciones PREVIAS EXACTAS guardadas por la migración (f211_priv.respaldo_250) y verifica, función por función, que
-- pg_get_functiondef vuelve a ser idéntico (md5) a lo respaldado; si no lo es, aborta TODO. Después borra el respaldo (un segundo rollback aborta).
-- No toca datos. Las hijas ya creadas con vuelos manuales y las comparativas marcadas para compartir no se modifican (dejan de ser elegibles por el canal público).
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
declare r record;
begin
  if to_regclass('f211_priv.respaldo_250') is null then
    raise exception 'ROLLBACK 250 ABORTADO: la 250 no está aplicada (no existe f211_priv.respaldo_250).';
  end if;
  if (select count(*) from f211_priv.respaldo_250) <> 2 then
    raise exception 'ROLLBACK 250 ABORTADO: el respaldo no tiene las dos definiciones esperadas.';
  end if;
  for r in select * from f211_priv.respaldo_250 order by nombre loop
    if md5(r.definicion) <> r.md5 then
      raise exception 'ROLLBACK 250 ABORTADO: el respaldo de % está alterado (md5 no coincide).', r.nombre;
    end if;
    execute r.definicion;
    if md5(pg_get_functiondef(to_regprocedure(r.firma))) <> r.md5 then
      raise exception 'ROLLBACK 250 ABORTADO: la definición restaurada de % no es idéntica a la respaldada.', r.nombre;
    end if;
  end loop;
end;
$$;

drop table f211_priv.respaldo_250;

commit;
