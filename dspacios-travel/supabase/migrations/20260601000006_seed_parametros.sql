-- Migración 006: Datos iniciales

-- ──────────────────────────────────────────────────────────────────
-- PARÁMETROS TRIBUTARIOS (Colombia — Decreto dic-2025)
-- ──────────────────────────────────────────────────────────────────
insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion)
values
  ('ICA',                  0.010000, 'ingresos_brutos',  'Impuesto de Industria y Comercio'),
  ('BOMBERIL',             0.010000, 'valor_ica',        'Sobretasa bomberil (% del ICA)'),
  ('FONTUR',               0.025000, 'utilidad_bruta',   'Contribución parafiscal turismo'),
  ('RETENCION_RENTA',      0.035000, 'base_gravable',    'Retención en la fuente por renta'),
  ('IVA',                  0.190000, 'base_gravable',    'Impuesto al Valor Agregado'),
  ('RETENCION_HONORARIOS', 0.110000, 'base_gravable',    'Retención en la fuente honorarios')
on conflict (parametro) do update
  set valor = excluded.valor,
      base_calculo = excluded.base_calculo,
      descripcion = excluded.descripcion,
      updated_at = now();

-- ──────────────────────────────────────────────────────────────────
-- PLANES DE ALIMENTACIÓN
-- ──────────────────────────────────────────────────────────────────
insert into public.planes_alimentacion (codigo, nombre, descripcion)
values
  ('PC',           'Plan Continental',           'Desayuno continental incluido'),
  ('PAM',          'Plan Americano Modificado',  'Desayuno y almuerzo incluidos'),
  ('PAE',          'Plan Americano Extendido',   'Desayuno, almuerzo y cena incluidos'),
  ('PA',           'Plan Americano',             'Desayuno y cena incluidos'),
  ('PA+OPEN BAR',  'PA con Open Bar',            'Desayuno, cena y bebidas ilimitadas'),
  ('FULL',         'Todo Incluido',              'Todas las comidas y bebidas locales'),
  ('FULL TROPICAL','Todo Incluido Tropical',     'Todo incluido con bebidas premium locales'),
  ('FULL PREMIUM', 'Todo Incluido Premium',      'Todo incluido con bebidas premium importadas')
on conflict (codigo) do update
  set nombre = excluded.nombre,
      descripcion = excluded.descripcion;
