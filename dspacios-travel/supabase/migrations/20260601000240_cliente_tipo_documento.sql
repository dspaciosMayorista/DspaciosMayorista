-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 240 · #40 E2 — Tipo del documento del cliente en el contrato
-- Preflight/postcheck/rollback: supabase/scripts/{preflight,postcheck,rollback}_240_cliente_tipo_documento.sql
--
-- Problema: `ventas` guardaba solo el NÚMERO del documento del cliente (`cliente_documento`). La identidad de una persona es número + tipo (#32, 214): el mismo
-- número puede ser una CC y una CE de personas distintas. Al buscar y elegir a quién es el cliente en el contrato manual, el tipo elegido se perdía.
-- Qué hace: agrega `ventas.cliente_tipo_documento` (nullable) con el MISMO catálogo de la 214 (CC, CE, TI, RC, PAS, PPT, NIT). Contratos existentes: NULL (no se inventa
-- un tipo). Solo lo escriben el contrato manual nuevo y la edición de datos del contrato.
-- Qué NO hace: no toca RLS, vistas (`ventas_basica` no lo expone: quien edita lee `ventas`), datos ni funciones. Aditiva: se puede aplicar con el código viejo arriba.
-- Orden de despliegue (las dos van juntas, scripts en supabase/scripts/): preflight 240 → migración 240 → postcheck 240 → preflight 241 → migración 241 → postcheck 241 → recién después el código nuevo (que escribe ambas columnas; sin la 240 y la 241 las conversiones fallan).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.ventas') is null then
    raise exception 'MIGRACIÓN 240 ABORTADA: falta public.ventas.';
  end if;
end;
$$;

alter table public.ventas add column if not exists cliente_tipo_documento text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ventas'::regclass and conname = 'ventas_cliente_tipo_documento_catalogo') then
    alter table public.ventas add constraint ventas_cliente_tipo_documento_catalogo
      check (cliente_tipo_documento is null or cliente_tipo_documento in ('CC', 'CE', 'TI', 'RC', 'PAS', 'PPT', 'NIT'));
  end if;
end;
$$;

comment on column public.ventas.cliente_tipo_documento is '240 (#40): tipo del documento del cliente (catálogo de personas, 214). NULL = no se eligió; el número está en cliente_documento.';

commit;
