-- ───────────────────────────────────────────────────────────────────────────
-- 161 · PROGRAMAS — segunda modalidad de markup para la tarifa comisionable
--
-- ⚠️ NUMERACIÓN — colisión con PR #276 (PAUSADO): PR #276 (rama
-- `tarifario-rendimiento-carga`) también propone una migración 161
-- (`20260601000161_tarifario_resumen.sql`, vista `tarifario_resumen`) —
-- PAUSADA por instrucción explícita del dueño mientras se prioriza este
-- trabajo, NUNCA ejecutada ni fusionada. Si ESTE PR (el de la modalidad de
-- markup) se fusiona PRIMERO, la migración de PR #276 deberá RENUMERARSE a
-- 162 (o el siguiente número libre en ese momento) antes de poder
-- ejecutarse/fusionarse — nunca coexistir con el mismo número 161. Nombres de
-- archivo completamente distintos (`tarifario_resumen` vs.
-- `programa_modalidad_mk_comisionable`), así que no hay colisión de
-- contenido, solo de número — mismo criterio de renumeración ya documentado
-- en CLAUDE.md para colisiones previas (ej. 157/158 en ago-2026).
--
-- QUÉ ARREGLA — REGLA COMERCIAL CONFIRMADA POR EL DUEÑO
--   Hoy (migración 151, `calcularNetoPrograma()` en lib/calc/programaPrecio.ts,
--   SIN CAMBIOS en su fórmula por esta migración) la única modalidad es:
--     base_comisionable = Tarifa − impuestos_o_%
--     comision          = base_comisionable × %comision
--     base_neta         = base_comisionable − comision
--     neto (persistido) = Tarifa − comision   (= base_neta + "impuestos")
--     Venta = (base_neta + impuestos) / divisor_MK    ← el MK se cobra
--             TAMBIÉN sobre el monto que no es comisionable (impuestos).
--
--   El dueño pide una SEGUNDA modalidad, seleccionable por programa:
--     Venta = (base_neta / divisor_MK) + impuestos    ← el MK NUNCA se aplica
--             sobre "impuestos"; se suman al final, sin markup.
--
--   Ejemplo exacto confirmado (MK 20% → divisor 0,80): tarifa 1.000.000,
--   impuestos 100.000, comisión 10% → base_comisionable 900.000, comisión
--   90.000, base_neta 810.000.
--     Histórica: (810.000+100.000)/0,80 = 1.137.500
--     Nueva:     810.000/0,80 + 100.000 = 1.112.500
--
-- QUÉ AGREGA
--   `programas.regla_comisionable_modalidad_mk` — el discriminante, a nivel
--   de PROGRAMA (una sola modalidad para todas sus salidas — mismo criterio
--   que `regla_comisionable_modo`/`_valor`/`_pct_comision`, migración 151,
--   que también viven a nivel de programa, no de salida).
--     · 'historica'                    → comportamiento EXACTO de siempre.
--     · 'base_neta_impuestos_al_final' → la modalidad nueva.
--   Default EXPLÍCITO 'historica' — todo programa existente (o creado sin
--   tocar este campo) conserva el comportamiento actual byte a byte.
--
-- POR QUÉ NO HACE FALTA TOCAR `programa_salidas` NI `neto_*`
--   `neto_*` (persistido por salida/acomodación) sigue significando EXACTAMENTE
--   lo mismo que hoy: `Tarifa − comision` — la fórmula histórica, sin cambios.
--   La modalidad nueva NO se persiste como un neto distinto: se RECALCULA en
--   caliente, en cada uno de los 4 puntos de consumo (editor en vivo,
--   validación cliente, validación servidor, generación real del tarifario),
--   a partir de los MISMOS datos ya persistidos (`tarifa_*` + la regla del
--   programa) — la misma función pura `calcularNetoProgramaConModalidad()`
--   (lib/calc/programaPrecio.ts) en los 4 lugares, nunca una fórmula
--   duplicada. Esto evita además un problema real: si `neto_*` horneara ya el
--   efecto del %MK, cambiar el %MK del programa más adelante dejaría esos
--   netos desactualizados sin que nada lo notara — al recalcular siempre en
--   caliente con el %MK VIGENTE, ese problema no puede existir.
--
-- REGISTROS EXISTENTES
--   Ningún backfill: la columna nace en 'historica' para TODOS los programas
--   ya creados (incluidos los que ya usan `regla_comisionable=true`) — el
--   comportamiento visible no cambia para ninguno hasta que alguien elija
--   explícitamente la modalidad nueva en un programa puntual.
--
-- ATOMICIDAD — mismo patrón que `guardar_programa_salidas` (151)
--   `guardar_programa_salidas()` se reemplaza (create or replace, misma
--   firma) para leer y persistir `p_regla->>'modalidadMk'` dentro de la MISMA
--   transacción que ya usa para la regla + las salidas — sigue siendo
--   UPDATE + DELETE + INSERT en una sola invocación de Postgres. `language
--   plpgsql` SIN `security definer`, igual que antes: corre con el rol de
--   quien llama, sujeto a las mismas policies de `programas`/`programa_salidas`.
--
-- CONSTRAINTS — última barrera, no la única
--   `programas_regla_comisionable_modalidad_mk_check` (CHECK incondicional,
--   igual criterio que los CHECK de la 151: no depende de si
--   `regla_comisionable` está activa — un valor fuera del enum nunca es
--   válido, esté la regla prendida o no) exige que la columna sea uno de los
--   dos valores del enum de texto. `guardar_programa_salidas()` valida lo
--   mismo ANTES del UPDATE (mensaje claro, `raise exception`) — el CHECK
--   queda como respaldo si algún día se llama la tabla/función directo con un
--   valor manipulado.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. Programa: discriminante de modalidad de MK ───────────────────────────
alter table public.programas
  add column if not exists regla_comisionable_modalidad_mk text not null default 'historica';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'programas_regla_comisionable_modalidad_mk_check'
  ) then
    alter table public.programas
      add constraint programas_regla_comisionable_modalidad_mk_check
      check (regla_comisionable_modalidad_mk in ('historica', 'base_neta_impuestos_al_final'));
  end if;
