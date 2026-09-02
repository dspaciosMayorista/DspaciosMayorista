-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · migración 20260601000163_programa_impuesto_por_acomodacion.sql
-- rama programas-impuestos-por-acomodacion
--
-- Revierte la migración 163 dejando la base EXACTAMENTE como estaba después
-- de la 161: restaura `guardar_programa_salidas` byte-por-byte a la versión
-- que dejó la 161 (sin `impuestoPorAcomodacion` ni impuestos por acomodación),
-- y elimina las columnas/constraints nuevos de la 163.
--
-- ⚠️ ABORTA si algún programa está usando la funcionalidad que se va a
-- eliminar (regla_comisionable_impuesto_por_acomodacion = true), o si algún
-- registro de programa_salidas tiene alguno de los cuatro impuestos por
-- acomodación cargado — revertir ahí perdería datos configurados a propósito
-- sin aviso. Hay que desactivar la opción en esos programas (o aceptar perder
-- esos valores a conciencia) ANTES de correr este rollback.
--
-- Ejecutar en el SQL Editor de Supabase (proyecto REAL) SOLO si hace falta
-- deshacer la migración 163 después de aplicarla. NO se ha corrido nunca en
-- producción real al momento de escribir este script — ver CLAUDE.md.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_en_uso_regla bigint;
  v_en_uso_impuestos bigint;
begin
  select count(*) into v_en_uso_regla
    from public.programas
   where regla_comisionable_impuesto_por_acomodacion = true;

  if v_en_uso_regla > 0 then
    raise exception 'ABORTADO: % programa(s) tienen regla_comisionable_impuesto_por_acomodacion = true. Desactivar la opción en esos programas antes de revertir la migración 163.', v_en_uso_regla;
  end if;

  select count(*) into v_en_uso_impuestos
    from public.programa_salidas
   where impuesto_sencilla is not null
      or impuesto_doble is not null
      or impuesto_triple is not null
      or impuesto_multiple is not null;

  if v_en_uso_impuestos > 0 then
    raise exception 'ABORTADO: % fila(s) de programa_salidas tienen algún impuesto_* cargado. Revertir la 163 borraría esos valores sin aviso — limpiarlos a conciencia antes de revertir.', v_en_uso_impuestos;
  end if;
end $$;

-- Restaura, byte por byte, la función tal como quedó tras la migración 161
-- (sin impuestoPorAcomodacion ni impuestos por acomodación).
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
  v_base          numeric;
  v_base_neta     numeric;
  v_programa      record;
  r               record;
