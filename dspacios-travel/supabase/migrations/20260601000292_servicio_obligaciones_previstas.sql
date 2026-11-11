-- ───────────────────────────────────────────────────────────────────────────
-- 292 · Servicios con obligaciones PREVISTAS (#75, cierre del bloqueo abierto por la 288) — SIN APLICAR
--
-- PROBLEMA: desde la 288 un contrato PENDIENTE no tiene CxP exigibles: lo que antes era una CxP vive en `contrato_obligaciones_previstas` (payload jsonb).
-- Las protecciones de la 265 solo miran `cuentas_por_pagar`:
--   · borrar del catálogo un servicio vendido (ON DELETE SET NULL de contrato_servicios.servicio_id) o borrar/cambiar la línea de traslado por alcance
--     que la prevista enlaza (clave « · enlace:<uuid>») ya no se rechazaba, y
--   · la prevista conservaba un servicio_id o una clave que ya no existen: al CONFIRMAR, la materialización fallaba (FK de servicio_id o
--     tg_cxp_enlace_por_clave) y el contrato no se podía confirmar; o, si la prevista no estaba enlazada, la reconciliación por servicio la perdía.
-- REGLA: una prevista sin materializar protege su servicio y su línea EXACTAMENTE como la CxP que va a ser. La protección es de la base; el aviso de
-- eliminarServicio solo anticipa el motivo.
--
-- QUÉ HACE (aditiva; no toca la 265 aplicada: solo reemplaza con `create or replace` su función de trigger, cuyo md5 se comprueba antes):
--   1) p75_priv.clave_enlace_de(text): la MISMA extracción de la clave que tg_cxp_enlace_por_clave (265).
--   2) tg_linea_enlazada_protegida (265) + previstas: una línea enlazada a una prevista sin materializar no se borra ni cambia de alcance/servicio/clave
--      mientras exista su contrato. Eliminar el contrato (287/289: la venta desaparece y todo cae en cascada) sigue permitido.
--   3) servicio_con_previstas (BEFORE DELETE en servicios_adicionales): no se elimina un servicio con previstas sin materializar (enlazadas o no:
--      la reconciliación de servicios de un pendiente las identifica por servicio_id; anularlas en silencio las dejaría huérfanas).
--   4) prevista_valida (BEFORE INSERT/UPDATE OF payload en contrato_obligaciones_previstas): la prevista se valida como la CxP que será
--      (mismo contrato en el payload; servicio existente; clave → línea existente del MISMO contrato y servicio, con alcance) y BLOQUEA lo que enlaza
--      (línea FOR UPDATE, como la 265; servicio FOR KEY SHARE, como una FK). Así un borrado concurrente espera y luego ve la prevista, o la prevista
--      ve el borrado y falla: no hay carrera que deje una prevista huérfana.
-- Lo que NO cambia: autorización (RLS y grants de siempre; las funciones de trigger no son ejecutables por la API), identidad (guardas 284/285 de cada
-- tabla), la edición autorizada de servicios de un pendiente (pendiente_aplicar_servicios quita la prevista en su transacción; la línea, sin
-- prevista ni CxP, queda libre igual que antes de la 288), la materialización y eliminar_contrato (289).
--
-- ORDEN: inmediatamente después de la 288, ANTES de la 286 y antes de desplegar el código (preflight_292 → 292 → postcheck_292). La migración se
-- aborta sin modificar nada si encuentra previstas que YA violan la regla (p. ej. creadas en la ventana 288→292): esas se revisan, no se corrigen solas.
-- Rollback: supabase/scripts/rollback_292_servicio_obligaciones_previstas.sql.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
declare n_malas integer;
begin
  if to_regclass('public.contrato_obligaciones_previstas') is null then
    raise exception '292 ABORTADA SIN MODIFICAR NADA: falta la 288 (contrato_obligaciones_previstas).';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'linea_enlazada_protegida' and tgrelid = 'public.contrato_servicios'::regclass and not tgisinternal) then
    raise exception '292 ABORTADA SIN MODIFICAR NADA: falta la 265 (trigger linea_enlazada_protegida).';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'servicio_con_previstas' and not tgisinternal) then
    raise exception '292: ya aplicada (existe el trigger servicio_con_previstas). No se re-aplica.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.tg_linea_enlazada_protegida()')) is distinct from '336c54ae9bd8a9bfacd3127ed7e7d7b7' then
    raise exception '292 ABORTADA SIN MODIFICAR NADA: tg_linea_enlazada_protegida no es la de la 265 (md5 esperado 336c54ae9bd8a9bfacd3127ed7e7d7b7). No se reemplaza una versión distinta.';
  end if;
  -- Previstas que YA violan la regla (misma comprobación que preflight_292, punto 3): no se aplica sobre datos rotos.
  select count(*) into n_malas
    from public.contrato_obligaciones_previstas p
    left join lateral (select substring(coalesce(p.payload->>'observaciones', '') from 'enlace:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*$') as clave) k on true
    left join public.contrato_servicios cs on cs.clave_enlace = k.clave::uuid
   where p.materializada_en is null
     and (   (nullif(p.payload->>'numero_contrato', '') is not null and p.payload->>'numero_contrato' <> p.numero_contrato)
          or (nullif(p.payload->>'servicio_id', '') is not null and not exists (select 1 from public.servicios_adicionales s where s.id = (p.payload->>'servicio_id')::bigint))
          or (k.clave is null and nullif(p.payload->>'contrato_servicio_id', '') is not null)
          or (k.clave is not null and (cs.id is null or cs.numero_contrato <> p.numero_contrato or cs.servicio_id is distinct from nullif(p.payload->>'servicio_id', '')::bigint
                                       or cs.alcance_traslado is null or (nullif(p.payload->>'contrato_servicio_id', '') is not null and (p.payload->>'contrato_servicio_id')::bigint <> cs.id))));
  if n_malas > 0 then
    raise exception '292 ABORTADA SIN MODIFICAR NADA: % obligación(es) prevista(s) sin materializar ya apuntan a un servicio o línea inexistente o ajena. Revisarlas con preflight_292 antes de aplicar.', n_malas;
  end if;
