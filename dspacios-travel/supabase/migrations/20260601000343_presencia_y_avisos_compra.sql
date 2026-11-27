-- 343 · #11 presencia reciente (personal interno Y aliados B2B, solo superadmin) + #13 avisos DENTRO del sistema por fin de vigencia de compra de paquetes (campana global). SIN correo.
--
-- Aditiva: no toca datos existentes. Piezas:
--
-- 1) PRESENCIA. `presencia_usuario` guarda UN instante por usuario: la última actividad AUTENTICADA observada. Se escribe solo con `registrar_presencia()`: la persona se toma de la sesión (auth.uid()), debe estar
--    ACTIVA y ser de un rol interno o aliado (agencia/freelance; no cliente_final), y la base misma limita el trabajo: como mucho UNA escritura cada 4 minutos por persona aunque el navegador insista (el cliente envía
--    como máximo una cada 5 min y solo con la pestaña visible y con actividad real; sin temporizadores). No es una conexión viva: un instante reciente solo prueba que la persona usó la aplicación hace poco.
--    Sin RLS de lectura para clientes: solo `fn_actividad_reciente` (superadmin) la expone. La tabla NO lleva el disparador de auditoría (telemetría de alta frecuencia; auditarla duplicaría cada escritura).
--
-- 2) `fn_actividad_reciente(p_dias)` — informe SOLO superadmin del personal interno y los aliados B2B activos: presencia (instante observado), último inicio de sesión, y —como contexto, no como presencia— el último
--    cambio guardado y sus conteos (auditoría). Máximo 100 filas (más recientes primero) y el total real. 42501 si `mi_rol()` no es superadmin (incluye superadmin inactivo y llave de servicio sin actor).
--
-- 3) AVISOS EN LA APLICACIÓN (campana global, tabla `avisos` de la 281/323). Tipo nuevo `compra_por_vencer`, que CONVIVE con los existentes (el CHECK se reconstruye a partir de su definición actual + el tipo nuevo, así que
--    no depende del orden respecto de la 340). Cada aviso nombra su ventana (`ventana_tipo/id/ref/titulo`, `compra_fin`) para enlazar a donde se corrige. Evento = (ventana, fecha de fin): un solo aviso vivo por persona
--    (índice único parcial sobre los no archivados). `generar_avisos_compra()` (solo service_role; la llama el cron diario que ya existe): crea los avisos faltantes para quienes pueden ESCRIBIR paquetes
--    (superadmin, gerencia, administración y operaciones; agencia mayorista salvo superadmin) y ARCHIVA los que ya no aplican (fecha cambiada, paquete/salida/empaquetado/total inactivo o sin publicar, plazo vencido, fuera de
--    la ventana). Cada llamada tiene un tope de TRABAJO (500 avisos creados y 500 archivados) pero PROGRESA: solo selecciona lo que aún falta y archiva con independencia de cuántas ventanas haya; devuelve `pendientes` y el cron repite la llamada con tope de pasadas. Disparadores baratos archivan al instante cuando cambia la fecha o la activación de la fuente. Los avisos leídos no se repiten mientras el evento sea el mismo.
--
-- Orden de aplicación respecto del bloque CRM: aplicar la 340 ANTES de la 343 (la 340 reemplaza el CHECK de `avisos_tipo_check` con su propia lista y borraría `compra_por_vencer` si corriera después).
-- Preflight: supabase/scripts/preflight_343_presencia_avisos_compra.sql · Postcheck: postcheck_343_… · Rollback: rollback_343_… · Pruebas: test_bloque3_11_13_36.sh, test_343_ciclo_vida.sh
begin;

do $$ begin
  if to_regclass('public.auditoria') is null or to_regclass('public.usuarios') is null or to_regclass('public.avisos') is null then
    raise exception '343 ABORTADA: faltan auditoria (087), usuarios o avisos (281).';
  end if;
  if to_regprocedure('public.mi_rol()') is null or to_regprocedure('public.fecha_negocio(timestamp with time zone)') is null then
    raise exception '343 ABORTADA: falta public.mi_rol() o public.fecha_negocio() (198).';
  end if;
  if to_regclass('auth.users') is null then raise exception '343 ABORTADA: falta auth.users.'; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.avisos'::regclass and conname = 'avisos_tipo_check') then
    raise exception '343 ABORTADA: falta el CHECK avisos_tipo_check (281).';
  end if;
  if to_regclass('public.salidas_dinamicas') is null or to_regclass('public.empaquetados') is null or to_regclass('public.paquete_din') is null or to_regclass('public.armado_empaquetados') is null then
    raise exception '343 ABORTADA: faltan salidas_dinamicas (094), empaquetados/armado_empaquetados (156) o paquete_din (274).';
  end if;
