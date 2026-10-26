-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la 240 (ventas.cliente_tipo_documento).
--   · SE NIEGA si hay contratos con tipo guardado: al quitar la columna se perdería qué tipo de documento tenía el cliente (el número quedaría sin tipo).
--     Exporta o decide qué hacer con esos contratos y vuelve a correr este script.
-- Si el código nuevo sigue desplegado, la edición de datos del contrato falla sin la columna: revierte primero el despliegue.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'cliente_tipo_documento') then
    raise exception 'ROLLBACK 240 ABORTADO: la 240 no está aplicada.';
  end if;
  if exists (select 1 from public.ventas where cliente_tipo_documento is not null) then
    raise exception 'ROLLBACK 240 ABORTADO: hay % contrato(s) con tipo de documento guardado; al quitar la columna se perdería.',
      (select count(*) from public.ventas where cliente_tipo_documento is not null);
  end if;
end;
$$;

alter table public.ventas drop constraint if exists ventas_cliente_tipo_documento_catalogo;
alter table public.ventas drop column cliente_tipo_documento;

commit;
