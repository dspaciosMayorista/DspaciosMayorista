-- Migración 008: Campos de producto en tarifas + parámetro comisión agencia

-- Campos del Módulo de Producto (costos + markup → precio de venta)
alter table public.tarifas
  add column if not exists costo_base       numeric(15,2),
  add column if not exists pct_mk           numeric(5,2);

-- Parámetro de comisión de agencias de viajes (12%)
insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion)
values ('COMISION_AGENCIA', 0.12, 'base_comisionable', 'Comisión agencia de viajes sobre base comisionable')
on conflict (parametro) do update
  set valor = excluded.valor,
      base_calculo = excluded.base_calculo,
      descripcion = excluded.descripcion,
      updated_at = now();