end $$;

-- ── 1. Presencia ──────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.presencia_usuario (
  usuario_id uuid primary key references public.usuarios(id) on delete cascade,
  visto_en   timestamptz not null
);
alter table public.presencia_usuario enable row level security;
revoke all on public.presencia_usuario from public, anon, authenticated, service_role;
comment on table public.presencia_usuario is '343 (#11): última actividad autenticada OBSERVADA por persona (un instante). Se escribe solo con registrar_presencia() (como mucho 1 vez cada 4 min por persona). No prueba conexión viva.';

create or replace function public.registrar_presencia() returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_rol text; v_n integer;
begin
  if v_uid is null then return false; end if;
  -- mi_rol() ya devuelve NULL para un usuario inactivo (140); aquí se exige además un rol con presencia (interno o aliado B2B).
  select u.rol::text into v_rol from public.usuarios u where u.id = v_uid and u.activo is true;
  if v_rol is null or v_rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta', 'control_vuelo', 'agencia', 'freelance') then return false; end if;
  insert into public.presencia_usuario as p (usuario_id, visto_en) values (v_uid, now())
  on conflict (usuario_id) do update set visto_en = now() where p.visto_en < now() - interval '4 minutes';
  get diagnostics v_n = row_count;
  return v_n > 0;   -- false = ya había una observación de hace menos de 4 min: no se escribió nada
end $$;
revoke all on function public.registrar_presencia() from public, anon;
grant execute on function public.registrar_presencia() to authenticated;
comment on function public.registrar_presencia() is '343 (#11): registra la presencia de la persona de la sesión. Limitada por la base a 1 escritura / 4 min / persona. Devuelve true solo si escribió.';

