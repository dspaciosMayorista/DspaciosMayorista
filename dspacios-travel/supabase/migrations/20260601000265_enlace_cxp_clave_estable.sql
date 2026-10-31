-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 265 (PROVISIONAL, NO APLICADA) — enlace contrato_servicios <-> CxP con CLAVE ESTABLE y verificable (reemplaza el enlace por descripción de la 264).
-- Depende de la 262 y la 264. Número provisional: 257/260/261 existen en otras ramas; nadie usa 263–265 fuera de esta rama (revisado en local).
--
-- Por qué: la 264 enlazaba por igualdad de descripción; dos servicios con la misma descripción eran ambiguos y una segunda CxP idéntica quedaba SIN enlace en
-- silencio. Aquí la identidad es una clave explícita:
--  · cada línea con alcance lleva `clave_enlace uuid` (única), generada por la conversión;
--  · la conversión pone esa clave como sufijo de `cuentas_por_pagar.observaciones` (` · enlace:<uuid>`). La RPC financiera copia `observaciones` tal cual en AMBAS rutas
--    (registrar_financiero_contrato y p63_registrar_financiero), y su borrado de reintento usa el prefijo `like marca_cxp_automatica()||'%'`; el reintento del cron repite el
--    MISMO payload guardado (con la clave). Por eso NO se reemplaza la RPC;
--  · el trigger BEFORE INSERT verifica la clave: la línea debe existir, ser del mismo contrato y del mismo servicio_id, tener alcance y no tener ya otra CxP; si algo no
--    cuadra, EXCEPCIÓN (la RPC y la conversión se revierten). Una CxP no puede traer vínculo ni alcance por su cuenta (sin clave verificable se rechaza).
--  · el vínculo y el alcance de una CxP emitida NO se pueden cambiar por UPDATE: solo con la función autorizada `corregir_enlace_cxp_alcance` (superadmin/gerencia, valida
--    contrato, servicio, alcance y unicidad). Tampoco se puede cambiar alcance/servicio/clave de una línea ya enlazada, ni borrarla mientras exista su contrato.
--  · garantía final: un contrato no pasa a financiero 'completo' si una línea con alcance y costo > 0 quedó sin su CxP (la excepción deshace la RPC entera).
-- Datos legados: sin clave no hay enlace (nada se infiere por descripción). Rollback: supabase/scripts/rollback_265_enlace_cxp_clave_estable.sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cuentas_por_pagar' and column_name = 'contrato_servicio_id') then
    raise exception '265 ABORTADA SIN MODIFICAR NADA: falta cuentas_por_pagar.contrato_servicio_id (aplica antes la 264).';
  end if;
  if to_regprocedure('public.marca_cxp_automatica()') is null then
    raise exception '265 ABORTADA SIN MODIFICAR NADA: falta marca_cxp_automatica() (171).';
  end if;
end $$;

-- 1) Clave estable de la línea
alter table public.contrato_servicios add column if not exists clave_enlace uuid;
create unique index if not exists uq_contrato_servicios_clave_enlace on public.contrato_servicios(clave_enlace) where clave_enlace is not null;
comment on column public.contrato_servicios.clave_enlace is 'Clave estable (265) con la que la CxP de esta línea se vincula: viaja como sufijo « · enlace:<uuid>» de cuentas_por_pagar.observaciones.';

-- 2) Retira el enlace por descripción de la 264
drop trigger if exists cxp_enlazar_servicio_alcance on public.cuentas_por_pagar;
drop function if exists public.tg_cxp_enlazar_servicio_alcance();

-- 3) Enlace por clave al INSERTAR la CxP (verifica y falla; nunca queda sin enlace en silencio ni se enlaza por inferencia)
create or replace function public.tg_cxp_enlace_por_clave()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_txt text;
  v_cs  record;
