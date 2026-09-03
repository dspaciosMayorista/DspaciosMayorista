-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 164 · condiciones de pago por componente
--
-- Revierte la migración 164 de forma SEGURA: ABORTA (sin tocar nada) si la
-- funcionalidad está EN USO — es decir, si existe CUALQUIER dato que dependa
-- de la 164. Reversar con datos presentes dejaría la BD incoherente (pagos
-- previos huérfanos, cotizaciones congeladas sin deshacer, contratos con
-- `cotizacion_id` que apuntarían a una columna borrada, abonos ya creados).
--
-- El criterio de aborto (rollback fail-closed, convención del proyecto):
--   · cualquier fila en cotizacion_condiciones / cotizacion_pagos_previos /
--     contrato_condiciones / restriccion_overrides;
--   · cualquier cotización con congelado (condicion_pago_congelada_en) o
--     monto_exigido/pct distintos de NULL/0;
--   · cualquier ventas.cotizacion_id NO nulo (contratos ya vinculados 1-a-1);
--   · asientos con origen 'pago_previo'/'pago_previo_aplicacion'/
--     'pago_previo_reversion'.
--
-- Si NO hay uso, revierte el esquema: suelta tablas nuevas, triggers y
-- funciones, borra constraints y columnas aditivas. NO toca migraciones
-- previas ni datos de origen. Corre en UNA transacción.
--
-- ⚠️ Reversible solo ANTES de que el dueño registre pagos/convierta. Después
-- de uso real, NO se revierte: se corrige hacia adelante con una 165.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ── 1) ¿En uso? Si sí, aborta sin tocar nada. ──────────────────────────────
do $$
declare v_uso int := 0; v_det text := '';
begin
  select (select count(*) from cotizacion_condiciones) +
         (select count(*) from cotizacion_pagos_previos) +
         (select count(*) from contrato_condiciones) +
         (select count(*) from restriccion_overrides) into v_uso;
  if v_uso = 0 then
    select count(*) into v_uso from cotizaciones
      where condicion_pago_congelada_en is not null
         or monto_exigido_total is not null or monto_exigido_total_cop is not null
         or pct_efectivo_informativo is not null or trm_autoritativa <> 1
         or precio_total_congelado is not null or moneda_congelada is not null;
  end if;
  if v_uso = 0 then
    select count(*) into v_uso from ventas where cotizacion_id is not null;
  end if;
  if v_uso = 0 then
    select count(*) into v_uso from asientos_contables
      where origen in ('pago_previo','pago_previo_aplicacion','pago_previo_reversion');
  end if;
  if v_uso > 0 then
    v_det := 'Hay ' || v_uso || ' objeto(s) que dependen de la 164 (condiciones/pagos previos/contratos vinculados/asientos). ROLLBACK ABORTADO: reversar rompería la coherencia. Corrige hacia adelante con una migración 165.';
    raise exception '%', v_det;
  end if;
end $$;

-- ── 2) Suelta dependencias (objetos que dependen de columnas/tablas a borrar). ──
drop trigger if exists trg_cotizacion_condiciones_bloquear_congeladas on public.cotizacion_condiciones;
drop function if exists public.cotizacion_condiciones_bloquear_congeladas();
drop policy if exists "cotizacion_condiciones: lectura" on public.cotizacion_condiciones;
drop policy if exists "cotizacion_condiciones: insertar" on public.cotizacion_condiciones;
drop policy if exists "cotizacion_condiciones: actualizar" on public.cotizacion_condiciones;
drop policy if exists "cotizacion_condiciones: eliminar" on public.cotizacion_condiciones;
drop policy if exists "pagos_previos: acceso autorizado" on public.cotizacion_pagos_previos;
drop policy if exists "contrato_condiciones: lectura" on public.contrato_condiciones;
drop policy if exists "contrato_condiciones: escritura servicio" on public.contrato_condiciones;
drop policy if exists "restriccion_overrides: acceso" on public.restriccion_overrides;
drop policy if exists "config_cobros_componente: lectura" on public.config_cobros_componente;
drop policy if exists "config_cobros_componente: escritura" on public.config_cobros_componente;

