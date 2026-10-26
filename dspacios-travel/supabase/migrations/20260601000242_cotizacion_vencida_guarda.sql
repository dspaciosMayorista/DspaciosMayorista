-- ───────────────────────────────────────────────────────────────────────────
-- 242 · #40 E3 · Una cotización ABIERTA vencida no se convierte en contrato (guarda autoritativa en la base).
--
-- Regla: `cotizaciones.estado = 'abierta'` y `vigencia_hasta < public.fecha_negocio()` (día de negocio de Bogotá, 198) ⇒ se rechaza ANTES de
-- numerar (el consecutivo es una secuencia: no se devuelve), de reservar sillas y de crear contrato, CxP y asientos. El día indicado sigue
-- válido. `vigencia_hasta` nula (cotización histórica) NO vence por inferencia. Una cotización ya convertida o con aceptación #63 preparada
-- sigue su reintento: lo ya numerado no se abandona por haber cruzado la medianoche.
--
-- Las dos puertas de base que numeran una cotización:
--   · `convertir_cotizacion_manual_controlada` (única puerta de la 198 desde la 216/217): se re-crea idéntica a la 241 con UNA línea nueva
--     (`p40_exigir_cotizacion_vigente`) antes de `validar_conversion` y de emitir la autorización.
--   · `aceptar_oferta_63` (#63): se RENOMBRA a `p40_aceptar_oferta_63_base` (cuerpo intacto, sin EXECUTE para nadie salvo su dueño) y una
--     envoltura con la MISMA firma, SECURITY DEFINER, aplica la guarda y delega. No se copia su cuerpo (≈230 líneas) para no divergir de la 235.
-- Las demás rutas (carrito, tarifario sin oferta #63) numeran en el servidor y la guarda vive en su Server Action.
--
-- Aditiva: sin tablas ni columnas nuevas. Antes: supabase/scripts/preflight_242_cotizacion_vencida.sql · Después: postcheck_242_cotizacion_vencida.sql
-- Rollback: supabase/scripts/rollback_242_cotizacion_vencida.sql · Prueba local: supabase/scripts/test_242_cotizacion_vencida.sh
-- ───────────────────────────────────────────────────────────────────────────
begin;

create or replace function public.p40_exigir_cotizacion_vigente(p_cotizacion bigint)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_estado text;
  v_vigencia date;
  v_hoy date := public.fecha_negocio();
begin
  select c.estado, c.vigencia_hasta into v_estado, v_vigencia from public.cotizaciones c where c.id = p_cotizacion;
  if not found then
    return;  -- la función protegida rechaza la inexistente con su propio mensaje
  end if;
  if v_estado = 'abierta' and v_vigencia is not null and v_vigencia < v_hoy then
    raise exception 'COTIZACION_VENCIDA: la cotización % venció el % (hoy en Bogotá: %); renueva su vigencia o genera una cotización nueva.',
      p_cotizacion, v_vigencia, v_hoy using errcode = 'P0001';
  end if;
end $$;

comment on function public.p40_exigir_cotizacion_vigente(bigint) is
  '242 (#40 E3): rechaza una cotización ABIERTA con vigencia_hasta anterior al día de negocio de Bogotá; nula = histórica, no vence. Se llama ANTES de numerar. Solo service_role.';
revoke all on function public.p40_exigir_cotizacion_vigente(bigint) from public, anon, authenticated;
grant execute on function public.p40_exigir_cotizacion_vigente(bigint) to service_role;

-- ── Conversión manual: copia de la 241 + la guarda ──────────────────────────────────────────────────────────────
create or replace function public.convertir_cotizacion_manual_controlada(
  p_cotizacion_id bigint, p_usuario_id uuid
) returns text
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_tipo text;
  v_modo text;
  v_aut bigint;
  v_res text;
begin
  select c.tipo, c.modo into v_tipo, v_modo from public.cotizaciones c where c.id = p_cotizacion_id for update;
  if not found then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  if v_modo = 'comparativa' then
    raise exception 'COMPARATIVA_NO_COBRABLE: una comparativa no se convierte en contrato; elige una opción primero.' using errcode = 'P0001';
  end if;
  if v_tipo is distinct from 'manual' then
    raise exception 'Solo las cotizaciones dinámicas se convierten por esta vía.' using errcode = 'P0001';
  end if;
  -- Ya convertida: la 198 devuelve el número existente sin escribir nada.
  if exists (select 1 from public.ventas v where v.cotizacion_id = p_cotizacion_id) then
    return public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);
  end if;
  -- 242 (#40 E3): una abierta vencida se rechaza ANTES de numerar (la 198 toma el consecutivo y no lo devuelve).
  perform public.p40_exigir_cotizacion_vigente(p_cotizacion_id);
  -- #50: todo rechazo nuevo ANTES de numerar (la 198 toma el consecutivo y no lo devuelve).
  perform p50_priv.validar_conversion(p_cotizacion_id, p_usuario_id);
  v_aut := p39_priv.emitir(p_cotizacion_id, 'conversion', p_usuario_id);
  v_res := public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);
  perform p50_priv.completar_conversion(p_cotizacion_id, v_res);
  -- 241: el tipo elegido para el titular en la cotización pasa al contrato junto al número que ya copió la 198 (mismo número con CC y con CE no se confunden).
  update public.ventas v
     set cliente_tipo_documento = t.tipo
    from (
      select case
               when nullif(btrim(c.payload#>>'{cliente,numeroDoc}'), '') is null then null
               when upper(btrim(c.payload#>>'{cliente,tipoDoc}')) = 'PASAPORTE' then 'PAS'
               when upper(btrim(c.payload#>>'{cliente,tipoDoc}')) in ('CC', 'CE', 'TI', 'RC', 'PAS', 'PPT', 'NIT') then upper(btrim(c.payload#>>'{cliente,tipoDoc}'))
               else null
             end as tipo
        from public.cotizaciones c where c.id = p_cotizacion_id
    ) t
   where v.numero_contrato = v_res and v.cotizacion_id = p_cotizacion_id;
  perform p39_priv.cerrar(v_aut);
  return v_res;
end $$;

revoke all on function public.convertir_cotizacion_manual_controlada(bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.convertir_cotizacion_manual_controlada(bigint, uuid) to service_role;

-- ── Aceptación #63: renombrar el cuerpo vigente y envolverlo ────────────────────────────────────────────────────
-- Idempotente: si la base ya existe (re-ejecución) NO se renombra de nuevo — la envoltura de abajo se re-crea con CREATE OR REPLACE.
do $$
begin
  if to_regprocedure('public.p40_aceptar_oferta_63_base(bigint,text,uuid,text,text,numeric,text,numeric)') is null then
    if to_regprocedure('public.aceptar_oferta_63(bigint,text,uuid,text,text,numeric,text,numeric)') is null then
      raise exception '242 requiere la firma de 8 argumentos de aceptar_oferta_63 (235).';
    end if;
    alter function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric, text, numeric) rename to p40_aceptar_oferta_63_base;
  end if;
  -- El cuerpo renombrado ya no es una puerta: nadie lo llama directo (la envoltura es SECURITY DEFINER del mismo dueño).
  revoke all on function public.p40_aceptar_oferta_63_base(bigint, text, uuid, text, text, numeric, text, numeric) from public, anon, authenticated, service_role;
end $$;

create or replace function public.aceptar_oferta_63(
  p_cotizacion        bigint,
  p_tenant            text,
  p_usuario           uuid,
  p_huella            text,
  p_huella_financiera text,
  p_trm_provisional   numeric default null,
  p_moneda_cobro      text    default null,
  p_trm_cobro         numeric default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Un reintento de una aceptación ya preparada/materializando/completa devuelve su número sin tocar nada: no se bloquea por la medianoche.
  if not exists (select 1 from public.p63_aceptacion a where a.cotizacion_id = p_cotizacion and a.estado <> 'descartada') then
    perform public.p40_exigir_cotizacion_vigente(p_cotizacion);
  end if;
  return public.p40_aceptar_oferta_63_base(p_cotizacion, p_tenant, p_usuario, p_huella, p_huella_financiera, p_trm_provisional, p_moneda_cobro, p_trm_cobro);
end $$;

comment on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric, text, numeric) is
  '242 (#40 E3): envoltura de p40_aceptar_oferta_63_base (cuerpo de la 235 sin cambios). Rechaza una cotización abierta vencida ANTES de numerar; un reintento de una aceptación existente pasa. Solo service_role.';
revoke all on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric, text, numeric) from public, anon, authenticated;
grant execute on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric, text, numeric) to service_role;

commit;
