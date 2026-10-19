-- ═════════════════════════════════════════════════════════════════════════
-- ROLLBACK 216 · retirar la parte aditiva (A) de #39.
--
-- Solo procede si NO hubo uso real: ninguna autorización emitida o cerrada y
-- ninguna edición en el historial. Tras el primer pago, anulación, conversión o
-- edición hechos con el código nuevo, la 216 es FORWARD-ONLY (decisión 2 del
-- dueño): este script aborta sin tocar nada. Si la 217 está activa, aborta
-- también: primero va rollback_217_cotizacion_manual_cierre.sql.
--
-- ⚠️ El código nuevo llama a las funciones de la 216: retirarla exige volver a
-- desplegar el código anterior ANTES. Las manuales creadas con la RPC conservan
-- su `creado_por_id` (columna de la 211); no se borra ningún dato.
-- ═════════════════════════════════════════════════════════════════════════
begin;

set local lock_timeout = '10s';

do $$
declare v_em bigint := 0; v_ce bigint := 0; v_ed bigint := 0;
begin
  if to_regnamespace('p39_priv') is null and to_regclass('public.cotizacion_ediciones') is null
     and not exists (select 1 from pg_attribute a where a.attrelid = 'public.cotizaciones'::regclass and a.attname = 'economico_rev'
                      and a.attnum > 0 and not a.attisdropped) then
    raise exception 'ROLLBACK 216 ABORTADO: la 216 no está aplicada.';
  end if;
  if exists (select 1 from pg_trigger t where not t.tgisinternal and t.tgenabled <> 'D'
              and t.tgname in ('trg_cot_frontera_39', 'trg_cot_pagos_frontera_39', 'trg_cot_condiciones_frontera_39'))
     or not has_table_privilege('authenticated', 'public.cotizacion_servicios', 'INSERT') then
    raise exception 'ROLLBACK 216 ABORTADO: la 217 (frontera o revocaciones) está activa; corre primero rollback_217.';
  end if;
  if to_regclass('p39_priv.autorizacion_emitida') is not null then
    execute 'select count(*) from p39_priv.autorizacion_emitida' into v_em;
  end if;
  if to_regclass('p39_priv.autorizacion_cerrada') is not null then
    execute 'select count(*) from p39_priv.autorizacion_cerrada' into v_ce;
  end if;
  if to_regclass('public.cotizacion_ediciones') is not null then
    execute 'select count(*) from public.cotizacion_ediciones' into v_ed;
  end if;
  if v_em + v_ce + v_ed > 0 then
    raise exception 'ROLLBACK 216 ABORTADO: hubo uso real (autorizaciones=%, cierres=%, ediciones=%); la 216 queda (forward-only).', v_em, v_ce, v_ed;
  end if;
end $$;

-- Disparadores en tablas públicas.
drop trigger if exists trg_cot_frontera_39 on public.cotizaciones;
drop trigger if exists trg_cot_pagos_frontera_39 on public.cotizacion_pagos_previos;
drop trigger if exists trg_cot_condiciones_frontera_39 on public.cotizacion_condiciones;
drop trigger if exists trg_cot_economico_rev_39 on public.cotizaciones;
drop trigger if exists trg_cot_servicios_rev_39_ins on public.cotizacion_servicios;
drop trigger if exists trg_cot_servicios_rev_39_upd on public.cotizacion_servicios;
drop trigger if exists trg_cot_servicios_rev_39_del on public.cotizacion_servicios;

-- Funciones públicas.
drop function if exists public.crear_cotizacion_manual(uuid, text, jsonb, jsonb);
drop function if exists public.editar_servicios_cotizacion_manual(uuid, bigint, integer, text, jsonb, jsonb);
drop function if exists public.actualizar_recobro_ninos_manual(uuid, bigint, integer, text, jsonb);
drop function if exists public.registrar_pago_previo_rev(bigint, numeric, text, numeric, text, text, date, uuid, text, integer, jsonb, numeric, numeric);
drop function if exists public.anular_pago_previo_controlado(bigint, uuid, text);
drop function if exists public.convertir_cotizacion_manual_controlada(bigint, uuid);
drop function if exists public.edicion_cotizaciones_habilitada();

-- Historial (vacío: lo comprobó la guarda).
drop table if exists public.cotizacion_ediciones;

-- Esquema privado: tablas, funciones y el esquema (sin CASCADE: falla si queda algo ajeno).
drop table if exists p39_priv.autorizacion_cerrada;
drop table if exists p39_priv.autorizacion_emitida;
drop table if exists p39_priv.suspension_edicion;
drop function if exists p39_priv.emitir(bigint, text, uuid);
drop function if exists p39_priv.cerrar(bigint);
drop function if exists p39_priv.autorizada(bigint, text);
drop function if exists p39_priv.frontera_activa();
drop function if exists p39_priv.componentes_manual(bigint);
drop function if exists p39_priv.composicion_coincide(bigint, jsonb);
drop function if exists p39_priv.validar_servicios(jsonb);
drop function if exists p39_priv.bloquear_para_editar(bigint, uuid, integer, text);
drop function if exists p39_priv.tg_cot_economico_rev();
drop function if exists p39_priv.tg_servicios_economico_rev();
drop function if exists p39_priv.tg_frontera_cotizaciones();
drop function if exists p39_priv.tg_frontera_pagos();
drop function if exists p39_priv.tg_frontera_condiciones();
drop function if exists p39_priv.tg_solo_insercion();
drop schema if exists p39_priv;

-- Columna de revisión.
alter table public.cotizaciones drop constraint if exists cotizaciones_economico_rev_positiva;
alter table public.cotizaciones drop column if exists economico_rev;

do $$
begin
  if to_regnamespace('p39_priv') is not null or to_regclass('public.cotizacion_ediciones') is not null
     or exists (select 1 from pg_attribute a where a.attrelid = 'public.cotizaciones'::regclass and a.attname = 'economico_rev' and not a.attisdropped)
     or exists (select 1 from pg_trigger t where not t.tgisinternal and t.tgname like '%\_39%' escape '\'
                 and t.tgrelid in ('public.cotizaciones'::regclass, 'public.cotizacion_servicios'::regclass,
                                   'public.cotizacion_pagos_previos'::regclass, 'public.cotizacion_condiciones'::regclass)) then
    raise exception 'ROLLBACK 216 ABORTADO: quedaron objetos de la 216.';
  end if;
  raise notice 'ROLLBACK 216 COMPLETO: objetos de la 216 retirados; datos intactos.';
end $$;

commit;