end $$;

comment on column public.programas.regla_comisionable_modalidad_mk is
  '''historica'' (default, comportamiento de siempre: Venta=(base_neta+impuestos)/divisorMK) | '
  '''base_neta_impuestos_al_final'' (Venta=base_neta/divisorMK+impuestos, el MK nunca se aplica '
  'sobre impuestos). Solo aplica cuando regla_comisionable=true. Ver '
  'calcularNetoProgramaConModalidad() en lib/calc/programaPrecio.ts. Migración 161.';

-- ── 2. Guardado atómico — misma función, misma firma, ahora también lee/
--    persiste la modalidad dentro de la MISMA transacción ──────────────────
create or replace function public.guardar_programa_salidas(
  p_programa_id bigint,
  p_regla       jsonb,
  p_salidas     jsonb
)
returns void
language plpgsql
as $$
declare
  v_activa        boolean;
  v_modo          text;
  v_valor         numeric;
  v_pct_comision  numeric;
  v_modalidad_mk  text;
begin
  if not exists (select 1 from public.programas where id = p_programa_id) then
    raise exception 'El programa % no existe.', p_programa_id;
  end if;

  v_activa       := coalesce((p_regla->>'activa')::boolean, false);
  v_modo         := coalesce(p_regla->>'modo', 'pct');
  v_valor        := nullif(p_regla->>'valor', '')::numeric;
  v_pct_comision := nullif(p_regla->>'pctComision', '')::numeric;
  -- Default explícito 'historica' cuando el llamador no manda el campo (ej.
  -- un cliente desplegado ANTES de esta migración, durante el rollout) — el
  -- comportamiento no cambia para nadie que todavía no conozca el campo
  -- nuevo. Nunca se acepta un valor fuera del enum: se valida ANTES del
  -- UPDATE, igual criterio que el resto de esta función.
  v_modalidad_mk := coalesce(nullif(p_regla->>'modalidadMk', ''), 'historica');

  -- Misma regla que `validarReglaComisionable` (lib/calc/programaPrecio.ts),
  -- repetida acá para que quien llame la función DIRECTO (sin pasar por
  -- navegador ni Server Action) no pueda dejar la regla activa a medias — ver
  -- "CONSTRAINTS" en la cabecera de la migración 151. Con `v_activa = false`
  -- no se valida nada: los valores previos se conservan tal cual.
  if v_activa then
    if v_pct_comision is null or v_pct_comision < 0 or v_pct_comision > 100 then
      raise exception 'El porcentaje de comision debe ser un numero entre 0 y 100.';
    end if;

    if v_modo = 'pct' then
      if v_valor is null or v_valor < 0 or v_valor > 100 then
        raise exception 'El porcentaje a restar debe ser un numero entre 0 y 100.';
      end if;
    elsif v_modo = 'impuesto' then
      if v_valor is null or v_valor < 0 then
        raise exception 'El impuesto debe ser un numero mayor o igual a 0.';
      end if;
    end if;
    -- modo 'ninguno': el valor no participa del cálculo, no se exige.
  end if;

  -- La modalidad de MK se valida SIEMPRE (incondicional, igual que el CHECK
  -- de abajo) — nunca depende de si la regla está activa: un valor fuera del
  -- enum es inválido esté prendida o apagada la regla, mismo criterio que
  -- `regla_comisionable_modo`.
  if v_modalidad_mk not in ('historica', 'base_neta_impuestos_al_final') then
    raise exception 'La modalidad de MK debe ser "historica" o "base_neta_impuestos_al_final".';
  end if;

  update public.programas
     set regla_comisionable = v_activa,
         regla_comisionable_modo = v_modo,
         regla_comisionable_valor = v_valor,
         regla_comisionable_pct_comision = v_pct_comision,
         regla_comisionable_modalidad_mk = v_modalidad_mk,
         updated_at = now()
   where id = p_programa_id;

  delete from public.programa_salidas where programa_id = p_programa_id;

  insert into public.programa_salidas (
    programa_id, orden, etiqueta, fecha_desde, fecha_hasta, noches, columna,
    neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, bajo_solicitud,
    tarifa_sencilla, tarifa_doble, tarifa_triple, tarifa_multiple
  )
  select
    p_programa_id,
    x.orden,
    x.etiqueta,
    x.fecha_desde,
    x.fecha_hasta,
    x.noches,
    x.columna,
    x.neto_sencilla, x.neto_doble, x.neto_triple, x.neto_multiple, x.neto_nino,
    coalesce(x.bajo_solicitud, false),
    x.tarifa_sencilla, x.tarifa_doble, x.tarifa_triple, x.tarifa_multiple
  from jsonb_to_recordset(coalesce(p_salidas, '[]'::jsonb)) as x(
    orden           int,
    etiqueta        text,
    fecha_desde     date,
    fecha_hasta     date,
    noches          int,
    columna         text,
    neto_sencilla   numeric,
    neto_doble      numeric,
    neto_triple     numeric,
    neto_multiple   numeric,
    neto_nino       numeric,
    bajo_solicitud  boolean,
    tarifa_sencilla numeric,
    tarifa_doble    numeric,
    tarifa_triple   numeric,
    tarifa_multiple numeric
  );
end;
$$;

comment on function public.guardar_programa_salidas(bigint, jsonb, jsonb) is
  'Reemplaza la regla comisionable (incl. modalidad de MK, migración 161) de un programa y '
  'sus salidas en una sola transacción (UPDATE + DELETE + INSERT) — si el INSERT falla, el '
  'DELETE también se revierte y el programa no queda sin salidas. SIN security definer: corre '
  'con el rol del que llama, sujeto a las mismas policies de programas/programa_salidas.';

revoke all on function public.guardar_programa_salidas(bigint, jsonb, jsonb) from public;
grant execute on function public.guardar_programa_salidas(bigint, jsonb, jsonb) to authenticated;

commit;