end $$;

-- ── 1) La clave de enlace de un texto de observaciones (idéntica a la de tg_cxp_enlace_por_clave, 265) ─────────────────────────────
create or replace function p75_priv.clave_enlace_de(p_obs text) returns uuid
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select substring(coalesce(p_obs, '') from 'enlace:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*$')::uuid
$$;
revoke all on function p75_priv.clave_enlace_de(text) from public, anon, authenticated;

-- ¿La línea tiene una prevista SIN materializar que la enlaza (por id o por su clave)? Solo la usan los triggers de abajo.
create or replace function p75_priv.prevista_enlaza_linea(p_numero text, p_linea bigint, p_clave uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.contrato_obligaciones_previstas p
                  where p.numero_contrato = p_numero and p.clase = 'cxp' and p.materializada_en is null
                    and (p.payload->>'contrato_servicio_id' = p_linea::text or (p_clave is not null and p75_priv.clave_enlace_de(p.payload->>'observaciones') = p_clave)))
$$;
revoke all on function p75_priv.prevista_enlaza_linea(text, bigint, uuid) from public, anon, authenticated;

create index if not exists contrato_obligaciones_previstas_servicio_idx
  on public.contrato_obligaciones_previstas ((payload->>'servicio_id')) where materializada_en is null;

-- ── 2) Línea enlazada protegida (265) — ahora también por su obligación PREVISTA ───────────────────────────────────────────────
create or replace function public.tg_linea_enlazada_protegida()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_cxp boolean; v_prev boolean;
begin
  if coalesce(current_setting('app.enlace_cxp_autorizado', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_cxp := exists (select 1 from public.cuentas_por_pagar c where c.contrato_servicio_id = old.id);
  v_prev := not v_cxp and p75_priv.prevista_enlaza_linea(old.numero_contrato, old.id, old.clave_enlace);   -- 292
  if not v_cxp and not v_prev then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.ventas v where v.numero_contrato = old.numero_contrato) then
      if v_cxp then
        raise exception 'contrato_servicios: la línea tiene una cuenta por pagar enlazada y no se puede borrar' using errcode = '23503';
      end if;
      raise exception 'contrato_servicios: la línea tiene una obligación prevista enlazada (su cuenta por pagar al confirmar) y no se puede borrar' using errcode = '23503';
    end if;
    return old;
  end if;
  if new.alcance_traslado is distinct from old.alcance_traslado or new.servicio_id is distinct from old.servicio_id or new.clave_enlace is distinct from old.clave_enlace then
    if v_cxp then
      raise exception 'contrato_servicios: el alcance, el servicio y la clave de una línea con cuenta por pagar enlazada no se editan' using errcode = '42501';
    end if;
    raise exception 'contrato_servicios: el alcance, el servicio y la clave de una línea con obligación prevista enlazada no se editan' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.tg_linea_enlazada_protegida() from public, anon, authenticated;

-- ── 3) Un servicio del catálogo con previstas sin materializar no se elimina ─────────────────────────────────────────────────────
create or replace function public.tg_servicio_con_previstas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Corre DESPUÉS de bloquear la fila del servicio: una prevista que se estaba creando con FOR KEY SHARE ya terminó y aquí se ve (READ COMMITTED).
  if exists (select 1 from public.contrato_obligaciones_previstas p
              where p.materializada_en is null and p.clase = 'cxp' and p.payload->>'servicio_id' = old.id::text) then
    raise exception 'servicios_adicionales: el servicio % tiene obligaciones previstas de contratos pendientes y no se puede eliminar', old.id using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke all on function public.tg_servicio_con_previstas() from public, anon, authenticated;