begin
  v_txt := substring(coalesce(new.observaciones, '') from 'enlace:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*$');
  if v_txt is null then
    if new.contrato_servicio_id is not null or new.alcance_traslado is not null then
      raise exception 'cuentas_por_pagar: el vínculo con una línea de servicio y el alcance solo se asignan con una clave de enlace verificable' using errcode = '23514';
    end if;
    return new;
  end if;
  select cs.id, cs.numero_contrato, cs.servicio_id, cs.alcance_traslado into v_cs
    from public.contrato_servicios cs where cs.clave_enlace = v_txt::uuid for update;
  if not found then
    raise exception 'cuentas_por_pagar: la clave de enlace % no corresponde a ninguna línea de servicio', v_txt using errcode = '23503';
  end if;
  if v_cs.numero_contrato is distinct from new.numero_contrato then
    raise exception 'cuentas_por_pagar: la clave de enlace % pertenece a otro contrato', v_txt using errcode = '23514';
  end if;
  if v_cs.servicio_id is distinct from new.servicio_id then
    raise exception 'cuentas_por_pagar: la clave de enlace % es de otro servicio del catálogo', v_txt using errcode = '23514';
  end if;
  if v_cs.alcance_traslado is null then
    raise exception 'cuentas_por_pagar: la línea de la clave % no tiene alcance vendido', v_txt using errcode = '23514';
  end if;
  if exists (select 1 from public.cuentas_por_pagar c where c.contrato_servicio_id = v_cs.id) then
    raise exception 'cuentas_por_pagar: la línea de la clave % ya tiene una cuenta por pagar', v_txt using errcode = '23505';
  end if;
  new.contrato_servicio_id := v_cs.id;
  new.alcance_traslado := v_cs.alcance_traslado;
  return new;
end;
$$;
revoke all on function public.tg_cxp_enlace_por_clave() from public, anon, authenticated;
drop trigger if exists cxp_enlace_por_clave on public.cuentas_por_pagar;
create trigger cxp_enlace_por_clave before insert on public.cuentas_por_pagar for each row execute function public.tg_cxp_enlace_por_clave();

-- 4) El vínculo y el alcance de una CxP emitida no cambian por UPDATE (salvo la función autorizada o el borrado de su línea por FK)
create or replace function public.tg_cxp_enlace_inmutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.contrato_servicio_id is not distinct from old.contrato_servicio_id and new.alcance_traslado is not distinct from old.alcance_traslado then
    return new;
  end if;
  if coalesce(current_setting('app.enlace_cxp_autorizado', true), '') = 'on' then
    return new;
  end if;
  -- ON DELETE SET NULL por el borrado de la línea (cascada del contrato): el alcance se conserva
  if new.contrato_servicio_id is null and old.contrato_servicio_id is not null and new.alcance_traslado is not distinct from old.alcance_traslado
     and not exists (select 1 from public.contrato_servicios cs where cs.id = old.contrato_servicio_id) then
    return new;
  end if;
  raise exception 'cuentas_por_pagar: el alcance y el vínculo con la línea de servicio no se editan; usa corregir_enlace_cxp_alcance' using errcode = '42501';
end;
$$;
revoke all on function public.tg_cxp_enlace_inmutable() from public, anon, authenticated;
drop trigger if exists cxp_enlace_inmutable on public.cuentas_por_pagar;
create trigger cxp_enlace_inmutable before update of contrato_servicio_id, alcance_traslado on public.cuentas_por_pagar for each row execute function public.tg_cxp_enlace_inmutable();

-- 5) Una línea ya enlazada no cambia de alcance/servicio/clave ni se borra mientras exista su contrato
create or replace function public.tg_linea_enlazada_protegida()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.enlace_cxp_autorizado', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if not exists (select 1 from public.cuentas_por_pagar c where c.contrato_servicio_id = old.id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.ventas v where v.numero_contrato = old.numero_contrato) then
      raise exception 'contrato_servicios: la línea tiene una cuenta por pagar enlazada y no se puede borrar' using errcode = '23503';
    end if;
    return old;
  end if;
  if new.alcance_traslado is distinct from old.alcance_traslado or new.servicio_id is distinct from old.servicio_id or new.clave_enlace is distinct from old.clave_enlace then
    raise exception 'contrato_servicios: el alcance, el servicio y la clave de una línea con cuenta por pagar enlazada no se editan' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.tg_linea_enlazada_protegida() from public, anon, authenticated;
