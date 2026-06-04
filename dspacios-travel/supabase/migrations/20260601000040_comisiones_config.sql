-- Migración 040: comisiones configurables de agencias/freelance + retención por asesor
--
--  • `aliados` (catálogo de agencias/freelance) gana `tipo` y `pct_comision`
--    (override por entidad; NULL = usa el default general). Ya tiene
--    aplica_retencion + pct_retencion.
--  • `asesores` gana `aplica_retencion` (check por asesor interno).
--  • Default general de comisión freelance (el de agencia ya existe).

alter table public.aliados
  add column if not exists tipo         text not null default 'agencia',  -- 'agencia' | 'freelance'
  add column if not exists pct_comision numeric(7,4);                      -- fracción; NULL = default general

alter table public.asesores
  add column if not exists aplica_retencion boolean not null default true;

insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion)
values ('COMISION_FREELANCE', 0.11, 'base_comisionable', 'Comisión freelance sobre base comisionable')
on conflict (parametro) do nothing;
