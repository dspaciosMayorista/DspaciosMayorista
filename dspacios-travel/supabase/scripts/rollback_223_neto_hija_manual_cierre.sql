-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 223 · apaga la modalidad obligatoria de #50 (la 222 queda como estaba). Un solo archivo,
-- una sola transacción. Es solo el interruptor: las hijas ya selladas conservan su sello.
-- ───────────────────────────────────────────────────────────────────────────
begin;

set local lock_timeout = '10s';

do $$
begin
  if to_regclass('p50_priv.config') is null then
    raise exception 'rollback 223: no existe p50_priv.config (la 222 no está aplicada). No se cambió nada.';
  end if;
  if not p50_priv.exigir_modalidad() then
    raise exception 'rollback 223: la 223 no está aplicada (la modalidad no es obligatoria). No se cambió nada.';
  end if;
end $$;

update p50_priv.config set exigir_modalidad = false, actualizado_en = now() where id;

do $$
begin
  if p50_priv.exigir_modalidad() then
    raise exception 'rollback 223: el interruptor no quedó apagado.';
  end if;
end $$;

commit;
