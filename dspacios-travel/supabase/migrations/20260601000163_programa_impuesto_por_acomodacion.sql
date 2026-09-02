-- Migracion 163: impuestos distintos por acomodacion en Programas.
--
-- Compatibilidad:
-- - El comportamiento historico sigue siendo el default.
-- - La opcion solo aplica al modo `Tarifa - impuesto`.
-- - Un payload antiguo, sin `impuestoPorAcomodacion`, conserva el valor ya
--   guardado. No pisa configuraciones nuevas durante un despliegue gradual.
-- - La firma y el modelo de seguridad del RPC no cambian.

begin;

do $$
declare
  v_tipo text;
  v_nullable text;
  v_default text;
begin
  select data_type, is_nullable, column_default
    into v_tipo, v_nullable, v_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'programas'
     and column_name = 'regla_comisionable_impuesto_por_acomodacion';

  if found and (
    v_tipo is distinct from 'boolean'
    or v_nullable is distinct from 'NO'
    or v_default is distinct from 'false'
  ) then
    raise exception 'ABORTADO: programas.regla_comisionable_impuesto_por_acomodacion existe con una definicion incompatible.';
  end if;
end $$;

alter table public.programas
  add column if not exists regla_comisionable_impuesto_por_acomodacion boolean not null default false;

do $$
declare
  v_col text;
  v_tipo text;
  v_nullable text;
begin
  foreach v_col in array array['impuesto_sencilla', 'impuesto_doble', 'impuesto_triple', 'impuesto_multiple']
  loop
    select data_type, is_nullable
      into v_tipo, v_nullable
      from information_schema.columns
     where table_schema = 'public' and table_name = 'programa_salidas' and column_name = v_col;

    if found and (v_tipo is distinct from 'numeric' or v_nullable is distinct from 'YES') then
      raise exception 'ABORTADO: programa_salidas.% existe con una definicion incompatible.', v_col;
    end if;
  end loop;
end $$;

alter table public.programa_salidas
  add column if not exists impuesto_sencilla numeric(15,2),
  add column if not exists impuesto_doble numeric(15,2),
  add column if not exists impuesto_triple numeric(15,2),
  add column if not exists impuesto_multiple numeric(15,2);

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'programas_impuesto_por_acomodacion_modo_check'
     and conrelid = 'public.programas'::regclass;
  if not found then
    alter table public.programas
      add constraint programas_impuesto_por_acomodacion_modo_check
      check (not regla_comisionable_impuesto_por_acomodacion or regla_comisionable_modo = 'impuesto');
  elsif v_def is distinct from 'CHECK (((NOT regla_comisionable_impuesto_por_acomodacion) OR (regla_comisionable_modo = ''impuesto''::text)))' then
    raise exception 'ABORTADO: el CHECK programas_impuesto_por_acomodacion_modo_check existe con otra definicion: %.', v_def;
  end if;

  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'programa_salidas_impuestos_no_negativos_check'
     and conrelid = 'public.programa_salidas'::regclass;
  if not found then
    alter table public.programa_salidas
      add constraint programa_salidas_impuestos_no_negativos_check
      check (
        (impuesto_sencilla is null or impuesto_sencilla >= 0)
        and (impuesto_doble is null or impuesto_doble >= 0)
        and (impuesto_triple is null or impuesto_triple >= 0)
        and (impuesto_multiple is null or impuesto_multiple >= 0)
      );
  end if;
end $$;

comment on column public.programas.regla_comisionable_impuesto_por_acomodacion is
  'Si es true, cada tarifa de proveedor usa su impuesto_* de la misma salida y acomodacion. Solo valido con regla_comisionable_modo=impuesto.';

create or replace function public.guardar_programa_salidas(
  p_programa_id bigint,
  p_regla jsonb,
  p_salidas jsonb
)
returns void
language plpgsql
as $$
declare
  v_activa boolean;
  v_modo text;
  v_valor numeric;
  v_pct_comision numeric;
  v_modalidad_mk text;
  v_impuesto_por_acomodacion boolean;
  v_programa record;
  r record;
  v_tarifa numeric;
  v_impuesto numeric;
  v_nombre text;
  v_base numeric;
  v_base_neta numeric;
