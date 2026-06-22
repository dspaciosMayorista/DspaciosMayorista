-- ───────────────────────────────────────────────────────────────────────────
-- 086 · RECOBRO en ventas + parámetro "Distribución B2B"
--
--  RECOBRO = mayor valor cobrado que entra en el total de la venta pero NO
--  corresponde a ningún servicio y NO se le muestra al cliente.
--   * recobro_total   → valor del recobro (ya incluido en precio_venta).
--   * recobro_empresa → parte que queda para la empresa.
--   * recobro_aliado  → parte que se le reconoce al aliado (agencia/freelance).
--     (cliente final = 100% empresa; B2B = se reparte.)
--
--  Distribución B2B: % del recobro que le corresponde al aliado por defecto
--  cuando el recobro se genera en contexto B2B (portal). Editable en
--  Configuración → Parámetros tributarios. El resto es para la empresa.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.ventas
  add column if not exists recobro_total   numeric(15,2) default 0,
  add column if not exists recobro_empresa numeric(15,2) default 0,
  add column if not exists recobro_aliado  numeric(15,2) default 0;

insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion)
values ('recobro_pct_aliado_b2b', 0.500000, 'recobro',
        'Distribución B2B — % del recobro para el aliado (el resto es de la empresa)')
on conflict (parametro) do nothing;