drop function if exists public.fn_actividad_reciente(integer);
create function public.fn_actividad_reciente(p_dias integer default 7)
returns table (
  usuario_id uuid, nombre text, email text, rol text, tenant text, aliado text,
  visto_en timestamptz, ultima_actividad timestamptz, eventos_ventana integer, eventos_24h integer, ultimo_ingreso timestamptz, total integer
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_dias integer := least(greatest(coalesce(p_dias, 7), 1), 30);
begin
  if public.mi_rol() is distinct from 'superadmin' then
    raise exception 'ACTIVIDAD_ACTOR: solo el superadmin puede ver la presencia del equipo y los aliados.' using errcode = '42501';
  end if;
  return query
  select u.id, u.nombre, u.email, u.rol::text, u.tenant, al.nombre, pr.visto_en, a.ultima, coalesce(a.n, 0), coalesce(a.n24, 0), au.last_sign_in_at, (count(*) over ())::integer
    from public.usuarios u
    left join public.presencia_usuario pr on pr.usuario_id = u.id
    left join public.aliados al on al.id = u.aliado_id
    left join (
      select x.actor_id, max(x.creado_en) as ultima, count(*)::integer as n, (count(*) filter (where x.creado_en >= now() - interval '24 hours'))::integer as n24
        from public.auditoria x
       where x.creado_en >= now() - make_interval(days => v_dias) and x.actor_id is not null
       group by x.actor_id
    ) a on a.actor_id = u.id
    left join auth.users au on au.id = u.id
   where u.activo is true and u.rol::text in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta', 'control_vuelo', 'agencia', 'freelance')
   order by pr.visto_en desc nulls last, a.ultima desc nulls last, u.nombre
   limit 100;
end $$;
revoke all on function public.fn_actividad_reciente(integer) from public, anon;
grant execute on function public.fn_actividad_reciente(integer) to authenticated, service_role;
comment on function public.fn_actividad_reciente(integer) is '343 (#11): presencia observada + contexto (último ingreso, último cambio guardado) de personal interno y aliados B2B activos. Solo superadmin; 100 filas máx. No es una conexión viva.';

-- ── 2. Avisos de fin de compra en la campana global ───────────────────────────────────────────────────────────────
alter table public.avisos
  add column if not exists ventana_tipo   text,
  add column if not exists ventana_id     bigint,
  add column if not exists ventana_ref    bigint,
  add column if not exists ventana_titulo text,
  add column if not exists compra_fin     date;

-- El CHECK de tipos se reconstruye desde su definición ACTUAL (conserva los tipos existentes, incluidos los que agregue otra migración) + el tipo nuevo.
do $$
declare v_def text; v_lista text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conrelid = 'public.avisos'::regclass and conname = 'avisos_tipo_check';
  if v_def not like '%compra_por_vencer%' then
    v_lista := substring(v_def from 'ARRAY\[(.*)\]');
    if v_lista is null then raise exception '343 ABORTADA: no se pudo leer la lista de tipos de avisos_tipo_check: %', v_def; end if;
    alter table public.avisos drop constraint avisos_tipo_check;
    execute format('alter table public.avisos add constraint avisos_tipo_check check (tipo = any (array[%s, %L]))', v_lista, 'compra_por_vencer');
  end if;
end $$;
alter table public.avisos drop constraint if exists avisos_compra_coherente_check;
alter table public.avisos add constraint avisos_compra_coherente_check
  check (tipo <> 'compra_por_vencer' or (ventana_tipo in ('paquete', 'salida_dinamica', 'empaquetado', 'paquete_total') and ventana_id is not null and ventana_ref is not null and compra_fin is not null));
create unique index if not exists uq_avisos_compra_vivo on public.avisos (usuario_id, ventana_tipo, ventana_id, compra_fin) where tipo = 'compra_por_vencer' and archivado_en is null;

-- Ventanas de compra ELEGIBLES (una sola definición para crear y para reconciliar): fuente activa, fin de compra dentro de [hoy, hoy + días]. `ref` = id de la pantalla destino.
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

create or replace function public.generar_avisos_compra(p_hoy date default null, p_dias integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_hoy date := coalesce(p_hoy, public.fecha_negocio()); v_dias integer;
  v_lote constant integer := 500;   -- tope de TRABAJO por llamada (filas escritas), no de ventanas consideradas
  v_ventanas integer; v_faltan integer; v_creados integer; v_obsoletos integer; v_archivados integer;
begin
  v_dias := least(greatest(coalesce(p_dias, (select c.dias_anticipacion from public.config_notificaciones c where c.id = 1), 5), 0), 365);
  -- UNA sentencia, con PROGRESO por llamada (B3-3):
  --   · e        = TODAS las ventanas elegibles (lectura; no se recorta, así que el archivo nunca depende de un primer lote incompleto).
  --   · faltan   = pares (ventana, destinatario) que AÚN no tienen aviso vivo. Los ya avisados quedan fuera por la antiunión, así que cada llamada avanza sobre lo pendiente en vez de repetir lo hecho.
  --   · ins      = como mucho v_lote de esos pares, en orden estable (fin de compra, tipo, id, persona).
  --   · obsoletos = avisos vivos cuya ventana ya no es elegible (fecha cambiada, inactiva, vencida, fuera de ventana); arc archiva como mucho v_lote por llamada, con independencia de cuántas ventanas elegibles queden.
  -- `pendientes` = pares sin crear + avisos obsoletos sin archivar tras esta llamada; truncado = pendientes > 0 (el cron repite la llamada con tope de pasadas). Destinatarios: quienes pueden ESCRIBIR paquetes y corregir
  -- la fecha (superadmin, gerencia, administración, operaciones), activos; de la agencia de la ventana (superadmin, de cualquiera).
  with e as materialized (
    select * from public.f343_ventanas_compra(v_hoy, v_dias)
  ), faltan as not materialized (
    select r.id as usuario_id, e.ventana_tipo, e.ventana_id, e.ventana_ref, e.titulo, e.compra_fin
      from e join public.usuarios r on r.activo is true and r.rol::text in ('superadmin', 'gerencia', 'administracion', 'operaciones') and (r.rol::text = 'superadmin' or r.tenant = e.tenant)
     where not exists (
       select 1 from public.avisos a
        where a.tipo = 'compra_por_vencer' and a.archivado_en is null and a.usuario_id = r.id
          and a.ventana_tipo = e.ventana_tipo and a.ventana_id = e.ventana_id and a.compra_fin = e.compra_fin)
  ), ins as (
    insert into public.avisos (usuario_id, tipo, numero_contrato, ventana_tipo, ventana_id, ventana_ref, ventana_titulo, compra_fin)
    select f.usuario_id, 'compra_por_vencer', f.ventana_tipo || ':' || f.ventana_id, f.ventana_tipo, f.ventana_id, f.ventana_ref, left(f.titulo, 200), f.compra_fin
      from (select * from faltan order by compra_fin, ventana_tipo, ventana_id, usuario_id limit v_lote) f
    on conflict do nothing
    returning 1
  ), obsoletos as materialized (
    select a.id from public.avisos a
     where a.tipo = 'compra_por_vencer' and a.archivado_en is null
       and not exists (select 1 from e where e.ventana_tipo = a.ventana_tipo and e.ventana_id = a.ventana_id and e.compra_fin = a.compra_fin)
  ), arc as (
    update public.avisos a set archivado_en = now()
     where a.id in (select o.id from obsoletos o order by o.id limit v_lote)
    returning 1
  )
  select (select count(*) from e), (select count(*) from faltan), (select count(*) from ins), (select count(*) from obsoletos), (select count(*) from arc)
    into v_ventanas, v_faltan, v_creados, v_obsoletos, v_archivados;
  return jsonb_build_object('hoy', v_hoy, 'dias', v_dias, 'ventanas', v_ventanas, 'creados', v_creados, 'archivados', v_archivados,
                            'pendientes', greatest(v_faltan - v_creados, 0) + greatest(v_obsoletos - v_archivados, 0),
                            'truncado', (greatest(v_faltan - v_creados, 0) + greatest(v_obsoletos - v_archivados, 0)) > 0);
end $$;
revoke all on function public.generar_avisos_compra(date, integer) from public, anon, authenticated;
grant execute on function public.generar_avisos_compra(date, integer) to service_role;
comment on function public.generar_avisos_compra(date, integer) is '343 (#13): crea los avisos de compra por vencer que faltan (un evento = ventana + fecha de fin; sin repetir) y archiva los que ya no aplican, con progreso acotado por llamada (500 filas escritas y 500 archivadas como máximo; `pendientes` indica lo que queda). Solo service_role; la llama el cron diario existente, que repite la llamada con tope.';

-- Archivo inmediato cuando la fuente cambia de fecha o de activación (el cron diario cubre el resto: p. ej. un empaquetado que pierde su último paquete activo).
create or replace function public.f343_archivar_ventana() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.avisos set archivado_en = now()
   where tipo = 'compra_por_vencer' and archivado_en is null
     and ((ventana_tipo = tg_argv[0] and ventana_id = new.id) or (tg_table_name = 'armado_paquetes' and ventana_tipo = 'salida_dinamica' and ventana_ref = new.id));
  return null;
end $$;
revoke all on function public.f343_archivar_ventana() from public, anon, authenticated;

drop trigger if exists trg_f343_paquete on public.armado_paquetes;
create trigger trg_f343_paquete after update of fecha_compra_fin, activo on public.armado_paquetes for each row
  when (old.fecha_compra_fin is distinct from new.fecha_compra_fin or old.activo is distinct from new.activo) execute function public.f343_archivar_ventana('paquete');
drop trigger if exists trg_f343_salida on public.salidas_dinamicas;
create trigger trg_f343_salida after update of compra_fin, activo on public.salidas_dinamicas for each row
  when (old.compra_fin is distinct from new.compra_fin or old.activo is distinct from new.activo) execute function public.f343_archivar_ventana('salida_dinamica');
drop trigger if exists trg_f343_empaquetado on public.empaquetados;
create trigger trg_f343_empaquetado after update of compra_fin, activo on public.empaquetados for each row
  when (old.compra_fin is distinct from new.compra_fin or old.activo is distinct from new.activo) execute function public.f343_archivar_ventana('empaquetado');
drop trigger if exists trg_f343_total on public.paquete_din;
create trigger trg_f343_total after update of compra_fin, activo, publicado on public.paquete_din for each row
  when (old.compra_fin is distinct from new.compra_fin or old.activo is distinct from new.activo or old.publicado is distinct from new.publicado) execute function public.f343_archivar_ventana('paquete_total');

commit;
