-- 344 · Correcciones de la revisión del dueño al bloque 3 (B3-01 … B3-03). Aditiva; no borra datos. Se aplica DESPUÉS de la 343.
--
-- 1) B3-02 · Las alertas de fin de compra SALEN de la campana y pasan al área de ALERTAS del tablero, con acción «Revisado».
--    · `avisos.revisado_en` (una columna): la revisión es POR PERSONA, igual que `leido_en` (cada destinatario tiene su fila). La fila revisada sigue «viva» (archivado_en null), así que el índice único
--      uq_avisos_compra_vivo impide que el generador la cree otra vez; la vista activa = no archivada y no revisada. Cambiar la fecha de fin (o desactivar y reactivar la fuente) archiva la fila por los
--      disparadores → el evento nuevo nace SIN revisar (alerta nueva). No se agrega `revisado_por`: la fila ya pertenece a quien la revisa (usuario_id), así que sería un duplicado.
--    · avisos_reclamar / avisos_marcar_leidos / avisos_recientes (281/340) dejan de ver `compra_por_vencer`: la campana no lo cuenta, no lo lista ni lo notifica, y «Marcar todo como leído» no lo toca.
--    · `alertas_compra_listar` y `alertas_compra_revisar` (solo service_role; la persona la fija el servidor desde la sesión) leen y revisan las alertas activas. Ambas exigen usuario activo con rol que escribe paquetes.
-- 2) B3-03 · Dos fuentes nuevas de alerta con su identidad guardada (no se adivina por nombre): `hotel_vigencia` (hotel_temporadas.compra_fin; destino = el hotel y esa vigencia) y `servicio_vigencia`
--    (servicio_temporadas.compra_fin; destino = el servicio y esa vigencia). Un paquete solo se enlaza para su propia `fecha_compra_fin` (y sus salidas dinámicas). Los vuelos con fecha límite de compra son los
--    empaquetados (ya existente). Los bloqueos de vuelo no tienen fecha de fin de compra (`fecha_devolucion` es el plazo para devolver sillas, otra cosa). Archivo inmediato por disparadores al cambiar la
--    fecha de la vigencia, borrarla, o desactivar el hotel/servicio; el cron diario reconcilia el resto.
-- 3) B3-01 · Presencia: `fn_actividad_resumen()` (un agregado: conteos) y `fn_actividad_pagina(...)` (una página acotada ≤ 50 filas, por grupo, con búsqueda), ambas solo superadmin. La función de 100 filas de la 343 queda
--    sin uso (no se borra: la 343 y su rollback la nombran).
-- Preflight: supabase/scripts/preflight_344_alertas_compra_presencia.sql · Postcheck: postcheck_344_… · Rollback: rollback_344_… · Pruebas: test_bloque3_11_13_36.sh
begin;

do $$ begin
  if to_regclass('public.avisos') is null or to_regprocedure('public.generar_avisos_compra(date,integer)') is null or to_regprocedure('public.f343_ventanas_compra(date,integer)') is null then
    raise exception '344 ABORTADA: falta la 343 (avisos de compra).';
  end if;
  if to_regclass('public.hotel_temporadas') is null or to_regclass('public.servicio_temporadas') is null or to_regclass('public.hoteles') is null or to_regclass('public.servicios_adicionales') is null then
    raise exception '344 ABORTADA: faltan hotel_temporadas / servicio_temporadas / hoteles / servicios_adicionales.';
  end if;
end $$;

-- ── 1. Revisado + vista activa ───────────────────────────────────────────────────────────────────────────────────
alter table public.avisos add column if not exists revisado_en timestamptz;
create index if not exists idx_avisos_compra_activos on public.avisos (usuario_id, compra_fin, id)
  where tipo = 'compra_por_vencer' and archivado_en is null and revisado_en is null;

alter table public.avisos drop constraint if exists avisos_compra_coherente_check;
alter table public.avisos add constraint avisos_compra_coherente_check
  check (tipo <> 'compra_por_vencer' or (ventana_tipo in ('paquete', 'salida_dinamica', 'empaquetado', 'paquete_total', 'hotel_vigencia', 'servicio_vigencia') and ventana_id is not null and ventana_ref is not null and compra_fin is not null));