begin
  -- Bloqueo de fila (revisión PR #277, defecto de concurrencia). Sin esto,
  -- dos guardados concurrentes del MISMO programa podían intercalar su
  -- UPDATE + DELETE + INSERT — cada sentencia individual es atómica, pero la
  -- SECUENCIA de las tres no lo era entre transacciones: el UPDATE de una
  -- podía quedar seguido del DELETE+INSERT de la otra, mezclando la regla de
  -- un guardado con las salidas del otro. `SELECT ... FOR UPDATE` toma el
  -- lock de la fila de `programas` ANTES de leer/validar/escribir nada —
  -- cualquier otra invocación de esta función sobre el MISMO `p_programa_id`
  -- espera hasta que esta transacción termine (commit o rollback); sobre un
  -- `p_programa_id` DISTINTO no se bloquean entre sí (el lock es por fila).
  -- La comprobación de existencia usa el mismo SELECT (FOUND la resuelve),
  -- no una consulta aparte sin lock.
  select * into v_programa from public.programas where id = p_programa_id for update;
  if not found then
    raise exception 'El programa % no existe.', p_programa_id;
  end if;

  v_activa       := coalesce((p_regla->>'activa')::boolean, false);
  v_modo         := coalesce(p_regla->>'modo', 'pct');
  v_valor        := nullif(p_regla->>'valor', '')::numeric;
  v_pct_comision := nullif(p_regla->>'pctComision', '')::numeric;

  -- Modalidad de MK (revisión PR #277, defecto 1). Clave AUSENTE del payload
  -- (`p_regla ? 'modalidadMk'` = false — un cliente desplegado ANTES de esta
  -- migración nunca la manda) → conserva la modalidad YA GUARDADA del
  -- programa, nunca la pisa con 'historica': el default 'historica' es SOLO
  -- para un programa NUEVO (columna recién creada por el `alter table` de
  -- arriba), no para pisar en silencio un programa ya configurado en la
  -- modalidad nueva. Clave PRESENTE → se valida SIEMPRE, fail-closed: una
  -- cadena vacía o un `null` explícitos NUNCA se ensanchan a 'historica' —
  -- son una señal de bug/payload manipulado, no "no dijo nada", y caen en el
  -- mismo `raise exception` que cualquier otro valor fuera del enum.
  --
  -- ⚠️ Se lee de `v_programa` (la fila YA BLOQUEADA arriba), NUNCA con un
  -- SELECT aparte: si dos guardados con payload viejo compiten por el mismo
  -- programa, el que espera el lock debe heredar la modalidad que el OTRO
  -- dejó al terminar (commit) — o la que ya había si el otro hizo rollback
  -- — nunca una lectura tomada ANTES de esperar el lock (obsoleta).
  if p_regla ? 'modalidadMk' then
    v_modalidad_mk := p_regla->>'modalidadMk';
  else
    v_modalidad_mk := v_programa.regla_comisionable_modalidad_mk;
  end if;

  if v_modalidad_mk is null or v_modalidad_mk not in ('historica', 'base_neta_impuestos_al_final') then
    raise exception 'La modalidad de MK debe ser "historica" o "base_neta_impuestos_al_final".';
  end if;

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

  -- (Revisión PR #277, defecto 3) Con la regla ACTIVA y la modalidad NUEVA,
  -- cada tarifa de proveedor cargada en `p_salidas` debe producir una base
  -- neta >= 0. `base_neta = base_comisionable * (1 - pct_comision/100)` —
  -- álgebra idéntica a `baseComisionable - comision` (donde
  -- `comision = baseComisionable * pct_comision/100`), MISMA fórmula que
  -- `calcularNetoProgramaConModalidad()` (lib/calc/programaPrecio.ts), nunca
  -- reimplementada distinto. Una base neta negativa es una CONFIGURACIÓN
  -- INVÁLIDA (ej. un impuesto mayor a la tarifa con % de comisión bajo): se
  -- rechaza ANTES del DELETE/INSERT (última barrera — navegador y Server
  -- Action ya la repiten antes de llegar acá). Con la regla apagada o en
  -- modalidad histórica NO se valida nada acá: los datos/programas en
  -- modalidad histórica jamás quedan bloqueados por esta regla nueva.
  if v_activa and v_modalidad_mk = 'base_neta_impuestos_al_final' then
    for r in
      select x.orden, x.tarifa_sencilla, x.tarifa_doble, x.tarifa_triple, x.tarifa_multiple
      from jsonb_to_recordset(coalesce(p_salidas, '[]'::jsonb)) as x(
        orden int, tarifa_sencilla numeric, tarifa_doble numeric, tarifa_triple numeric, tarifa_multiple numeric
      )
    loop
      if r.tarifa_sencilla is not null and r.tarifa_sencilla > 0 then
        v_base := case v_modo when 'pct' then r.tarifa_sencilla * (1 - v_valor/100) when 'impuesto' then r.tarifa_sencilla - v_valor else r.tarifa_sencilla end;
        v_base_neta := v_base * (1 - v_pct_comision/100);
        if v_base_neta < 0 then
          raise exception 'La tarifa sencilla (%) de la salida (orden %) produce una base neta negativa en la modalidad "MK sobre base neta; impuestos al final".', r.tarifa_sencilla, r.orden;
        end if;
      end if;
      if r.tarifa_doble is not null and r.tarifa_doble > 0 then
        v_base := case v_modo when 'pct' then r.tarifa_doble * (1 - v_valor/100) when 'impuesto' then r.tarifa_doble - v_valor else r.tarifa_doble end;
        v_base_neta := v_base * (1 - v_pct_comision/100);
        if v_base_neta < 0 then
          raise exception 'La tarifa doble (%) de la salida (orden %) produce una base neta negativa en la modalidad "MK sobre base neta; impuestos al final".', r.tarifa_doble, r.orden;
        end if;
      end if;
      if r.tarifa_triple is not null and r.tarifa_triple > 0 then
        v_base := case v_modo when 'pct' then r.tarifa_triple * (1 - v_valor/100) when 'impuesto' then r.tarifa_triple - v_valor else r.tarifa_triple end;
        v_base_neta := v_base * (1 - v_pct_comision/100);
        if v_base_neta < 0 then
          raise exception 'La tarifa triple (%) de la salida (orden %) produce una base neta negativa en la modalidad "MK sobre base neta; impuestos al final".', r.tarifa_triple, r.orden;
        end if;
      end if;
      if r.tarifa_multiple is not null and r.tarifa_multiple > 0 then
        v_base := case v_modo when 'pct' then r.tarifa_multiple * (1 - v_valor/100) when 'impuesto' then r.tarifa_multiple - v_valor else r.tarifa_multiple end;
        v_base_neta := v_base * (1 - v_pct_comision/100);
        if v_base_neta < 0 then
          raise exception 'La tarifa múltiple (%) de la salida (orden %) produce una base neta negativa en la modalidad "MK sobre base neta; impuestos al final".', r.tarifa_multiple, r.orden;
        end if;
      end if;
    end loop;
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
  'DELETE también se revierte y el programa no queda sin salidas. Clave `modalidadMk` AUSENTE '
  'en p_regla conserva la modalidad ya guardada (nunca la pisa con el default); presente pero '
  'vacía/nula/inválida se rechaza (fail-closed). Con la regla activa y la modalidad nueva, '
  'valida cada tarifa contra base_neta >= 0 antes de escribir. SIN security definer: corre '
  'con el rol del que llama, sujeto a las mismas policies de programas/programa_salidas.';

revoke all on function public.guardar_programa_salidas(bigint, jsonb, jsonb) from public;
revoke all on function public.guardar_programa_salidas(bigint, jsonb, jsonb) from anon;
grant execute on function public.guardar_programa_salidas(bigint, jsonb, jsonb) to authenticated;

alter table public.programa_salidas
  drop constraint if exists programa_salidas_impuestos_no_negativos_check;

alter table public.programas
  drop constraint if exists programas_impuesto_por_acomodacion_modo_check;

alter table public.programa_salidas
  drop column if exists impuesto_sencilla,
  drop column if exists impuesto_doble,
  drop column if exists impuesto_triple,
  drop column if exists impuesto_multiple;

alter table public.programas
  drop column if exists regla_comisionable_impuesto_por_acomodacion;

commit;
