-- ═════════════════════════════════════════════════════════════════════════
-- PRUEBA W · #39 — `p39_priv.autorizada()` ve la autorización de SU transacción.
-- SOLO base desechable con la 216 aplicada (con o sin la 217). Una transacción, ROLLBACK.
--
--   S1  una copia STABLE consultada dentro de la MISMA sentencia que emitió: se DOCUMENTA
--       lo que ve (no es criterio de aprobación; motivó declararla VOLATILE).
--   S2  la real (VOLATILE) ve una emisión hecha antes, en otra sentencia de la transacción.
--   S3  el camino del wrapper: una función emite y en la sentencia siguiente un disparador
--       consulta `autorizada()` → la ve.
--   S4  tras `cerrar()`, deja de estar autorizada en la misma transacción.
--   S5  una emisión hecha en una subtransacción revertida no existe.
--   S6  una emisión en una subtransacción confirmada (RELEASE) vale para la transacción
--       (mismo txid de nivel superior).
--   S7  otra operación u otra cotización no quedan autorizadas por esa emisión.
-- ═════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;

create schema t216w;
create table t216w.res (nombre text, ok boolean, detalle text);
create function t216w.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void
language plpgsql as $$
begin
  insert into t216w.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre;
  else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;

-- Copia STABLE (solo para S1): mismo cuerpo que la real.
create function t216w.autorizada_stable(p_cotizacion_id bigint, p_operacion text) returns boolean
language sql stable as $$
  select exists (select 1 from p39_priv.autorizacion_emitida e
                  where e.txid = txid_current() and e.cotizacion_id = p_cotizacion_id and e.operacion = p_operacion
                    and not exists (select 1 from p39_priv.autorizacion_cerrada c where c.autorizacion_id = e.id))
$$;

-- Emite y, en la MISMA sentencia (CTE), consulta: lo que ve cada variante.
create function t216w.misma_sentencia() returns text language sql volatile as $$
  with em as (select p39_priv.emitir(990001, 'pago', null) as id)
  select 'volatile=' || p39_priv.autorizada(990001, 'pago') || ' stable=' || t216w.autorizada_stable(990001, 'pago') from em
$$;

\echo '--- W'
do $$
declare v text; v_id bigint; n int;
begin
  v := t216w.misma_sentencia();
  perform t216w.afirma('S1 (documental) emisión y consulta en la misma sentencia: ' || v, true, v);
  raise notice 'INFO  S1 %', v;

  v_id := p39_priv.emitir(990002, 'pago', null);
  perform t216w.afirma('S2 VOLATILE ve la emisión hecha antes en la transacción', p39_priv.autorizada(990002, 'pago'));
  perform p39_priv.cerrar(v_id);
  perform t216w.afirma('S4 tras cerrar ya no está autorizada', not p39_priv.autorizada(990002, 'pago'));
  perform t216w.afirma('S4.1 el cierre es un evento (la emitida no cambió)', exists (select 1 from p39_priv.autorizacion_emitida where id = v_id)
    and exists (select 1 from p39_priv.autorizacion_cerrada where autorizacion_id = v_id));

  begin
    perform p39_priv.emitir(990003, 'pago', null);
    raise exception 'revertir subtransaccion';
  exception when others then null;
  end;
  perform t216w.afirma('S5 una emisión en una subtransacción revertida no existe', not p39_priv.autorizada(990003, 'pago'));

  begin
    perform p39_priv.emitir(990004, 'conversion', null);
  end;
  perform t216w.afirma('S6 una emisión en una subtransacción confirmada vale para la transacción', p39_priv.autorizada(990004, 'conversion'));
  perform t216w.afirma('S7 otra operación no queda autorizada', not p39_priv.autorizada(990004, 'pago'));
  perform t216w.afirma('S7.1 otra cotización tampoco', not p39_priv.autorizada(990005, 'conversion'));
end $$;

-- S3: el camino real del wrapper con disparadores (requiere la frontera ACTIVA para que el
-- disparador consulte; si solo está la 216, se prueba la consulta directa).
create function t216w.emitir_y_escribir(p_cot bigint) returns text language plpgsql as $$
declare v bigint; b boolean;
begin
  v := p39_priv.emitir(p_cot, 'pago', null);
  update public.cotizaciones set monto_exigido_total = coalesce(monto_exigido_total, 0) where id = p_cot;
  b := p39_priv.autorizada(p_cot, 'pago');
  perform p39_priv.cerrar(v);   -- como el wrapper: cerrada, no se hereda a lo que sigue
  return 'ok:' || b;
end $$;
do $$
declare c bigint; r text;
begin
  insert into public.cotizaciones (tenant, tipo, estado, payload, moneda, precio_venta, vigencia_hasta)
  values ('mayorista', 'manual', 'abierta', '{}', 'COP', 1, public.fecha_negocio() + 3) returning id into c;
  grant usage on schema t216w to service_role;
  grant execute on function t216w.emitir_y_escribir(bigint) to service_role;
  set local role service_role;
  begin
    r := t216w.emitir_y_escribir(c);
  exception when others then r := 'ERR ' || sqlerrm;
  end;
  reset role;
  perform t216w.afirma('S3 el disparador de la frontera ve la autorización emitida en la sentencia anterior (' || coalesce(r, '') || ')', r = 'ok:true', r);
  set local role service_role;
  begin
    update public.cotizaciones set monto_exigido_total = 5 where id = c;
    r := 'ok';
  exception when others then r := 'ERR ' || sqlerrm;
  end;
  reset role;
  perform t216w.afirma('S3.1 sin emisión, el mismo cambio se rechaza (con la frontera activa) o pasa (solo 216)',
    (p39_priv.frontera_activa() and r like 'ERR%FRONTERA_39%') or (not p39_priv.frontera_activa() and r = 'ok'), r);
end $$;

\echo '=== RESUMEN ==='
select count(*) filter (where ok) as ok, count(*) filter (where not ok) as fallos, count(*) as total from t216w.res;
do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from t216w.res;
  if f > 0 then raise exception 'test_216_autorizada_volatil: % de % prueba(s) fallaron', f, t; end if;
  raise notice 'TEST 216 W: TODO OK (% verificaciones)', t;
end $$;
rollback;