-- ── 3) Funciones de dinero + helpers (firma 12-arg de la 164 CORREGIDA). ───
--     Se suelta también la firma 9-arg por si en algún entorno quedó la versión
--     previa a la corrección (no-op si no existe).
drop function if exists public.registrar_pago_previo(bigint, numeric, text, numeric, text, text, date, uuid, text, jsonb, numeric, numeric);
drop function if exists public.registrar_pago_previo(bigint, numeric, text, numeric, text, text, date, uuid, text);
drop function if exists public.anular_pago_previo(bigint, uuid, text);
drop function if exists public.transferir_pagos_previos_a_abonos(bigint, text, uuid);
-- ── 3ter) Conversión atómica Commit 5: se sueltan ANTES de los helpers
--     compartidos (_autorizado/_puc_id/_siguiente_numero_asiento) porque el RPC
--     depende de ellos; PostgreSQL abortaría el drop si quedara viva la dependencia.
drop function if exists public.convertir_cotizacion_a_contrato(bigint, uuid);
drop function if exists public._tipo_cotizacion_convertible(text);
drop function if exists public._monto_cop_pagado(bigint);
drop function if exists public._tipo_proveedor_cxp(text);
drop function if exists public._cuentas_cxp(text);
drop function if exists public._autorizado_pago_previo(uuid);
drop function if exists public._huella_pago_previo(bigint, numeric, text, text, text, date);
drop function if exists public._siguiente_numero_asiento(text);
drop function if exists public._cuenta_disponible(text, text);
drop function if exists public._puc_id(text, text);

-- ── 3bis) Candado BD contra descarte con pagos activos (A3, sección E.2). ───
drop trigger if exists trg_cotizaciones_no_descartar_con_pagos on public.cotizaciones;
drop function if exists public.cotizaciones_no_descartar_con_pagos();

-- ── 4) Tablas nuevas. ───────────────────────────────────────────────────────
drop table if exists public.restriccion_overrides;
drop table if exists public.contrato_condiciones;
drop table if exists public.cotizacion_pagos_previos;
drop table if exists public.cotizacion_condiciones;
-- (el índice UNIQUE parcial uq_pagos_previos_abono_id se suelta con la tabla)
drop table if exists public.config_cobros_componente;

-- ── 5) Columnas aditivas + constraints. ─────────────────────────────────────
alter table public.ventas drop constraint if exists ventas_cotizacion_id_key;
alter table public.ventas drop column if exists cotizacion_id;

alter table public.cotizaciones
  drop column if exists condicion_pago_congelada_en,
  drop column if exists moneda_congelada,
  drop column if exists trm_autoritativa,
  drop column if exists precio_total_congelado,
  drop column if exists monto_exigido_total,
  drop column if exists monto_exigido_total_cop,
  drop column if exists pct_efectivo_informativo;

alter table public.hotel_temporadas
  drop constraint if exists hotel_temporadas_anticipo_coherencia_check,
  drop constraint if exists hotel_temporadas_condicion_pago_tipo_check,
  drop column if exists condicion_pago_dias_saldo,
  drop column if exists condicion_pago_pct_inicial,
  drop column if exists condicion_pago_tipo;

alter table public.armado_paquetes
  drop constraint if exists armado_paquetes_anticipo_coherencia_check,
  drop constraint if exists armado_paquetes_restriccion_check,
  drop constraint if exists armado_paquetes_condicion_pago_tipo_check,
  drop column if exists restriccion_comercial,
  drop column if exists condicion_pago_dias_saldo,
  drop column if exists condicion_pago_pct_inicial,
  drop column if exists condicion_pago_tipo;

alter table public.programas
  drop constraint if exists programas_anticipo_coherencia_check,
  drop constraint if exists programas_restriccion_check,
  drop constraint if exists programas_condicion_pago_tipo_check,
  drop column if exists restriccion_comercial,
  drop column if exists condicion_pago_dias_saldo,
  drop column if exists condicion_pago_pct_inicial,
  drop column if exists condicion_pago_tipo;

commit;

select 'ROLLBACK 164 OK — esquema de condiciones de pago por componente revertido (no había datos en uso).' as resultado;