-- La campana ya no ve las alertas de compra (viven en el área de ALERTAS del tablero).
create or replace function public.avisos_reclamar(p_usuario uuid, p_limite int default 20)
returns table (id bigint, tipo text, numero_contrato text, creado_en timestamptz)
language sql security definer set search_path = '' as $$
  update public.avisos a set notificado_en = now()
   where a.id in (select x.id from public.avisos x
                   where x.usuario_id = p_usuario and x.notificado_en is null and x.leido_en is null and x.archivado_en is null and x.tipo <> 'compra_por_vencer'
                   order by x.id limit greatest(1, least(coalesce(p_limite, 20), 50)) for update skip locked)
  returning a.id, a.tipo, a.numero_contrato, a.creado_en
$$;

create or replace function public.avisos_marcar_leidos(p_usuario uuid, p_ids bigint[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.avisos a set leido_en = now(), notificado_en = coalesce(a.notificado_en, now())
   where a.usuario_id = p_usuario and a.leido_en is null and a.tipo <> 'compra_por_vencer' and (p_ids is null or a.id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.avisos_recientes(p_usuario uuid, p_limite integer default 10)
returns table (id bigint, tipo text, numero_contrato text, creado_en timestamptz, leido_en timestamptz, cotizacion_id bigint, atendida boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.tipo, a.numero_contrato, a.creado_en, a.leido_en, a.cotizacion_id,
         (a.tipo = 'cotizacion_publica' and exists (select 1 from public.cotizaciones c where c.id = a.cotizacion_id and (c.estado = 'convertida' or c.numero_contrato is not null))) as atendida
    from public.avisos a
   where a.usuario_id = p_usuario and a.archivado_en is null and a.tipo <> 'compra_por_vencer'
   order by a.id desc
   limit greatest(1, least(coalesce(p_limite, 10), 50))
$$;

create or replace function public.alertas_compra_listar(p_usuario uuid, p_limite integer default 20)
returns table (id bigint, ventana_tipo text, ventana_id bigint, ventana_ref bigint, ventana_titulo text, compra_fin date, total integer)
language sql stable security definer set search_path = '' as $$
  select a.id, a.ventana_tipo, a.ventana_id, a.ventana_ref, a.ventana_titulo, a.compra_fin, (count(*) over ())::integer
    from public.avisos a
    join public.usuarios u on u.id = a.usuario_id and u.activo is true and u.rol::text in ('superadmin', 'gerencia', 'administracion', 'operaciones')
   where a.usuario_id = p_usuario and a.tipo = 'compra_por_vencer' and a.archivado_en is null and a.revisado_en is null
   order by a.compra_fin, a.id
   limit greatest(1, least(coalesce(p_limite, 20), 50))
$$;
revoke all on function public.alertas_compra_listar(uuid, integer) from public, anon, authenticated;
grant execute on function public.alertas_compra_listar(uuid, integer) to service_role;
comment on function public.alertas_compra_listar(uuid, integer) is '344 (B3-02): alertas de fin de compra ACTIVAS (no archivadas ni revisadas) de UNA persona, con el total real y como mucho 50 filas. Solo service_role; la persona sale de la sesión.';

create or replace function public.alertas_compra_revisar(p_usuario uuid, p_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.avisos a set revisado_en = now()
   where a.id = p_id and a.usuario_id = p_usuario and a.tipo = 'compra_por_vencer' and a.archivado_en is null and a.revisado_en is null
     and exists (select 1 from public.usuarios u where u.id = a.usuario_id and u.activo is true and u.rol::text in ('superadmin', 'gerencia', 'administracion', 'operaciones'));
  get diagnostics v_n = row_count;
  return v_n > 0;   -- false = no es suya, ya estaba revisada/archivada o no puede verla: no se escribió nada
end $$;
revoke all on function public.alertas_compra_revisar(uuid, bigint) from public, anon, authenticated;
grant execute on function public.alertas_compra_revisar(uuid, bigint) to service_role;
comment on function public.alertas_compra_revisar(uuid, bigint) is '344 (B3-02): marca como REVISADA una alerta de fin de compra de la persona (por persona, como leido_en). Solo service_role.';

-- ── 2. Fuentes nuevas: vigencias de hotel y de servicio ───────────────────────────────────────────────────────
-- Misma definición que la 343 + dos fuentes. `ref` = id de la pantalla destino (el hotel / el servicio); `id` = la vigencia que vence. Hoteles y servicios son catálogo de la agencia mayorista.
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
  union all
  select 'hotel_vigencia', v.id, v.hotel_id, h.nombre || ' · ' || v.nombre, v.compra_fin, 'mayorista'
    from public.hotel_temporadas v join public.hoteles h on h.id = v.hotel_id
   where h.activo is true and v.compra_fin between p_hoy and p_hoy + p_dias
  union all
  select 'servicio_vigencia', v.id, v.servicio_id, s.nombre || ' · ' || v.nombre, v.compra_fin, 'mayorista'
    from public.servicio_temporadas v join public.servicios_adicionales s on s.id = v.servicio_id
   where s.activo is true and v.compra_fin between p_hoy and p_hoy + p_dias
$$;
revoke all on function public.f343_ventanas_compra(date, integer) from public, anon, authenticated;

-- Archivo inmediato: ahora también por la fila PADRE del hotel/servicio (desactivado) y por el borrado de la vigencia.
create or replace function public.f343_archivar_ventana() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id bigint := coalesce(new.id, old.id);
begin
  update public.avisos set archivado_en = now()
   where tipo = 'compra_por_vencer' and archivado_en is null
     and ((ventana_tipo = tg_argv[0] and ventana_id = v_id)
       or (tg_table_name = 'armado_paquetes' and ventana_tipo = 'salida_dinamica' and ventana_ref = v_id)
       or (tg_table_name = 'hoteles' and ventana_tipo = 'hotel_vigencia' and ventana_ref = v_id)
       or (tg_table_name = 'servicios_adicionales' and ventana_tipo = 'servicio_vigencia' and ventana_ref = v_id));
  return null;
end $$;
revoke all on function public.f343_archivar_ventana() from public, anon, authenticated;

drop trigger if exists trg_f344_hotel_vigencia on public.hotel_temporadas;
create trigger trg_f344_hotel_vigencia after update of compra_fin on public.hotel_temporadas for each row
  when (old.compra_fin is distinct from new.compra_fin) execute function public.f343_archivar_ventana('hotel_vigencia');
drop trigger if exists trg_f344_hotel_vigencia_del on public.hotel_temporadas;
create trigger trg_f344_hotel_vigencia_del after delete on public.hotel_temporadas for each row execute function public.f343_archivar_ventana('hotel_vigencia');
drop trigger if exists trg_f344_hotel on public.hoteles;
create trigger trg_f344_hotel after update of activo on public.hoteles for each row
  when (old.activo is distinct from new.activo) execute function public.f343_archivar_ventana('-');
drop trigger if exists trg_f344_servicio_vigencia on public.servicio_temporadas;
create trigger trg_f344_servicio_vigencia after update of compra_fin on public.servicio_temporadas for each row
  when (old.compra_fin is distinct from new.compra_fin) execute function public.f343_archivar_ventana('servicio_vigencia');
drop trigger if exists trg_f344_servicio_vigencia_del on public.servicio_temporadas;
create trigger trg_f344_servicio_vigencia_del after delete on public.servicio_temporadas for each row execute function public.f343_archivar_ventana('servicio_vigencia');
drop trigger if exists trg_f344_servicio on public.servicios_adicionales;
create trigger trg_f344_servicio after update of activo on public.servicios_adicionales for each row
  when (old.activo is distinct from new.activo) execute function public.f343_archivar_ventana('-');

-- ── 3. Presencia paginada (solo superadmin) ───────────────────────────────────────────────────────────────────
-- Conteos del recuadro compacto: UN agregado, ninguna fila por persona. «Reciente» = floor(minutos) ≤ 10, igual que lib/actividad/actividadReciente.ts (nivelPresencia).
create or replace function public.fn_actividad_resumen()
returns table (personal_total integer, aliados_total integer, personal_recientes integer, aliados_recientes integer, sin_observacion integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.mi_rol() is distinct from 'superadmin' then
    raise exception 'ACTIVIDAD_ACTOR: solo el superadmin puede ver la presencia del equipo y los aliados.' using errcode = '42501';
  end if;
  return query
  select (count(*) filter (where u.rol::text not in ('agencia', 'freelance')))::integer,
         (count(*) filter (where u.rol::text in ('agencia', 'freelance')))::integer,
         (count(*) filter (where u.rol::text not in ('agencia', 'freelance') and pr.visto_en > now() - interval '11 minutes'))::integer,
         (count(*) filter (where u.rol::text in ('agencia', 'freelance') and pr.visto_en > now() - interval '11 minutes'))::integer,
         (count(*) filter (where pr.visto_en is null))::integer
    from public.usuarios u left join public.presencia_usuario pr on pr.usuario_id = u.id
   where u.activo is true and u.rol::text in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta', 'control_vuelo', 'agencia', 'freelance');
end $$;
revoke all on function public.fn_actividad_resumen() from public, anon;
grant execute on function public.fn_actividad_resumen() to authenticated, service_role;
comment on function public.fn_actividad_resumen() is '344 (B3-01): conteos de presencia (personal y aliados: totales, recientes ≤10 min, sin observación). Un agregado; solo superadmin.';

-- Una PÁGINA (≤ 50 filas) de un grupo. El contexto de auditoría y el último ingreso se calculan SOLO para las filas de la página.
create or replace function public.fn_actividad_pagina(p_grupo text default 'interno', p_busqueda text default null, p_offset integer default 0, p_limite integer default 25, p_dias integer default 7)
returns table (
  usuario_id uuid, nombre text, email text, rol text, tenant text, aliado text,
  visto_en timestamptz, ultima_actividad timestamptz, eventos_ventana integer, eventos_24h integer, ultimo_ingreso timestamptz, total integer
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_dias integer := least(greatest(coalesce(p_dias, 7), 1), 30);
  v_lim integer := least(greatest(coalesce(p_limite, 25), 1), 50);
  v_off integer := least(greatest(coalesce(p_offset, 0), 0), 1000000);
  v_q text := nullif(btrim(coalesce(p_busqueda, '')), '');
begin
  if public.mi_rol() is distinct from 'superadmin' then
    raise exception 'ACTIVIDAD_ACTOR: solo el superadmin puede ver la presencia del equipo y los aliados.' using errcode = '42501';
  end if;
  if p_grupo is null or p_grupo not in ('interno', 'aliado') then
    raise exception 'ACTIVIDAD_GRUPO: el grupo debe ser interno o aliado.' using errcode = '22023';
  end if;
  if v_q is not null then
    v_q := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
  with b as (
    select u.id, u.nombre, u.email, u.rol::text as rol, u.tenant, al.nombre as aliado, pr.visto_en
      from public.usuarios u
      left join public.presencia_usuario pr on pr.usuario_id = u.id
      left join public.aliados al on al.id = u.aliado_id
     where u.activo is true
       and ((p_grupo = 'interno' and u.rol::text in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta', 'control_vuelo'))
         or (p_grupo = 'aliado' and u.rol::text in ('agencia', 'freelance')))
       and (v_q is null or u.nombre ilike v_q or u.email ilike v_q or al.nombre ilike v_q)
  ), t as (select count(*)::integer as n from b),
  p as (select * from b order by b.visto_en desc nulls last, b.nombre, b.id offset v_off limit v_lim)
  select p.id, p.nombre, p.email, p.rol, p.tenant, p.aliado, p.visto_en, a.ultima, coalesce(a.n, 0), coalesce(a.n24, 0), au.last_sign_in_at, t.n
    from p cross join t
    left join lateral (
      select max(x.creado_en) as ultima, count(*)::integer as n, (count(*) filter (where x.creado_en >= now() - interval '24 hours'))::integer as n24
        from public.auditoria x where x.actor_id = p.id and x.creado_en >= now() - make_interval(days => v_dias)
    ) a on true
    left join auth.users au on au.id = p.id
   order by p.visto_en desc nulls last, p.nombre, p.id;
end $$;
revoke all on function public.fn_actividad_pagina(text, text, integer, integer, integer) from public, anon;
grant execute on function public.fn_actividad_pagina(text, text, integer, integer, integer) to authenticated, service_role;
comment on function public.fn_actividad_pagina(text, text, integer, integer, integer) is '344 (B3-01): una página (≤ 50) de presencia observada de un grupo (interno | aliado) con búsqueda por nombre, correo o aliado. Solo superadmin; total = coincidencias del grupo. No es una conexión viva.';

commit;