drop trigger if exists linea_enlazada_protegida on public.contrato_servicios;
create trigger linea_enlazada_protegida before update or delete on public.contrato_servicios for each row execute function public.tg_linea_enlazada_protegida();

-- 6) Operación autorizada y validada para corregir (o quitar) el vínculo de una CxP emitida
create or replace function public.corregir_enlace_cxp_alcance(p_cxp_id bigint, p_contrato_servicio_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c  record;
  v_cs record;
begin
  if public.mi_rol() is null or public.mi_rol() not in ('superadmin', 'gerencia') then
    raise exception 'No autorizado para corregir el enlace de una cuenta por pagar.' using errcode = '42501';
  end if;
  select c.id, c.numero_contrato, c.servicio_id into v_c from public.cuentas_por_pagar c where c.id = p_cxp_id for update;
  if not found then raise exception 'Cuenta por pagar no encontrada.' using errcode = 'P0002'; end if;
  perform set_config('app.enlace_cxp_autorizado', 'on', true);
  if p_contrato_servicio_id is null then
    update public.cuentas_por_pagar set contrato_servicio_id = null, alcance_traslado = null where id = p_cxp_id;
  else
    select cs.id, cs.numero_contrato, cs.servicio_id, cs.alcance_traslado into v_cs from public.contrato_servicios cs where cs.id = p_contrato_servicio_id for update;
    if not found then raise exception 'Línea de servicio no encontrada.' using errcode = 'P0002'; end if;
    if v_cs.numero_contrato is distinct from v_c.numero_contrato then raise exception 'La línea es de otro contrato.' using errcode = '23514'; end if;
    if v_cs.servicio_id is distinct from v_c.servicio_id then raise exception 'La línea es de otro servicio del catálogo.' using errcode = '23514'; end if;
    if v_cs.alcance_traslado is null then raise exception 'La línea no tiene alcance vendido.' using errcode = '23514'; end if;
    if exists (select 1 from public.cuentas_por_pagar c where c.contrato_servicio_id = v_cs.id and c.id <> p_cxp_id) then
      raise exception 'La línea ya tiene otra cuenta por pagar.' using errcode = '23505';
    end if;
    update public.cuentas_por_pagar set contrato_servicio_id = v_cs.id, alcance_traslado = v_cs.alcance_traslado where id = p_cxp_id;
  end if;
  perform set_config('app.enlace_cxp_autorizado', 'off', true);
end;
$$;
revoke all on function public.corregir_enlace_cxp_alcance(bigint, bigint) from public, anon;
grant execute on function public.corregir_enlace_cxp_alcance(bigint, bigint) to authenticated;

-- 7) Garantía final: no se completa el financiero con un traslado por alcance (costo > 0) sin su CxP enlazada
create or replace function public.tg_ventas_completo_exige_enlaces()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.financiero_estado = 'completo' and old.financiero_estado is distinct from 'completo' then
    if exists (
      select 1 from public.contrato_servicios cs
       where cs.numero_contrato = new.numero_contrato and cs.alcance_traslado is not null and coalesce(cs.costo, 0) > 0
         and not exists (select 1 from public.cuentas_por_pagar c where c.contrato_servicio_id = cs.id)
    ) then
      raise exception 'financiero incompleto: un traslado por alcance con costo no quedó enlazado a su cuenta por pagar (contrato %)', new.numero_contrato using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.tg_ventas_completo_exige_enlaces() from public, anon, authenticated;
drop trigger if exists ventas_completo_exige_enlaces on public.ventas;
create trigger ventas_completo_exige_enlaces before update of financiero_estado on public.ventas for each row
  when (new.financiero_estado = 'completo' and old.financiero_estado is distinct from 'completo') execute function public.tg_ventas_completo_exige_enlaces();

commit;
