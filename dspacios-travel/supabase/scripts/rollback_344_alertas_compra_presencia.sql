-- ROLLBACK 344. Se NIEGA si hay alertas VIVAS de hotel o servicio (se archivan o se deciden con el dueño: no se borra información en silencio). Las alertas ya REVISADAS pierden esa marca (se vuelven a ver como activas en la campana de la 343).
-- Restablece las definiciones de la 281/340/343 que la 344 reemplazó. Una sola transacción, con espera acotada de candados.
begin;
set local lock_timeout = '5s';
lock table public.avisos in access exclusive mode;
do $$ begin
  if exists (select 1 from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null and ventana_tipo in ('hotel_vigencia', 'servicio_vigencia')) then
    raise exception 'ROLLBACK 344 detenido: hay alertas vigentes de hotel o servicio. Archívalas (o confirma con el dueño) antes de revertir.';
  end if;
end $$;
drop trigger if exists trg_f344_hotel_vigencia on public.hotel_temporadas;
drop trigger if exists trg_f344_hotel_vigencia_del on public.hotel_temporadas;
drop trigger if exists trg_f344_hotel on public.hoteles;
drop trigger if exists trg_f344_servicio_vigencia on public.servicio_temporadas;
drop trigger if exists trg_f344_servicio_vigencia_del on public.servicio_temporadas;
drop trigger if exists trg_f344_servicio on public.servicios_adicionales;
delete from public.avisos where tipo = 'compra_por_vencer' and ventana_tipo in ('hotel_vigencia', 'servicio_vigencia');   -- solo quedan archivados (guarda de arriba)
alter table public.avisos drop constraint if exists avisos_compra_coherente_check;
alter table public.avisos add constraint avisos_compra_coherente_check
  check (tipo <> 'compra_por_vencer' or (ventana_tipo in ('paquete', 'salida_dinamica', 'empaquetado', 'paquete_total') and ventana_id is not null and ventana_ref is not null and compra_fin is not null));

create or replace function public.f343_archivar_ventana() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.avisos set archivado_en = now()
   where tipo = 'compra_por_vencer' and archivado_en is null
     and ((ventana_tipo = tg_argv[0] and ventana_id = new.id) or (tg_table_name = 'armado_paquetes' and ventana_tipo = 'salida_dinamica' and ventana_ref = new.id));
  return null;
end $$;
revoke all on function public.f343_archivar_ventana() from public, anon, authenticated;

create or replace function public.f343_ventanas_compra(p_hoy date, p_dias integer)
returns table (ventana_tipo text, ventana_id bigint, ventana_ref bigint, titulo text, compra_fin date, tenant text)
language sql stable security definer set search_path = '' as $$
  select 'paquete', p.id, p.id, p.nombre, p.fecha_compra_fin, 'mayorista'
    from public.armado_paquetes p
   where p.activo is true and p.fecha_compra_fin between p_hoy and p_hoy + p_dias
  union all
  select 'salida_dinamica', s.id, s.paquete_id, p.nombre || ' · salida ' || to_char(s.fecha_ida, 'YYYY-MM-DD'), s.compra_fin, 'mayorista'
    from public.salidas_dinamicas s join public.armado_paquetes p on p.id = s.paquete_id
   where s.activo is true and p.activo is true and s.compra_fin between p_hoy and p_hoy + p_dias
  union all
  select 'empaquetado', e.id, e.id, coalesce(nullif(btrim(e.ruta), ''), 'Empaquetado') || ' · ' || to_char(e.fecha_ida, 'YYYY-MM-DD'), e.compra_fin, 'mayorista'
    from public.empaquetados e
   where e.activo is true and e.compra_fin between p_hoy and p_hoy + p_dias
     and exists (select 1 from public.armado_empaquetados ae join public.armado_paquetes p on p.id = ae.paquete_id where ae.empaquetado_id = e.id and p.activo is true)
  union all
  select 'paquete_total', t.id, t.id, t.nombre, t.compra_fin, t.tenant
    from public.paquete_din t
   where t.activo is true and t.publicado is true and t.compra_fin between p_hoy and p_hoy + p_dias
$$;
revoke all on function public.f343_ventanas_compra(date, integer) from public, anon, authenticated;

create or replace function public.avisos_reclamar(p_usuario uuid, p_limite int default 20)
returns table (id bigint, tipo text, numero_contrato text, creado_en timestamptz)
language sql security definer set search_path = '' as $$
  update public.avisos a set notificado_en = now()
   where a.id in (select x.id from public.avisos x
                   where x.usuario_id = p_usuario and x.notificado_en is null and x.leido_en is null and x.archivado_en is null
                   order by x.id limit greatest(1, least(coalesce(p_limite, 20), 50)) for update skip locked)
  returning a.id, a.tipo, a.numero_contrato, a.creado_en
$$;
create or replace function public.avisos_marcar_leidos(p_usuario uuid, p_ids bigint[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.avisos a set leido_en = now(), notificado_en = coalesce(a.notificado_en, now())
   where a.usuario_id = p_usuario and a.leido_en is null and (p_ids is null or a.id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
create or replace function public.avisos_recientes(p_usuario uuid, p_limite integer default 10)
returns table (id bigint, tipo text, numero_contrato text, creado_en timestamptz, leido_en timestamptz, cotizacion_id bigint, atendida boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.tipo, a.numero_contrato, a.creado_en, a.leido_en, a.cotizacion_id,
         (a.tipo = 'cotizacion_publica' and exists (select 1 from public.cotizaciones c where c.id = a.cotizacion_id and (c.estado = 'convertida' or c.numero_contrato is not null))) as atendida
    from public.avisos a
   where a.usuario_id = p_usuario and a.archivado_en is null
   order by a.id desc
   limit greatest(1, least(coalesce(p_limite, 10), 50))
$$;

drop function if exists public.alertas_compra_listar(uuid, integer);
drop function if exists public.alertas_compra_revisar(uuid, bigint);
drop function if exists public.fn_actividad_resumen();
drop function if exists public.fn_actividad_pagina(text, text, integer, integer, integer);
drop index if exists public.idx_avisos_compra_activos;
alter table public.avisos drop column if exists revisado_en;
commit;