begin
  select * into v_programa
    from public.programas
   where id = p_programa_id
   for update;
  if not found then
    raise exception 'El programa % no existe.', p_programa_id;
  end if;

  v_activa := coalesce((p_regla->>'activa')::boolean, false);
  v_modo := coalesce(p_regla->>'modo', 'pct');
  v_valor := nullif(p_regla->>'valor', '')::numeric;
  v_pct_comision := nullif(p_regla->>'pctComision', '')::numeric;

  if p_regla ? 'modalidadMk' then
    v_modalidad_mk := p_regla->>'modalidadMk';
  else
    v_modalidad_mk := v_programa.regla_comisionable_modalidad_mk;
  end if;
  if v_modalidad_mk is null or v_modalidad_mk not in ('historica', 'base_neta_impuestos_al_final') then
    raise exception 'La modalidad de MK debe ser "historica" o "base_neta_impuestos_al_final".';
  end if;

  if p_regla ? 'impuestoPorAcomodacion' then
    if jsonb_typeof(p_regla->'impuestoPorAcomodacion') is distinct from 'boolean' then
      raise exception 'impuestoPorAcomodacion debe ser booleano.';
    end if;
    v_impuesto_por_acomodacion := (p_regla->>'impuestoPorAcomodacion')::boolean;
  else
    v_impuesto_por_acomodacion := v_programa.regla_comisionable_impuesto_por_acomodacion;
  end if;

  if v_impuesto_por_acomodacion and v_modo <> 'impuesto' then
    raise exception 'El impuesto por acomodacion solo se puede usar con el modo "impuesto".';
  end if;

  if v_activa then
    if v_pct_comision is null or v_pct_comision < 0 or v_pct_comision > 100 then
      raise exception 'El porcentaje de comision debe ser un numero entre 0 y 100.';
    end if;
    if v_modo = 'pct' and (v_valor is null or v_valor < 0 or v_valor > 100) then
      raise exception 'El porcentaje a restar debe ser un numero entre 0 y 100.';
    elsif v_modo = 'impuesto' and (v_valor is null or v_valor < 0) then
      raise exception 'El impuesto debe ser un numero mayor o igual a 0.';
    end if;
  end if;

  for r in
    select *
      from jsonb_to_recordset(coalesce(p_salidas, '[]'::jsonb)) as x(
        orden int,
        tarifa_sencilla numeric, tarifa_doble numeric, tarifa_triple numeric, tarifa_multiple numeric,
        impuesto_sencilla numeric, impuesto_doble numeric, impuesto_triple numeric, impuesto_multiple numeric
      )
  loop
    if coalesce(r.impuesto_sencilla, 0) < 0 or coalesce(r.impuesto_doble, 0) < 0
       or coalesce(r.impuesto_triple, 0) < 0 or coalesce(r.impuesto_multiple, 0) < 0 then
      raise exception 'Los impuestos por acomodacion no pueden ser negativos (salida orden %).', r.orden;
    end if;

    for v_tarifa, v_impuesto, v_nombre in
      select * from (values
        (r.tarifa_sencilla, r.impuesto_sencilla, 'sencilla'::text),
        (r.tarifa_doble, r.impuesto_doble, 'doble'::text),
        (r.tarifa_triple, r.impuesto_triple, 'triple'::text),
        (r.tarifa_multiple, r.impuesto_multiple, 'multiple'::text)
      ) as valores(tarifa, impuesto, nombre)
    loop
      if v_activa and v_impuesto_por_acomodacion and v_tarifa is not null and v_tarifa > 0 and v_impuesto is null then
        raise exception 'Falta el impuesto de la acomodacion % en la salida orden %.', v_nombre, r.orden;
      end if;
      if v_activa and v_modalidad_mk = 'base_neta_impuestos_al_final'
         and v_tarifa is not null and v_tarifa > 0 then
        v_base := case v_modo
          when 'pct' then v_tarifa * (1 - v_valor / 100)
          when 'impuesto' then v_tarifa - case when v_impuesto_por_acomodacion then v_impuesto else v_valor end
          else v_tarifa
        end;
        v_base_neta := v_base * (1 - v_pct_comision / 100);
        if v_base_neta < 0 then
          raise exception 'La tarifa % (%) de la salida orden % produce una base neta negativa.', v_nombre, v_tarifa, r.orden;
        end if;
      end if;
    end loop;
  end loop;

  update public.programas
     set regla_comisionable = v_activa,
         regla_comisionable_modo = v_modo,
         regla_comisionable_valor = v_valor,
         regla_comisionable_pct_comision = v_pct_comision,
         regla_comisionable_modalidad_mk = v_modalidad_mk,
         regla_comisionable_impuesto_por_acomodacion = v_impuesto_por_acomodacion,
         updated_at = now()
   where id = p_programa_id;

  delete from public.programa_salidas where programa_id = p_programa_id;

  insert into public.programa_salidas (
    programa_id, orden, etiqueta, fecha_desde, fecha_hasta, noches, columna,
    neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, bajo_solicitud,
    tarifa_sencilla, tarifa_doble, tarifa_triple, tarifa_multiple,
    impuesto_sencilla, impuesto_doble, impuesto_triple, impuesto_multiple
  )
  select
    p_programa_id, x.orden, x.etiqueta, x.fecha_desde, x.fecha_hasta, x.noches, x.columna,
    x.neto_sencilla, x.neto_doble, x.neto_triple, x.neto_multiple, x.neto_nino,
    coalesce(x.bajo_solicitud, false),
    x.tarifa_sencilla, x.tarifa_doble, x.tarifa_triple, x.tarifa_multiple,
    x.impuesto_sencilla, x.impuesto_doble, x.impuesto_triple, x.impuesto_multiple
  from jsonb_to_recordset(coalesce(p_salidas, '[]'::jsonb)) as x(
    orden int, etiqueta text, fecha_desde date, fecha_hasta date, noches int, columna text,
    neto_sencilla numeric, neto_doble numeric, neto_triple numeric, neto_multiple numeric,
    neto_nino numeric, bajo_solicitud boolean,
    tarifa_sencilla numeric, tarifa_doble numeric, tarifa_triple numeric, tarifa_multiple numeric,
    impuesto_sencilla numeric, impuesto_doble numeric, impuesto_triple numeric, impuesto_multiple numeric
  );
end;
$$;

comment on function public.guardar_programa_salidas(bigint, jsonb, jsonb) is
  'Guarda atomicamente regla y salidas. Migracion 163: admite impuestoPorAcomodacion y cuatro impuestos por salida; claves nuevas ausentes conservan compatibilidad con clientes anteriores.';

revoke all on function public.guardar_programa_salidas(bigint, jsonb, jsonb) from public;
revoke all on function public.guardar_programa_salidas(bigint, jsonb, jsonb) from anon;
grant execute on function public.guardar_programa_salidas(bigint, jsonb, jsonb) to authenticated;

commit;
