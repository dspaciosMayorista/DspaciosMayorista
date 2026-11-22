-- 313 · #126-A (Codex ronda 2, F3) · La moneda del pago se registra EN LA MISMA operación atómica del abono, con identidad, autorización y repetición idéntica/conflictiva decididas por la base.
-- Antes (solo en el repo, nunca desplegado): la app llamaba `registrar_abono` y LUEGO hacía un UPDATE aparte de `abonos.moneda_pago`. Un corte entre las dos peticiones dejaba un pago en dólares con
-- moneda NULL (que los lectores interpretan como pesos recibidos), y un reintento de la MISMA operación con otra moneda reescribía la moneda de un abono ya existente.
-- Esta migración NO toca `registrar_abono` (288, aplicada, inmutable) ni la 312 (columna): AGREGA
--   · `registrar_abono_moneda(...)`: envoltorio de UNA sola transacción. Fija la moneda en una variable local de la transacción, llama a `registrar_abono` (que valida actor, agencia, identidad del contrato,
--     idempotencia por huella, confirmación y asiento) y el disparador de inserción de abajo estampa `moneda_pago` en la propia fila al nacer. No hay segunda escritura.
--   · Repetición de la misma operación: devuelve el resultado original (`ya_registrado`) SOLO si la moneda coincide; si la moneda pedida difiere de la guardada (incluido NULL contra un valor) se rechaza con
--     FIN_MONEDA_DISTINTA y la transacción entera se revierte (ni el reintento de asiento ni el de confirmación quedan escritos).
--   · La moneda solo se admite en contratos cobrados en USD (misma regla de moneda de cobro que `registrar_abono`), y solo COP/USD.
--   · Identidad: el envoltorio verifica la identidad del contrato (cabecera `x-contratos`) también en la repetición, que no escribe y por eso no activa la guarda de inserción.
--   · Inmutabilidad: una vez escrita, `moneda_pago` no cambia por UPDATE (una fila NULL tampoco se «completa» después: los abonos históricos conservan su interpretación).
-- Sin backfill, sin recálculo. Aditiva e idempotente. Orden: preflight → 312 → postcheck 312 → preflight 313 → 313 → postcheck 313 → código. El código nuevo llama a la función nueva: SIN esta migración todo registro de abono falla.
do $$
begin
  if to_regprocedure('public.registrar_abono(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid)') is null then
    raise exception '313: falta public.registrar_abono (248/288).';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'abonos' and column_name = 'moneda_pago') then
    raise exception '313: falta abonos.moneda_pago (migración 312). Aplicarla antes.';
  end if;
end $$;

-- Disparador: estampa la moneda al NACER la fila (solo cuando la fija el envoltorio, dentro de su transacción y para el contrato que está registrando) y la vuelve inmutable.
create or replace function public.f313_abonos_moneda() returns trigger
language plpgsql set search_path = '' as $$
declare v_m text;
begin
  if tg_op = 'INSERT' then
    v_m := nullif(pg_catalog.current_setting('app.abono_moneda_pago', true), '');
    if v_m is not null and pg_catalog.current_setting('app.registro_abono', true) is not distinct from new.numero_contrato then
      new.moneda_pago := v_m;
    end if;
  elsif new.moneda_pago is distinct from old.moneda_pago then
    raise exception 'FIN_MONEDA_INMUTABLE: la moneda en que llegó el pago del abono % no se cambia.', old.id using errcode = 'F4469';
  end if;
  return new;
end $$;
revoke all on function public.f313_abonos_moneda() from public, anon, authenticated;
drop trigger if exists trg_f313_abonos_moneda on public.abonos;
create trigger trg_f313_abonos_moneda before insert or update on public.abonos
  for each row execute function public.f313_abonos_moneda();

create or replace function public.registrar_abono_moneda(p_numero text, p_tenant text, p_actor uuid, p_monto_cop numeric, p_trm numeric, p_forma text, p_ref text, p_fecha date, p_confirmar boolean, p_operacion uuid, p_moneda_pago text)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
declare
  r jsonb; v public.ventas; v_mo text; v_mc text; v_cobro text; v_guardada text; v_id bigint;
begin
  if p_moneda_pago is not null and p_moneda_pago not in ('COP', 'USD') then
    raise exception 'FIN_MONEDA_INVALIDA: la moneda del pago debe ser COP o USD.' using errcode = 'F4470';
  end if;
  -- Identidad del contrato que la pantalla abrió: la guarda de `abonos` solo dispara al ESCRIBIR; una repetición idéntica no escribe, así que se verifica aquí, antes de cualquier efecto.
  perform public.contrato_verificar_identidad(p_numero, true);
  perform pg_catalog.set_config('app.abono_moneda_pago', coalesce(p_moneda_pago, ''), true);
  r := public.registrar_abono(p_numero, p_tenant, p_actor, p_monto_cop, p_trm, p_forma, p_ref, p_fecha, p_confirmar, p_operacion);
  perform pg_catalog.set_config('app.abono_moneda_pago', '', true);

  if r->>'estado' in ('registrado', 'ya_registrado') then
    v_id := (r->>'abono_id')::bigint;
    select * into v from public.ventas where numero_contrato = p_numero;   -- la venta sigue bloqueada por registrar_abono
    -- Moneda de cobro del contrato: la misma regla que `registrar_abono` (la moneda de la oferta, salvo cobro congelado en la otra).
    v_mo := case when upper(coalesce(v.moneda, 'COP')) = 'USD' then 'USD' else 'COP' end;
    v_mc := case when v.moneda_cobro is null then null when upper(v.moneda_cobro) = 'USD' then 'USD' else 'COP' end;
    v_cobro := case when v_mc is not null and v_mc <> v_mo and coalesce(v.total_cobro, 0) > 0 and coalesce(v.trm_cobro, 0) > 0 then v_mc else v_mo end;
    if p_moneda_pago is not null and v_cobro <> 'USD' then
      raise exception 'FIN_MONEDA_NO_APLICA: la moneda del pago solo se registra en contratos cobrados en USD.' using errcode = 'F4471';
    end if;
    select a.moneda_pago into v_guardada from public.abonos a where a.id = v_id and a.numero_contrato = p_numero;
    if not found then
      raise exception 'FIN_ABONO_NO_ENCONTRADO: el abono % de la operación no existe en el contrato %.', v_id, p_numero using errcode = 'F4468';
    end if;
    -- Alta nueva: el disparador ya lo estampó. Repetición: debe ser EXACTAMENTE la misma moneda; si no, se revierte todo (incluidos el reintento de asiento y de confirmación).
    if v_guardada is distinct from p_moneda_pago then
      raise exception 'FIN_MONEDA_DISTINTA: esa operación ya se registró con otra moneda de pago (%); genera una operación nueva.', coalesce(v_guardada, 'sin moneda') using errcode = 'F4472';
    end if;
  end if;
  return r;
end $function$;
revoke all on function public.registrar_abono_moneda(text, text, uuid, numeric, numeric, text, text, date, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.registrar_abono_moneda(text, text, uuid, numeric, numeric, text, text, date, boolean, uuid, text) to service_role;
comment on function public.registrar_abono_moneda(text, text, uuid, numeric, numeric, text, text, date, boolean, uuid, text) is
  '313 (#126): registrar_abono + moneda en que llegó el dinero en UNA transacción (la moneda nace con la fila; repetición con otra moneda se rechaza). Solo service_role.';