drop trigger if exists servicio_con_previstas on public.servicios_adicionales;
create trigger servicio_con_previstas before delete on public.servicios_adicionales for each row execute function public.tg_servicio_con_previstas();

-- ── 4) La prevista se valida como la CxP que será, y bloquea lo que enlaza ────────────────────────────────────────────────────────
create or replace function public.tg_prevista_valida()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_srv bigint; v_clave uuid; v_cs record;
begin
  if new.materializada_en is not null then return new; end if;   -- lo materializado ya es una CxP real y la protegen la 265 y sus FK
  if nullif(new.payload->>'numero_contrato', '') is not null and new.payload->>'numero_contrato' <> new.numero_contrato then
    raise exception 'contrato_obligaciones_previstas: el payload es de otro contrato (%)', new.payload->>'numero_contrato' using errcode = '23514';
  end if;
  v_srv := nullif(new.payload->>'servicio_id', '')::bigint;
  v_clave := p75_priv.clave_enlace_de(new.payload->>'observaciones');
  if v_clave is null then
    if nullif(new.payload->>'contrato_servicio_id', '') is not null or nullif(new.payload->>'alcance_traslado', '') is not null then
      raise exception 'contrato_obligaciones_previstas: el vínculo con una línea de servicio y el alcance solo se asignan con una clave de enlace verificable' using errcode = '23514';
    end if;
  else
    -- Mismo orden de bloqueo que la CxP al materializarse (línea y luego servicio): sin abrazos mortales con confirmar_venta.
    select cs.id, cs.numero_contrato, cs.servicio_id, cs.alcance_traslado into v_cs
      from public.contrato_servicios cs where cs.clave_enlace = v_clave for update;
    if not found then
      raise exception 'contrato_obligaciones_previstas: la clave de enlace % no corresponde a ninguna línea de servicio', v_clave using errcode = '23503';
    end if;
    if v_cs.numero_contrato is distinct from new.numero_contrato then
      raise exception 'contrato_obligaciones_previstas: la clave de enlace % pertenece a otro contrato', v_clave using errcode = '23514';
    end if;
    if v_cs.servicio_id is distinct from v_srv then
      raise exception 'contrato_obligaciones_previstas: la clave de enlace % es de otro servicio del catálogo', v_clave using errcode = '23514';
    end if;
    if v_cs.alcance_traslado is null then
      raise exception 'contrato_obligaciones_previstas: la línea de la clave % no tiene alcance vendido', v_clave using errcode = '23514';
    end if;
    if nullif(new.payload->>'contrato_servicio_id', '') is not null and (new.payload->>'contrato_servicio_id')::bigint <> v_cs.id then
      raise exception 'contrato_obligaciones_previstas: el vínculo declarado no es la línea de la clave %', v_clave using errcode = '23514';
    end if;
  end if;
  if v_srv is not null then
    perform 1 from public.servicios_adicionales s where s.id = v_srv for key share;   -- lo que haría una FK: el borrado concurrente espera
    if not found then
      raise exception 'contrato_obligaciones_previstas: el servicio % del catálogo no existe', v_srv using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.tg_prevista_valida() from public, anon, authenticated;
drop trigger if exists prevista_valida on public.contrato_obligaciones_previstas;
create trigger prevista_valida before insert or update of payload on public.contrato_obligaciones_previstas for each row execute function public.tg_prevista_valida();

comment on function public.tg_prevista_valida() is 'Migración 292 (#75): una obligación prevista se valida y bloquea su servicio y su línea como la CxP que será.';
comment on function public.tg_servicio_con_previstas() is 'Migración 292 (#75): un servicio con obligaciones previstas sin materializar no se elimina del catálogo.';
commit;
