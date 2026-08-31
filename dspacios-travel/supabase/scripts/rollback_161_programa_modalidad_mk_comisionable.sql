-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 161 (programa_modalidad_mk_comisionable)
--
-- Revierte: `programas.regla_comisionable_modalidad_mk` (+ su CHECK) y
-- restaura `guardar_programa_salidas()` a la versión EXACTA de la migración
-- 151 (sin el parámetro de modalidad).
--
-- ⚠️ ABORTA SI YA HAY algún programa usando la modalidad nueva
-- ('base_neta_impuestos_al_final'): revertir dejaría ese programa mostrando
-- de nuevo la fórmula histórica sin ningún aviso — un cambio de precio
-- silencioso en producción. Se verifica DENTRO de la misma transacción, ANTES
-- de tocar cualquier objeto (igual patrón que rollback_159).
--
-- Todo el archivo corre en una transacción explícita.
-- ───────────────────────────────────────────────────────────────────────────

begin;

do $$
declare
  v_en_uso bigint;
begin
  select count(*) into v_en_uso
    from public.programas
   where regla_comisionable_modalidad_mk = 'base_neta_impuestos_al_final';
  if v_en_uso > 0 then
    raise exception
      'ABORTADO: % programa(s) usan la modalidad "base_neta_impuestos_al_final". '
      'Revertir la 161 los dejaría mostrando la fórmula histórica sin aviso '
      '(un cambio de precio silencioso). Cambia esos programas de vuelta a '
      '"historica" desde la UI antes de forzar este rollback, o confirma que '
      'es aceptable antes de continuar.',
      v_en_uso;
  end if;
end $$;

-- 1) guardar_programa_salidas() vuelve a la versión EXACTA de la migración 151.
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
begin
  if not exists (select 1 from public.programas where id = p_programa_id) then
    raise exception 'El programa % no existe.', p_programa_id;
  end if;

  v_activa       := coalesce((p_regla->>'activa')::boolean, false);
  v_modo         := coalesce(p_regla->>'modo', 'pct');
  v_valor        := nullif(p_regla->>'valor', '')::numeric;
  v_pct_comision := nullif(p_regla->>'pctComision', '')::numeric;

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
  end if;

  update public.programas
     set regla_comisionable = v_activa,
         regla_comisionable_modo = v_modo,
         regla_comisionable_valor = v_valor,
         regla_comisionable_pct_comision = v_pct_comision,
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
  'Reemplaza la regla comisionable de un programa y sus salidas en una sola transacción '
  '(UPDATE + DELETE + INSERT) — si el INSERT falla, el DELETE también se revierte y el '
  'programa no queda sin salidas. SIN security definer: corre con el rol del que llama, '
  'sujeto a las mismas policies de programas/programa_salidas. Migración 151.';

revoke all on function public.guardar_programa_salidas(bigint, jsonb, jsonb) from public;
grant execute on function public.guardar_programa_salidas(bigint, jsonb, jsonb) to authenticated;

-- 2) Columna y CHECK nuevos, fuera.
alter table public.programas drop constraint if exists programas_regla_comisionable_modalidad_mk_check;
alter table public.programas drop column if exists regla_comisionable_modalidad_mk;

commit;
