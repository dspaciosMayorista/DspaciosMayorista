-- ROLLBACK de la migración 284 (identidad del contrato y guardas, #75 entrega 1).
-- SE NIEGA si algún contrato ya nació de un número reutilizado (nacio_de_reuso = true): quitar la guarda o el uid de esos contratos reabriría la escritura
-- desde pantallas antiguas. Apagar el reuso (dtm_reuso_config.habilitado = false) NO basta para revertir: la guarda debe sobrevivir mientras exista alguno.
-- Tampoco se hace si la migración del reuso (286) sigue aplicada: se revierte primero esa.
begin;
do $$
begin
  if to_regclass('public.contrato_guardas_config') is null then
    raise exception 'rollback 284: la 284 no está aplicada.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'reserva_token')
     or to_regclass('public.numeros_dtm_liberados') is not null then
    raise exception 'rollback 284: la migración del reuso (286) sigue aplicada; revierte esa primero.';
  end if;
  if exists (select 1 from public.ventas where nacio_de_reuso) then
    raise exception 'rollback 284: % contrato(s) nacieron de un número reutilizado (%); la guarda debe sobrevivir.',
      (select count(*) from public.ventas where nacio_de_reuso), (select string_agg(numero_contrato, ', ') from public.ventas where nacio_de_reuso);
  end if;
end $$;

do $$ declare r record;
begin
  for r in select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname = 'trg_contrato_guarda' and not t.tgisinternal loop
    execute format('drop trigger trg_contrato_guarda on public.%I', r.relname);
  end loop;
end $$;
drop trigger if exists trg_ventas_identidad_inmutable on public.ventas;
drop function if exists public.contratos_identidades(text[]);
drop function if exists public.sillas_identidades(bigint);
drop function if exists public.contrato_instalar_guardas();
drop function if exists public.contrato_guarda_identidad();
drop function if exists public.contrato_verificar_identidad(text, boolean);
drop function if exists public.contrato_declarar_identidad(text, uuid);
drop function if exists public.contrato_ident_interna(text);
drop function if exists public.contrato_ident_cabecera(text);
drop trigger if exists trg_ventas_autodeclara_creacion on public.ventas;
drop function if exists public.fn_ventas_autodeclara_creacion();
drop function if exists public.fn_ventas_identidad_inmutable();
drop table if exists public.contrato_guardas_config;
alter table public.ventas drop constraint if exists ventas_contrato_uid_uq;
alter table public.ventas drop column if exists contrato_uid, drop column if exists nacio_de_reuso;
notify pgrst, 'reload schema';
commit;
