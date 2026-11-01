-- 260 · Publicación del tarifario POR LOTES con generaciones almacenadas, activación atómica y continuación automática en la base.
--
-- Separa CALCULAR de HACER VISIBLE. Cada lote se escribe como una transacción corta en una generación invisible; solo una generación completa, con la huella de cada lote
-- verificada y su composición (258) acreditada, se activa cambiando UN puntero (`armado_paquetes.tarifario_generacion_publicada`). Lo ya publicado sigue visible e intacto
-- hasta ese instante. NO cambia reglas comerciales ni precios, NO sube ningún límite (cada función fija su propio statement_timeout=30s y lock_timeout=8s, como la 259) y el
-- publicador monolítico (254/256/259) queda intacto Y casi sin costo extra: no se agrega ningún disparador por fila, ni índice, ni llave foránea en cascada sobre `tarifario_resultado` (se midió en local con
-- 12.669 filas, la forma del paquete 73; la medición y su análisis llegan con el PR de código, no con este de esquema). Sigue siendo el camino mientras `TARIFARIO_PUBLICACION_POR_LOTES` esté apagado en la app.
--
-- Qué agrega:
--   1. Generaciones almacenadas: `tarifario_resultado.generacion/revision_fuente/lote`; la vista `tarifario_resultado_publicable` (único punto de lectura comercial) y la política de
--      lectura de la tabla base solo dejan ver la generación PUBLICADA. El costo neto del hotel (`neto_hotel`) vive aparte (`tarifario_resultado_neto`), nunca en la tabla legible.
--   2. Manifiesto inalterable fijado ANTES de cargar (lotes, filas, SHA-256 del texto exacto de cada lote, composición de la 258, diagnóstico de la 256, modo/TRM de la 63).
--   3. Espera + cola + trabajador: la petición deja los lotes calculados «en espera» dentro de la base y un trabajador (`tarifario_cola_correr`, llamado por pg_cron si existe o por la
--      ruta /api/cron/publicacion-tarifario) los procesa SIN el navegador: reintentos con espera creciente, un solo trabajador por publicación (SKIP LOCKED), tope de intentos,
--      limpieza de esperas huérfanas.
--   4. Invalidación diferencial de hoteles: una tarifa/vigencia nueva que no cruza ni cambia la ganadora deja visible la oferta anterior; si cambia el resultado efectivo se
--      oculta de inmediato SOLO la combinación afectada (`tarifario_fila_oculta`). Reemplaza los dos disparadores por fila de la 181 sobre tarifa_hotel/hotel_temporadas.
--   5. Limpieza segura de generaciones superadas (un único DELETE).
-- REQUIERE las migraciones 256 y 258 (hotfix de traslados) y la 259. Reemplaza SOLO definiciones auditadas por huella exacta (tarifario_invalidar de la 181, la vista de la 256 y la
-- política de lectura de la 182); si fueron modificadas por otra vía ABORTA sin cambiar nada. Reaplicarla ya aplicada es idempotente. NO edita ninguna migración existente.
-- Preflight: supabase/scripts/preflight_260_publicacion_por_lotes.sql · Postcheck: postcheck_260_… · Rollback: rollback_260_….
begin;

do $$
declare
  v_invalidar text := md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.tarifario_invalidar(bigint[],boolean)')), chr(13), ''));
  v_vista     text := pg_get_viewdef(to_regclass('public.tarifario_resultado_publicable'), true);
  v_politica  text := (select pg_get_expr(pl.polqual, pl.polrelid) from pg_policy pl where pl.polrelid = 'public.tarifario_resultado'::regclass and pl.polname = 'tarifario_resultado: lectura');
begin
  if to_regclass('public.armado_paquetes') is null or to_regclass('public.tarifario_resultado') is null or to_regclass('public.tarifario_resultado_publicable') is null then
    raise exception '260 ABORTADA: faltan armado_paquetes/tarifario_resultado/tarifario_resultado_publicable.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'fechas_disponibles')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'tarifario_diagnostico') then
    raise exception '260 ABORTADA: falta la migración 256 (fechas_disponibles / tarifario_diagnostico). Aplica 255, 256 y 258 antes que la 260.';
  end if;
  if to_regclass('public.tarifario_composicion_publicada') is null then
    raise exception '260 ABORTADA: falta la migración 258 (tarifario_composicion_publicada). Aplica 255, 256 y 258 antes que la 260.';
  end if;
  if not exists (select 1 from pg_proc p where p.proname = 'publicar_tarifario_resultado' and p.pronamespace = 'public'::regnamespace and 'statement_timeout=30s' = any (p.proconfig)) then
    raise exception '260 ABORTADA: falta la migración 259 (publicar_tarifario_resultado con statement_timeout=30s).';
  end if;
  if to_regclass('public.tarifario_oferta_63') is null or to_regprocedure('public.p63_requiere_trm(bigint)') is null
     or to_regprocedure('public.iniciar_generacion_tarifario(bigint)') is null or to_regprocedure('public.mi_rol()') is null
     or to_regprocedure('public.tarifario_paquete_publicable(bigint)') is null then
    raise exception '260 ABORTADA: faltan objetos de las migraciones 181/182/234 (tarifario_oferta_63, p63_requiere_trm, iniciar_generacion_tarifario, mi_rol, tarifario_paquete_publicable).';
  end if;
  if v_invalidar is null then raise exception '260 ABORTADA: falta tarifario_invalidar (181).'; end if;
  -- Solo se acepta la huella EXACTA de la definición anterior auditada o la de la propia 260 (reaplicar). Nada de «contiene tal palabra»: un cambio ajeno que conserve el nombre
  -- de un objeto de la 260 sigue siendo ajeno y aborta SIN alterar nada.
  if v_invalidar not in ('8f8437d94500208538697508f06e0a3e', '444686e7dee9843b80da3dcca7f54da5') then
    raise exception '260 ABORTADA (REVISAR): tarifario_invalidar no es la definición auditada de la 181 ni la de la 260 (huella %); hay un cambio ajeno.', v_invalidar;
  end if;
  if md5(v_vista) not in ('882ad9b869dae2ffdf58a746f24d9631', '04f7b9f1b8e7053ef45335ce9cce0688') then
    raise exception '260 ABORTADA (REVISAR): tarifario_resultado_publicable no es la vista auditada de la 256 ni la de la 260 (huella %); hay un cambio ajeno.', md5(v_vista);
  end if;
  if v_politica is null then raise exception '260 ABORTADA: falta la política "tarifario_resultado: lectura" (182).'; end if;
  if md5(v_politica) not in ('89bc2fd35e941386c2449ea9536fa449', '585e5a4716a0e2ed88e09462d126e6e4') then
    raise exception '260 ABORTADA (REVISAR): la política de lectura de tarifario_resultado no es la auditada de la 182 ni la de la 260 (huella %); hay un cambio ajeno.', md5(v_politica);
  end if;
end $$;

-- ── 1. Esquema ──────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.tarifario_resultado
  add column if not exists generacion bigint,
  add column if not exists revision_fuente bigint,
  add column if not exists lote integer;
alter table public.armado_paquetes
  add column if not exists tarifario_por_generacion boolean not null default false;
comment on column public.tarifario_resultado.generacion is
  'Generación de publicación que escribió la fila. Solo es visible la igual a armado_paquetes.tarifario_generacion_publicada cuando tarifario_por_generacion = true. Migración 260.';

-- Costo NETO del hotel de la estadía (moneda del hotel, antes de markup): lo compara la invalidación diferencial. Tabla APARTE y sin acceso para anon/authenticated: nunca en la tabla legible.
-- SIN llave foránea a tarifario_resultado: un ON DELETE CASCADE obligaría al publicador monolítico a sondear esta tabla por CADA fila que borra (medido: lo encarecía). Los ids son de una secuencia y
-- nunca se reutilizan, así que una fila huérfana no puede asociarse a otra; la limpieza (tarifario_lote_limpiar_i y el mantenimiento del trabajador) las retira por conjuntos.
create table if not exists public.tarifario_resultado_neto (
  fila_id bigint primary key,
  neto_hotel numeric not null
);

create table if not exists public.tarifario_manifiesto (
  paquete_id bigint not null references public.armado_paquetes(id) on delete cascade,
  generacion bigint not null,
  revision_capturada bigint not null,
  moneda text not null check (moneda in ('COP', 'USD')),
  total_lotes integer not null check (total_lotes > 0),
  total_filas integer not null check (total_filas > 0),
  huella text not null check (huella ~ '^[0-9a-f]{64}$'),
  regla smallint not null default 1,
  composicion jsonb not null default '[]'::jsonb check (jsonb_typeof(composicion) = 'array'),
  modo text check (modo is null or modo = 'cop_trm_63'),
  trm numeric,
  diagnostico text,
  creado_en timestamptz not null default now(),
  primary key (paquete_id, generacion)
);
create table if not exists public.tarifario_manifiesto_lote (
  paquete_id bigint not null,
  generacion bigint not null,
  lote integer not null check (lote > 0),
  filas integer not null check (filas > 0),
  huella text not null check (huella ~ '^[0-9a-f]{64}$'),
  primary key (paquete_id, generacion, lote),
  foreign key (paquete_id, generacion) references public.tarifario_manifiesto (paquete_id, generacion) on delete cascade
);
-- Lo que SÍ se cargó (con la huella verificada contra el manifiesto).
create table if not exists public.tarifario_lote_control (
  paquete_id bigint not null,
  generacion bigint not null,
  lote integer not null,
  filas integer not null,
  huella text not null,
  creado_en timestamptz not null default now(),
  primary key (paquete_id, generacion, lote),
  foreign key (paquete_id, generacion, lote) references public.tarifario_manifiesto_lote (paquete_id, generacion, lote) on delete cascade
);
-- Texto de los lotes ya calculados, a la espera de que el trabajador los cargue. Se borra lote a lote al cargarse y en cascada con su manifiesto.
create table if not exists public.tarifario_lote_espera (
  paquete_id bigint not null,
  generacion bigint not null,
  lote integer not null,
  texto text not null,
  creado_en timestamptz not null default now(),
  primary key (paquete_id, generacion, lote),
  foreign key (paquete_id, generacion, lote) references public.tarifario_manifiesto_lote (paquete_id, generacion, lote) on delete cascade
);
-- Una publicación por paquete lista para que el trabajador la avance (todos sus lotes ya están cargados o en espera).
create table if not exists public.tarifario_publicacion_cola (
  paquete_id bigint primary key references public.armado_paquetes(id) on delete cascade,
  generacion bigint not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'limpiando', 'fallida')),
  intentos integer not null default 0,
  proximo_intento timestamptz not null default now(),
  ultimo_error text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists idx_tarifario_publicacion_cola_due on public.tarifario_publicacion_cola (proximo_intento) where estado <> 'fallida';
-- Filas cuyo resultado efectivo YA NO coincide con la fuente (ocultas de inmediato).
-- Sin llave foránea por la misma razón que tarifario_resultado_neto.
create table if not exists public.tarifario_fila_oculta (
  fila_id bigint primary key,
  paquete_id bigint not null,
  revision bigint not null,
  motivo text,
  creado_en timestamptz not null default now()
);
create index if not exists idx_tarifario_fila_oculta_paquete on public.tarifario_fila_oculta (paquete_id);
create table if not exists public.tarifario_cambio_fuente (
  id bigint generated always as identity primary key,
  paquete_id bigint not null references public.armado_paquetes(id) on delete cascade,
  revision bigint not null,
  alcance text not null check (alcance in ('paquete', 'aditivo')),
  motivo text,
  creado_en timestamptz not null default now()
);
create index if not exists idx_tarifario_cambio_fuente_paquete_rev on public.tarifario_cambio_fuente (paquete_id, revision);

-- Solo-inserción: ningún UPDATE, jamás, sobre el manifiesto.
create or replace function public.tarifario_manifiesto_inmutable() returns trigger language plpgsql as $$
begin raise exception 'el manifiesto de publicación es de solo inserción (no se actualiza)'; end $$;
drop trigger if exists tarifario_manifiesto_inmutable on public.tarifario_manifiesto;
drop trigger if exists tarifario_manifiesto_lote_inmutable on public.tarifario_manifiesto_lote;
create trigger tarifario_manifiesto_inmutable before update on public.tarifario_manifiesto for each row execute function public.tarifario_manifiesto_inmutable();
create trigger tarifario_manifiesto_lote_inmutable before update on public.tarifario_manifiesto_lote for each row execute function public.tarifario_manifiesto_inmutable();

-- Sin policies y sin acceso directo: solo las funciones SECURITY DEFINER las tocan.
alter table public.tarifario_resultado_neto enable row level security;
alter table public.tarifario_manifiesto enable row level security;
alter table public.tarifario_manifiesto_lote enable row level security;
alter table public.tarifario_lote_control enable row level security;
alter table public.tarifario_lote_espera enable row level security;
alter table public.tarifario_publicacion_cola enable row level security;
alter table public.tarifario_fila_oculta enable row level security;
alter table public.tarifario_cambio_fuente enable row level security;
revoke all on table public.tarifario_resultado_neto, public.tarifario_manifiesto, public.tarifario_manifiesto_lote, public.tarifario_lote_control, public.tarifario_lote_espera,
                    public.tarifario_publicacion_cola, public.tarifario_fila_oculta, public.tarifario_cambio_fuente from public, anon, authenticated;

-- El publicador MONOLÍTICO (código anterior / bandera apagada) inserta filas sin generación y mueve el puntero. Para que esas filas sean visibles y no se mezclen con generaciones almacenadas, en vez
-- de sellar CADA fila (un disparador por fila encarecía la publicación de 12.669 filas ~25 %), un disparador por PAQUETE —una sola ejecución por publicación— apaga la bandera cuando el puntero
-- avanza a una generación SIN manifiesto (= la publicó el monolítico). La activación por lotes pone la bandera en true en la misma sentencia, y su generación sí tiene manifiesto.
create or replace function public.tarifario_pub_monolitica() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.tarifario_generacion_publicada is distinct from old.tarifario_generacion_publicada
     and not exists (select 1 from public.tarifario_manifiesto m where m.paquete_id = new.id and m.generacion = new.tarifario_generacion_publicada) then
    new.tarifario_por_generacion := false;
  end if;
  return new;
end $$;
revoke all on function public.tarifario_pub_monolitica() from public, anon, authenticated;
drop trigger if exists tarifario_pub_monolitica on public.armado_paquetes;
create trigger tarifario_pub_monolitica before update of tarifario_generacion_publicada on public.armado_paquetes for each row execute function public.tarifario_pub_monolitica();
drop trigger if exists tarifario_resultado_sellar on public.tarifario_resultado;   -- versiones previas de este diseño
drop function if exists public.tarifario_resultado_sellar();

-- ── 2. Lectura: la vista y la política de la tabla base solo muestran la generación PUBLICADA ────────────────────────────
-- ¿Es visible esta fila para un rol externo? Helper SECURITY DEFINER (los externos no leen armado_paquetes ni las tablas de control).
create or replace function public.tarifario_fila_publicada(p_paquete_id bigint, p_generacion bigint, p_fila_id bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.armado_paquetes ap where ap.id = p_paquete_id
                  and ((p_generacion is null and not ap.tarifario_por_generacion) or p_generacion = ap.tarifario_generacion_publicada))
     and not exists (select 1 from public.tarifario_fila_oculta o where o.fila_id = p_fila_id)
$$;
revoke all on function public.tarifario_fila_publicada(bigint, bigint, bigint) from public;
grant execute on function public.tarifario_fila_publicada(bigint, bigint, bigint) to anon, authenticated;

drop policy if exists "tarifario_resultado: lectura" on public.tarifario_resultado;
create policy "tarifario_resultado: lectura" on public.tarifario_resultado
  for select
  using (
    coalesce(public.mi_rol()::text, '') in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    or (public.tarifario_paquete_publicable(paquete_id) and public.tarifario_fila_publicada(paquete_id, generacion, id))
  );

-- La vista (único punto de lectura comercial) lista las columnas de la tabla SIN los metadatos de generación (generacion, revision_fuente, lote): así no vuelve a heredar columnas internas por un `r.*`.
do $$
declare v_cols text;
begin
  select string_agg(format('r.%I', a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.tarifario_resultado'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname not in ('generacion', 'revision_fuente', 'lote');
  execute format($v$
    create or replace view public.tarifario_resultado_publicable
      with (security_barrier = true, security_invoker = false)
    as
    select %s
      from public.tarifario_resultado r
      join public.armado_paquetes ap on ap.id = r.paquete_id
     where ap.tarifario_snapshot_publicable = true and ap.activo = true
       -- Una fila de una generación NO publicada jamás es visible (tenga o no el paquete la bandera). Las filas heredadas (sin generación: anteriores a la 260) se ven mientras el paquete
       -- no haya publicado nunca por lotes; en cuanto lo hace, solo es visible la generación publicada.
       and ((r.generacion is null and not ap.tarifario_por_generacion) or r.generacion = ap.tarifario_generacion_publicada)
       and not exists (select 1 from public.tarifario_fila_oculta o where o.fila_id = r.id)
  $v$, v_cols);
end $$;

-- ── 3. Registro de cambios de fuente (alcance paquete / aditivo) ─────────────────────────────────────────────────────
create or replace function public.tarifario_invalidar(p_paquete_ids bigint[], p_bloquear boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_paquete_ids is null or array_length(p_paquete_ids, 1) is null then return; end if;
  if p_bloquear then
    with u as (update public.armado_paquetes set tarifario_revision_fuente = tarifario_revision_fuente + 1, tarifario_estado = 'pendiente', tarifario_snapshot_publicable = false
                where id = any (p_paquete_ids) returning id, tarifario_revision_fuente)
    insert into public.tarifario_cambio_fuente (paquete_id, revision, alcance, motivo) select id, tarifario_revision_fuente, 'paquete', 'bloqueo del paquete' from u;
  else
    with u as (update public.armado_paquetes set tarifario_revision_fuente = tarifario_revision_fuente + 1, tarifario_estado = 'pendiente'
                where id = any (p_paquete_ids) returning id, tarifario_revision_fuente)
    insert into public.tarifario_cambio_fuente (paquete_id, revision, alcance, motivo) select id, tarifario_revision_fuente, 'aditivo', 'cambio de tarifa/vigencia (se evalúa por fila)' from u;
  end if;
end $$;
revoke all on function public.tarifario_invalidar(bigint[], boolean) from public, anon, authenticated;

-- ── 4. Invalidación EXACTA de hoteles (réplica en SQL del criterio del motor lib/calc/paquetes.ts) ─────────────────────
create or replace function public.tarifario_vigencia_aplica(v public.hotel_temporadas, d date, p_hoy date, p_regimen text) returns boolean language sql immutable as $$
  select
    -- cobertura: todos sus rangos si los tiene, si no fecha_inicio/fecha_fin; los blackouts excluyen la noche
    (case when jsonb_typeof(v.rangos) = 'array' and jsonb_array_length(v.rangos) > 0
          then exists (select 1 from jsonb_array_elements(v.rangos) r where d between (r->>'fecha_inicio')::date and (r->>'fecha_fin')::date)
          else v.fecha_inicio is not null and v.fecha_fin is not null and d between v.fecha_inicio and v.fecha_fin end)
    and not (jsonb_typeof(v.blackouts) = 'array' and exists (select 1 from jsonb_array_elements(v.blackouts) b where d between (b->>'fecha_inicio')::date and (b->>'fecha_fin')::date))
    -- vigencia de compra (hoy, Bogotá) y régimen restringido
    and (v.compra_inicio is null or p_hoy >= v.compra_inicio) and (v.compra_fin is null or p_hoy <= v.compra_fin)
    and (v.regimen_restringido is null or v.regimen_restringido = p_regimen)
$$;
create or replace function public.tarifario_neto_de(t public.tarifa_hotel, p_acom text) returns numeric language sql immutable as $$
  select case p_acom when 'sencilla' then t.neto_sencilla when 'doble' then t.neto_doble when 'triple' then t.neto_triple when 'multiple' then t.neto_multiple
                     when 'nino' then t.neto_nino when 'nino2' then t.neto_nino2 when 'infante' then t.neto_infante end
$$;

-- Oculta las filas (de la publicada y la en curso, o de un lote concreto) cuyo resultado efectivo ya no coincide con la fuente actual.
create or replace function public.tarifario_evaluar_ocultar(p_paquete_id bigint, p_hotel_id bigint default null, p_categoria text default null, p_regimen text default null,
                                                           p_generacion bigint default null, p_lote integer default null, p_forzar boolean default false)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_rev bigint; v_pub bigint; v_act bigint; v_flag boolean; v_n integer;
begin
  select tarifario_revision_fuente, tarifario_generacion_publicada, tarifario_generacion, tarifario_por_generacion into v_rev, v_pub, v_act, v_flag from public.armado_paquetes where id = p_paquete_id;
  if not found then return 0; end if;
  with filas as (
    select r.id, r.hotel_id, r.categoria, r.regimen, r.acomodacion::text as acom, r.fecha_ida, r.noches, n.neto_hotel, r.procedencia_temporadas, r.modulo
      from public.tarifario_resultado r
      left join public.tarifario_resultado_neto n on n.fila_id = r.id
     where r.paquete_id = p_paquete_id and r.hotel_id is not null
       and (p_hotel_id is null or r.hotel_id = p_hotel_id)
       and (p_categoria is null or r.categoria = p_categoria)
       and (p_regimen is null or r.regimen = p_regimen)
       and (p_generacion is null or r.generacion = p_generacion)
       and (p_lote is null or r.lote = p_lote)
       and (p_generacion is not null or r.generacion is null or r.generacion in (v_pub, v_act))
       and not exists (select 1 from public.tarifario_fila_oculta o where o.fila_id = r.id)
  ),
  exactas as (
    select * from filas where modulo in ('bloqueo', 'dinamico') and neto_hotel is not null and fecha_ida is not null and coalesce(noches, 0) > 0
  ),
  noches as (
    select e.id, e.hotel_id, e.categoria, e.regimen, e.acom, k, e.fecha_ida + k as dia from exactas e cross join lateral generate_series(0, e.noches - 1) k
  ),
  -- Por noche: la vigencia de mayor prioridad (desempate: menor `orden`, luego menor id) que aplica Y tiene tarifa materializada para el combo.
  ganadora as (
    select distinct on (n.id, n.k) n.id, n.k, v.nombre, coalesce(v.tipo, 'tarifa') as tipo, public.tarifario_neto_de(t, n.acom) as neto, coalesce(t.precio_final_autoritativo, false) as pfa
      from noches n
      join public.hotel_temporadas v on v.hotel_id = n.hotel_id and coalesce(v.tipo, 'tarifa') <> 'promo_noche_gratis' and public.tarifario_vigencia_aplica(v, n.dia, v_hoy, n.regimen)
      join public.tarifa_hotel t on t.hotel_id = n.hotel_id and t.tipo_habitacion = n.categoria and t.alimentacion = n.regimen and t.temporada = v.nombre
     where public.tarifario_neto_de(t, n.acom) is not null
     order by n.id, n.k, coalesce(v.prioridad, 1) desc, v.orden asc, v.id asc
  ),
  resumen as (select g.id, count(*) as noches_ok, sum(g.neto) as suma from ganadora g group by g.id),
  procs as (
    select x.id, jsonb_agg(jsonb_build_object('temporada', x.nombre, 'es_promocion', x.promo, 'precio_final_autoritativo', x.pf) order by x.primera) as lista
      from (select g.id, g.nombre, (g.tipo <> 'tarifa') as promo, ((g.tipo <> 'tarifa') and g.pfa) as pf, min(g.k) as primera from ganadora g group by g.id, g.nombre, (g.tipo <> 'tarifa'), ((g.tipo <> 'tarifa') and g.pfa)) x
     group by x.id
  ),
  -- «N noches, 1 gratis»: se ancla a la noche de entrada; la primera vigencia de ese tipo que aplica y cuyo mínimo de noches cumple la estadía.
  promo as (
    select distinct on (e.id) e.id, v.nombre
      from exactas e
      join public.hotel_temporadas v on v.hotel_id = e.hotel_id and v.tipo = 'promo_noche_gratis' and public.tarifario_vigencia_aplica(v, e.fecha_ida, v_hoy, e.regimen) and coalesce(v.min_noches, 1) <= e.noches
     where e.noches > 1
     order by e.id, coalesce(v.prioridad, 1) desc, v.orden asc, v.id asc
  ),
  cambiadas as (
    select e.id
      from exactas e
      left join resumen s on s.id = e.id
      left join procs p on p.id = e.id
      left join promo pr on pr.id = e.id
     where coalesce(s.noches_ok, 0) < e.noches                                                                                              -- alguna noche quedó sin precio
        or abs(s.suma * case when pr.id is not null then (e.noches - 1)::numeric / e.noches else 1 end - e.neto_hotel) > 0.0001                -- el neto total cambió
        or (p.lista || case when pr.id is not null then jsonb_build_array(jsonb_build_object('temporada', pr.nombre, 'es_promocion', true, 'precio_final_autoritativo', false)) else '[]'::jsonb end)
           is distinct from e.procedencia_temporadas                                                                                         -- cambió quién ganó
  )
  insert into public.tarifario_fila_oculta (fila_id, paquete_id, revision, motivo)
  select x.id, p_paquete_id, v_rev, x.motivo from (
    select f.id, 'no verificable por resultado efectivo' as motivo from filas f
     where p_forzar or not (f.modulo in ('bloqueo', 'dinamico') and f.neto_hotel is not null and f.fecha_ida is not null and coalesce(f.noches, 0) > 0)
    union
    select c.id, 'el resultado efectivo cambió' from cambiadas c
  ) x
  on conflict (fila_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.tarifario_evaluar_ocultar(bigint, bigint, text, text, bigint, integer, boolean) from public, anon, authenticated;

-- Punto común de los disparadores: sube la revisión UNA vez por paquete afectado y evalúa por clave (hotel [, categoría, régimen]).
create or replace function public.tarifario_cambio_hotel(p_claves jsonb) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c jsonb; v_pq bigint; v_vistos bigint[] := '{}';
begin
  if p_claves is null then return; end if;
  for c in select * from jsonb_array_elements(p_claves) loop
    for v_pq in select distinct paquete_id from public.armado_hoteles where hotel_id = (c->>'hotel_id')::bigint loop
      if not (v_pq = any (v_vistos)) then perform public.tarifario_invalidar(array[v_pq], false); v_vistos := v_vistos || v_pq; end if;
      perform public.tarifario_evaluar_ocultar(v_pq, (c->>'hotel_id')::bigint, c->>'categoria', c->>'regimen', null, null, coalesce((c->>'forzar')::boolean, false));
    end loop;
  end loop;
end $$;
revoke all on function public.tarifario_cambio_hotel(jsonb) from public, anon, authenticated;

-- Disparadores por SENTENCIA con tablas de transición (una calculadora que reemplaza cientos de tarifas evalúa una vez, no una por fila).
create or replace function public.tarifario_trg_tarifa_ins() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.tarifario_cambio_hotel((select jsonb_agg(distinct jsonb_build_object('hotel_id', hotel_id, 'categoria', tipo_habitacion, 'regimen', alimentacion)) from nt));
  return null;
end $$;
create or replace function public.tarifario_trg_tarifa_upd() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.tarifario_cambio_hotel((
    select jsonb_agg(distinct jsonb_build_object('hotel_id', k.hotel_id, 'categoria', k.cat, 'regimen', k.reg, 'forzar', k.forzar))
      from (select n.hotel_id, n.tipo_habitacion as cat, n.alimentacion as reg,
                   -- campos que cambian filas sin cambiar el neto ni el ganador (edades de niño/infante, base): no verificables → se ocultan todas las de la clave
                   (o.edad_infante_min, o.edad_infante_max, o.edad_nino_min, o.edad_nino_max, o.temporada_base) is distinct from (n.edad_infante_min, n.edad_infante_max, n.edad_nino_min, n.edad_nino_max, n.temporada_base) as forzar
              from nt n left join ot o on o.id = n.id
            union all select o.hotel_id, o.tipo_habitacion, o.alimentacion, false from ot o) k));
  return null;
end $$;
create or replace function public.tarifario_trg_tarifa_del() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.tarifario_cambio_hotel((select jsonb_agg(distinct jsonb_build_object('hotel_id', hotel_id, 'categoria', tipo_habitacion, 'regimen', alimentacion)) from ot));
  return null;
end $$;
create or replace function public.tarifario_trg_vigencia_ins() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.tarifario_cambio_hotel((select jsonb_agg(distinct jsonb_build_object('hotel_id', hotel_id)) from nt));
  return null;
end $$;
create or replace function public.tarifario_trg_vigencia_upd() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.tarifario_cambio_hotel((select jsonb_agg(distinct jsonb_build_object('hotel_id', h)) from (select hotel_id as h from nt union select hotel_id from ot) x));
  return null;
end $$;
create or replace function public.tarifario_trg_vigencia_del() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.tarifario_cambio_hotel((select jsonb_agg(distinct jsonb_build_object('hotel_id', hotel_id)) from ot));
  return null;
end $$;
revoke all on function public.tarifario_trg_tarifa_ins(), public.tarifario_trg_tarifa_upd(), public.tarifario_trg_tarifa_del(),
                       public.tarifario_trg_vigencia_ins(), public.tarifario_trg_vigencia_upd(), public.tarifario_trg_vigencia_del() from public, anon, authenticated;

-- Reemplazan a los dos disparadores POR FILA de la 181 (tarifario_trg_bump_por_hotel sigue existiendo: el rollback los restituye).
drop trigger if exists tarifario_trg_tarifa_hotel on public.tarifa_hotel;
drop trigger if exists tarifario_trg_hotel_temporadas on public.hotel_temporadas;
drop trigger if exists tarifario_trg_tarifa_hotel_ins on public.tarifa_hotel;
drop trigger if exists tarifario_trg_tarifa_hotel_upd on public.tarifa_hotel;
drop trigger if exists tarifario_trg_tarifa_hotel_del on public.tarifa_hotel;
drop trigger if exists tarifario_trg_hotel_temporadas_ins on public.hotel_temporadas;
drop trigger if exists tarifario_trg_hotel_temporadas_upd on public.hotel_temporadas;
drop trigger if exists tarifario_trg_hotel_temporadas_del on public.hotel_temporadas;
create trigger tarifario_trg_tarifa_hotel_ins after insert on public.tarifa_hotel referencing new table as nt for each statement execute function public.tarifario_trg_tarifa_ins();
create trigger tarifario_trg_tarifa_hotel_upd after update on public.tarifa_hotel referencing old table as ot new table as nt for each statement execute function public.tarifario_trg_tarifa_upd();
create trigger tarifario_trg_tarifa_hotel_del after delete on public.tarifa_hotel referencing old table as ot for each statement execute function public.tarifario_trg_tarifa_del();
create trigger tarifario_trg_hotel_temporadas_ins after insert on public.hotel_temporadas referencing new table as nt for each statement execute function public.tarifario_trg_vigencia_ins();
create trigger tarifario_trg_hotel_temporadas_upd after update on public.hotel_temporadas referencing old table as ot new table as nt for each statement execute function public.tarifario_trg_vigencia_upd();
create trigger tarifario_trg_hotel_temporadas_del after delete on public.hotel_temporadas referencing old table as ot for each statement execute function public.tarifario_trg_vigencia_del();

-- ── 5. Publicación por lotes ────────────────────────────────────────────────────────────────────────────────────────
-- 5.1 Manifiesto: se FIJA antes de cargar. p_lotes = [{"lote":1,"filas":1000,"huella":"<sha256 hex del texto EXACTO del lote>"}, …]. Idempotente si es idéntico.
-- p_composicion = [{"fecha_ida":"2026-12-20","servicios_incluidos":[112]}, …] (258; un arreglo vacío es una fecha acreditada SIN servicios incluidos) y p_regla; p_diagnostico = texto de la
-- 256; p_modo/p_trm = modo 63 (233/234). Todo queda inalterable.
create or replace function public.tarifario_manifiesto_crear(p_paquete_id bigint, p_generacion bigint, p_revision_capturada bigint, p_moneda text, p_lotes jsonb,
                                                            p_composicion jsonb default '[]'::jsonb, p_regla smallint default 1, p_modo text default null, p_trm numeric default null,
                                                            p_diagnostico text default null)
returns text language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '30s' set lock_timeout = '8s' as $$
declare v_gen bigint; v_n integer; v_filas integer; v_huella text; v_modo text; v_trm numeric; v_mp text; e public.tarifario_manifiesto; v_diag text := nullif(left(coalesce(p_diagnostico, ''), 2000), '');
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'tarifario_manifiesto_crear: rol sin permiso de escritura sobre tarifario_resultado';
  end if;
  if p_paquete_id is null or p_generacion is null or p_revision_capturada is null or p_moneda is null or p_moneda not in ('COP', 'USD') or p_lotes is null or jsonb_typeof(p_lotes) <> 'array' then
    raise exception 'tarifario_manifiesto_crear: parámetros obligatorios (moneda COP o USD; p_lotes arreglo)';
  end if;
  if p_composicion is null or jsonb_typeof(p_composicion) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_composicion) c where jsonb_typeof(c) <> 'object' or coalesce(c->>'fecha_ida', '') !~ '^\d{4}-\d{2}-\d{2}$'
                                                                         or (c ? 'servicios_incluidos' and jsonb_typeof(c->'servicios_incluidos') <> 'array')) then
    raise exception 'tarifario_manifiesto_crear: p_composicion debe ser un arreglo de {fecha_ida, servicios_incluidos[]}';
  end if;
  if p_modo is not null and p_modo <> 'cop_trm_63' then raise exception 'tarifario_manifiesto_crear: p_modo debe ser cop_trm_63 o no enviarse'; end if;
  if p_trm is not null and (p_trm = 'NaN'::numeric or p_trm <= 0 or p_trm >= 100000000000) then raise exception 'tarifario_manifiesto_crear: la TRM debe ser positiva y finita'; end if;
  v_n := jsonb_array_length(p_lotes);
  if v_n = 0 then raise exception 'tarifario_manifiesto_crear: el manifiesto no puede estar vacío'; end if;
  if exists (select 1 from jsonb_array_elements(p_lotes) with ordinality x(v, ord)
              where jsonb_typeof(x.v) <> 'object' or (x.v->>'lote') is distinct from x.ord::text or coalesce((x.v->>'filas'), '') !~ '^[1-9][0-9]*$' or coalesce(x.v->>'huella', '') !~ '^[0-9a-f]{64}$') then
    raise exception 'tarifario_manifiesto_crear: cada lote debe ser {lote (1..N contiguo), filas >= 1, huella sha256 hex}';
  end if;
  select sum((x.v->>'filas')::int) into v_filas from jsonb_array_elements(p_lotes) x(v);
  select encode(sha256(convert_to(string_agg((x.v->>'lote') || ':' || (x.v->>'filas') || ':' || (x.v->>'huella'), E'\n' order by x.ord), 'UTF8')), 'hex') into v_huella
    from jsonb_array_elements(p_lotes) with ordinality x(v, ord);

  select tarifario_generacion, modo_oferta, trm_oferta, moneda_publicacion into v_gen, v_modo, v_trm, v_mp from public.armado_paquetes where id = p_paquete_id for key share;
  if not found then raise exception 'tarifario_manifiesto_crear: paquete % no encontrado', p_paquete_id; end if;
  if v_gen <> p_generacion then return 'obsoleta'; end if;
  if p_modo is not null and (v_modo is distinct from 'cop_trm_63' or v_trm is distinct from p_trm or coalesce(v_mp, 'COP') is distinct from p_moneda) then return 'modo_cambio'; end if;

  select * into e from public.tarifario_manifiesto where paquete_id = p_paquete_id and generacion = p_generacion;
  if found then
    return case when e.huella = v_huella and e.composicion = p_composicion and e.regla = p_regla and e.modo is not distinct from p_modo and e.trm is not distinct from p_trm
                     and e.moneda = p_moneda and e.diagnostico is not distinct from v_diag
                then 'ok' else 'conflicto' end;   -- reanudar con el MISMO contenido, o es otro cálculo: generación nueva
  end if;
  insert into public.tarifario_manifiesto (paquete_id, generacion, revision_capturada, moneda, total_lotes, total_filas, huella, regla, composicion, modo, trm, diagnostico)
    values (p_paquete_id, p_generacion, p_revision_capturada, p_moneda, v_n, v_filas, v_huella, p_regla, p_composicion, p_modo, p_trm, v_diag);
  insert into public.tarifario_manifiesto_lote (paquete_id, generacion, lote, filas, huella)
    select p_paquete_id, p_generacion, (x.v->>'lote')::int, (x.v->>'filas')::int, x.v->>'huella' from jsonb_array_elements(p_lotes) x(v);
  return 'ok';
end $$;
revoke all on function public.tarifario_manifiesto_crear(bigint, bigint, bigint, text, jsonb, jsonb, smallint, text, numeric, text) from public, anon;
grant execute on function public.tarifario_manifiesto_crear(bigint, bigint, bigint, text, jsonb, jsonb, smallint, text, numeric, text) to authenticated;

-- 5.2 Lote (interno, sin comprobación de rol: lo llama el trabajador, que corre sin sesión de usuario). El TEXTO exacto se verifica contra la huella fijada y el número de filas contra el
-- manifiesto. Idempotente: reintento = no-op. Solo FOR KEY SHARE del paquete.
create or replace function public.tarifario_lote_agregar_i(p_paquete_id bigint, p_generacion bigint, p_lote integer, p_filas_txt text)
returns text language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '30s' set lock_timeout = '8s' as $$
declare v_gen bigint; v_activo boolean; v_rev bigint; m public.tarifario_manifiesto; l public.tarifario_manifiesto_lote; v_filas jsonb; v_n integer; v_constraint text;
  v_seq regclass := pg_get_serial_sequence('public.tarifario_resultado', 'id')::regclass;
begin
  if p_paquete_id is null or p_generacion is null or p_lote is null or p_filas_txt is null then raise exception 'tarifario_lote_agregar: parámetros obligatorios'; end if;

  select tarifario_generacion, activo, tarifario_revision_fuente into v_gen, v_activo, v_rev from public.armado_paquetes where id = p_paquete_id for key share;
  if not found then raise exception 'tarifario_lote_agregar: paquete % no encontrado', p_paquete_id; end if;
  if v_gen <> p_generacion then return 'obsoleta'; end if;
  select * into m from public.tarifario_manifiesto where paquete_id = p_paquete_id and generacion = p_generacion;
  if not found then return 'sin_manifiesto'; end if;
  select * into l from public.tarifario_manifiesto_lote where paquete_id = p_paquete_id and generacion = p_generacion and lote = p_lote;
  if not found then return 'lote_desconocido'; end if;
  if encode(sha256(convert_to(p_filas_txt, 'UTF8')), 'hex') <> l.huella then return 'huella'; end if;   -- el contenido NO es el fijado
  if exists (select 1 from public.tarifario_lote_control where paquete_id = p_paquete_id and generacion = p_generacion and lote = p_lote) then return 'ok'; end if;   -- ya cargado
  if exists (select 1 from public.tarifario_cambio_fuente where paquete_id = p_paquete_id and revision > m.revision_capturada and alcance = 'paquete') then return 'fuente_cambio'; end if;

  v_filas := p_filas_txt::jsonb;
  if jsonb_typeof(v_filas) <> 'array' or jsonb_array_length(v_filas) <> l.filas then return 'filas'; end if;
  if exists (select 1 from jsonb_array_elements(v_filas) e where jsonb_typeof(e) <> 'object') then raise exception 'tarifario_lote_agregar: cada elemento debe ser un objeto jsonb'; end if;
  if exists (select 1 from jsonb_array_elements(v_filas) e where e ? 'paquete_id' and e->>'paquete_id' is not null and (e->>'paquete_id') !~ '^[0-9]+$') then
    raise exception 'tarifario_lote_agregar: paquete_id de una fila no es numérico';
  end if;
  if exists (select 1 from jsonb_array_elements(v_filas) e where e ? 'paquete_id' and e->>'paquete_id' is not null and (e->>'paquete_id')::bigint <> p_paquete_id) then
    raise exception 'tarifario_lote_agregar: una fila declara un paquete_id distinto al solicitado';
  end if;

  begin
    -- Cada lote es UNA transacción (filas + control): un intento que falla no deja restos, así que no hay nada que borrar antes. Los ids se toman de la secuencia ANTES de insertar para enlazar el neto del
    -- hotel (tabla aparte) sin volver a buscar las filas.
    with filas as materialized (
      select f.v, f.ord, nextval(v_seq) as id from jsonb_array_elements(v_filas) with ordinality as f(v, ord) order by f.ord
    ), ins as (
      insert into public.tarifario_resultado (
        id, paquete_id, paquete_nombre, paquete_activo, modulo, bloqueo_id, bloqueo_label, empaquetado_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
        destino_id, destino_nombre, categoria, regimen, acomodacion, noches, fecha_ida, fecha_regreso, pax_desde, pax_hasta, tipo_tarifa,
        base_comisionable, impuesto, precio_pvp, precio_pvp_menor2, precio_pvp_sin_fijo, precio_pvp_menor2_sin_fijo, descripcion, recargo_individual,
        moneda, salida_id, temporada_ganadora, es_promocion, precio_final_autoritativo, procedencia_temporadas, procedencia_mixta, fechas_disponibles,
        generacion, revision_fuente, lote)
      select f.id, p_paquete_id, f.v->>'paquete_nombre', v_activo, (f.v->>'modulo')::public.tarifario_modulo, (f.v->>'bloqueo_id')::bigint, f.v->>'bloqueo_label',
             (f.v->>'empaquetado_id')::bigint, (f.v->>'hotel_id')::bigint, f.v->>'hotel_nombre', (f.v->>'servicio_id')::bigint, f.v->>'servicio_nombre',
             (f.v->>'destino_id')::bigint, f.v->>'destino_nombre', f.v->>'categoria', f.v->>'regimen', (f.v->>'acomodacion')::public.acomodacion_tipo, (f.v->>'noches')::integer,
             (f.v->>'fecha_ida')::date, (f.v->>'fecha_regreso')::date, (f.v->>'pax_desde')::integer, (f.v->>'pax_hasta')::integer, f.v->>'tipo_tarifa',
             coalesce((f.v->>'base_comisionable')::numeric, 0), coalesce((f.v->>'impuesto')::numeric, 0), coalesce((f.v->>'precio_pvp')::numeric, 0),
             (f.v->>'precio_pvp_menor2')::numeric, (f.v->>'precio_pvp_sin_fijo')::numeric, (f.v->>'precio_pvp_menor2_sin_fijo')::numeric, f.v->>'descripcion', (f.v->>'recargo_individual')::numeric,
             m.moneda, (f.v->>'salida_id')::bigint, f.v->>'temporada_ganadora', (f.v->>'es_promocion')::boolean, (f.v->>'precio_final_autoritativo')::boolean,
             case when not (f.v ? 'procedencia_temporadas') or f.v->'procedencia_temporadas' = 'null'::jsonb then null else f.v->'procedencia_temporadas' end,
             coalesce((f.v->>'procedencia_mixta')::boolean, false),
             case when jsonb_typeof(f.v->'fechas_disponibles') = 'array' then f.v->'fechas_disponibles' else null end,
             p_generacion, m.revision_capturada, p_lote
        from filas f order by f.ord
      returning 1
    )
    insert into public.tarifario_resultado_neto (fila_id, neto_hotel)
    select f.id, (f.v->>'neto_hotel')::numeric from filas f where nullif(f.v->>'neto_hotel', '') is not null;
    v_n := l.filas;   -- la cantidad ya se validó contra el manifiesto (jsonb_array_length = l.filas)
    insert into public.tarifario_lote_control (paquete_id, generacion, lote, filas, huella) values (p_paquete_id, p_generacion, p_lote, v_n, l.huella);
  exception when foreign_key_violation then
    get stacked diagnostics v_constraint = constraint_name;
    -- SOLO la FK propia del control (el manifiesto desapareció porque la limpieza retiró una generación ya superada) significa «obsoleta».
    -- Una FK de los DATOS (hotel, bloqueo, destino, servicio, empaquetado o paquete inexistentes) es un error real: se propaga y revierte el lote.
    if v_constraint like 'tarifario\_lote\_control\_%' then return 'obsoleta'; end if;
    raise;
  end;
  -- Si la fuente ya cambió desde la captura, las filas recién cargadas se evalúan contra la fuente ACTUAL (la activación rechaza lo que ya no coincide).
  if v_rev <> m.revision_capturada then perform public.tarifario_evaluar_ocultar(p_paquete_id, null, null, null, p_generacion, p_lote, false); end if;
  return 'ok';
end $$;
revoke all on function public.tarifario_lote_agregar_i(bigint, bigint, integer, text) from public, anon, authenticated;

create or replace function public.tarifario_lote_agregar(p_paquete_id bigint, p_generacion bigint, p_lote integer, p_filas_txt text)
returns text language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '30s' set lock_timeout = '8s' as $$
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'tarifario_lote_agregar: rol sin permiso de escritura sobre tarifario_resultado';
  end if;
  return public.tarifario_lote_agregar_i(p_paquete_id, p_generacion, p_lote, p_filas_txt);
end $$;
revoke all on function public.tarifario_lote_agregar(bigint, bigint, integer, text) from public, anon;
grant execute on function public.tarifario_lote_agregar(bigint, bigint, integer, text) to authenticated;

-- 5.3 Estado de una publicación (para reanudar desde otra petición/proceso).
create or replace function public.tarifario_publicacion_estado(p_paquete_id bigint, p_generacion bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare m public.tarifario_manifiesto; v_gen bigint; v_rev bigint; v_pend integer[]; v_esp integer[]; v_pub bigint; c public.tarifario_publicacion_cola;
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then raise exception 'tarifario_publicacion_estado: rol sin permiso'; end if;
  select tarifario_generacion, tarifario_revision_fuente, tarifario_generacion_publicada into v_gen, v_rev, v_pub from public.armado_paquetes where id = p_paquete_id;
  if not found then return jsonb_build_object('existe', false); end if;
  select * into m from public.tarifario_manifiesto where paquete_id = p_paquete_id and generacion = p_generacion;
  if not found then return jsonb_build_object('existe', false, 'vigente', v_gen = p_generacion); end if;
  select coalesce(array_agg(l.lote order by l.lote), '{}') into v_pend from public.tarifario_manifiesto_lote l
   where l.paquete_id = p_paquete_id and l.generacion = p_generacion
     and not exists (select 1 from public.tarifario_lote_control c2 where c2.paquete_id = l.paquete_id and c2.generacion = l.generacion and c2.lote = l.lote);
  select coalesce(array_agg(e.lote order by e.lote), '{}') into v_esp from public.tarifario_lote_espera e where e.paquete_id = p_paquete_id and e.generacion = p_generacion;
  select * into c from public.tarifario_publicacion_cola where paquete_id = p_paquete_id and generacion = p_generacion;
  return jsonb_build_object('existe', true, 'vigente', v_gen = p_generacion, 'publicada', v_pub = p_generacion, 'total_lotes', m.total_lotes, 'total_filas', m.total_filas,
                            'pendientes', to_jsonb(v_pend), 'en_espera', to_jsonb(v_esp), 'revision_capturada', m.revision_capturada, 'revision_actual', v_rev, 'huella', m.huella,
                            'en_cola', c.paquete_id is not null, 'cola_estado', c.estado, 'cola_intentos', c.intentos, 'cola_error', c.ultimo_error);
end $$;
revoke all on function public.tarifario_publicacion_estado(bigint, bigint) from public, anon;
grant execute on function public.tarifario_publicacion_estado(bigint, bigint) to authenticated;

-- Publicación EN CURSO del paquete (la generación vigente con manifiesto y sin publicar): lo que el controlador consulta al abrir la pantalla.
create or replace function public.tarifario_publicacion_pendiente(p_paquete_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_gen bigint; v_pub bigint; m public.tarifario_manifiesto;
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then raise exception 'tarifario_publicacion_pendiente: rol sin permiso'; end if;
  select tarifario_generacion, tarifario_generacion_publicada into v_gen, v_pub from public.armado_paquetes where id = p_paquete_id;
  if not found or v_gen is not distinct from v_pub then return jsonb_build_object('pendiente', false); end if;
  select * into m from public.tarifario_manifiesto where paquete_id = p_paquete_id and generacion = v_gen;
  if not found then return jsonb_build_object('pendiente', false); end if;
  -- Una publicación cuya fuente cambió (alcance paquete) ya no se puede reanudar: no se ofrece «continuar»; hay que volver a generar.
  if exists (select 1 from public.tarifario_cambio_fuente where paquete_id = p_paquete_id and revision > m.revision_capturada and alcance = 'paquete') then
    return jsonb_build_object('pendiente', false, 'descartada', true);
  end if;
  return jsonb_build_object('pendiente', true, 'generacion', v_gen) || public.tarifario_publicacion_estado(p_paquete_id, v_gen);
end $$;
revoke all on function public.tarifario_publicacion_pendiente(bigint) from public, anon;
grant execute on function public.tarifario_publicacion_pendiente(bigint) to authenticated;

-- 5.4 ACTIVACIÓN (interna). SIN totales del llamador: todo sale del manifiesto fijado antes de cargar. Acredita la composición de la 258 y el diagnóstico de la 256 en la MISMA transacción.
create or replace function public.tarifario_lote_activar_i(p_paquete_id bigint, p_generacion bigint)
returns text language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '30s' set lock_timeout = '8s' as $$
declare v_gen bigint; v_rev bigint; v_activo boolean; v_modo text; v_trm numeric; v_mp text; m public.tarifario_manifiesto; v_reales bigint; v_malos integer; v_desfase integer; v_fuentes jsonb;
begin
  if p_paquete_id is null or p_generacion is null then raise exception 'tarifario_lote_activar: parámetros obligatorios'; end if;
  select tarifario_generacion, tarifario_revision_fuente, activo, modo_oferta, trm_oferta, moneda_publicacion into v_gen, v_rev, v_activo, v_modo, v_trm, v_mp
    from public.armado_paquetes where id = p_paquete_id for update;
  if not found then raise exception 'tarifario_lote_activar: paquete % no encontrado', p_paquete_id; end if;
  if v_gen <> p_generacion then return 'obsoleta'; end if;
  select * into m from public.tarifario_manifiesto where paquete_id = p_paquete_id and generacion = p_generacion;
  if not found then return 'sin_manifiesto'; end if;

  -- Modo 63 (233/234): lo que se calculó debe coincidir con lo guardado bajo candado.
  if m.modo is not null then
    if v_modo is distinct from 'cop_trm_63' or v_trm is distinct from m.trm or coalesce(v_mp, 'COP') is distinct from m.moneda then return 'modo_cambio'; end if;
    if v_trm is null and public.p63_requiere_trm(p_paquete_id) then raise exception 'p63_trm_requerida: hay componentes del paquete en USD y el paquete no tiene una TRM positiva'; end if;
  end if;

  -- Un cambio de alcance paquete, o una fila de ESTA generación que la fuente actual ya contradice, invalida el cálculo.
  if v_rev <> m.revision_capturada
     and exists (select 1 from public.tarifario_cambio_fuente where paquete_id = p_paquete_id and revision > m.revision_capturada and alcance = 'paquete') then
    update public.armado_paquetes set tarifario_estado = 'pendiente' where id = p_paquete_id;
    return 'fuente_cambio';
  end if;
  if exists (select 1 from public.tarifario_fila_oculta o join public.tarifario_resultado r on r.id = o.fila_id where r.paquete_id = p_paquete_id and r.generacion = p_generacion) then
    update public.armado_paquetes set tarifario_estado = 'pendiente' where id = p_paquete_id;
    return 'fuente_cambio';
  end if;

  -- TODOS los lotes del manifiesto, cargados con su huella, con sus filas, y ninguna fila de más ni de menos.
  select count(*) into v_malos from public.tarifario_manifiesto_lote l
   where l.paquete_id = p_paquete_id and l.generacion = p_generacion
     and not exists (select 1 from public.tarifario_lote_control c where c.paquete_id = l.paquete_id and c.generacion = l.generacion and c.lote = l.lote and c.huella = l.huella and c.filas = l.filas);
  -- UNA pasada agrupada por lote (un conteo correlacionado por lote recorrería el paquete entero 23 veces): total de filas reales y lotes cuyo conteo difiere del manifiesto.
  with real as (select r.lote, count(*) as n from public.tarifario_resultado r where r.paquete_id = p_paquete_id and r.generacion = p_generacion group by r.lote),
       cmp as (select count(*) filter (where real.n is distinct from l.filas) as d from public.tarifario_manifiesto_lote l left join real on real.lote = l.lote where l.paquete_id = p_paquete_id and l.generacion = p_generacion)
  select (select coalesce(sum(real.n), 0) from real), (select d from cmp) into v_reales, v_desfase;
  if v_malos > 0 or v_reales <> m.total_filas or v_desfase > 0 then
    return 'incompleta';
  end if;

  -- 258: con servicios incluidos, cada fecha de ida publicada (bloqueo/dinámico) debe tener su composición en el manifiesto (un arreglo vacío SÍ la acredita: todos sus incluidos
  -- se omitieron por falta de tarifa esa fecha); si falta la fecha, NO se activa.
  if exists (select 1 from public.armado_servicios s where s.paquete_id = p_paquete_id and s.incluido)
     and exists (select 1 from (select distinct r.fecha_ida from public.tarifario_resultado r
                                 where r.paquete_id = p_paquete_id and r.generacion = p_generacion and r.modulo in ('bloqueo', 'dinamico') and r.fecha_ida is not null) f
                  where not exists (select 1 from jsonb_array_elements(m.composicion) c where (c->>'fecha_ida')::date = f.fecha_ida)) then
    return 'sin_composicion';
  end if;

  update public.armado_paquetes set
    tarifario_generacion_publicada = p_generacion, tarifario_revision_publicada = m.revision_capturada, tarifario_por_generacion = true,
    tarifario_estado = 'listo',   -- lo publicado es válido (los cambios posteriores no lo afectan): la 256/258 exigen 'listo' para registrar diagnóstico y composición
    tarifario_error = null, tarifario_diagnostico = m.diagnostico, tarifario_snapshot_publicable = v_activo, tarifario_actualizado_en = now(), moneda = m.moneda
  where id = p_paquete_id;
  -- Composición de la 258 (reemplaza la del paquete, como registrar_composicion_publicada): MISMA transacción que el cambio de puntero.
  delete from public.tarifario_composicion_publicada where paquete_id = p_paquete_id;
  insert into public.tarifario_composicion_publicada (paquete_id, fecha_ida, generacion, regla, servicios_incluidos)
    select p_paquete_id, (c->>'fecha_ida')::date, p_generacion, m.regla, coalesce(c->'servicios_incluidos', '[]'::jsonb) from jsonb_array_elements(m.composicion) c
    on conflict (paquete_id, fecha_ida) do update set generacion = excluded.generacion, regla = excluded.regla, servicios_incluidos = excluded.servicios_incluidos, registrado_en = now();
  -- Oferta 63 (234): lo que registra publicar_tarifario_resultado_63 tras publicar.
  if m.modo is not null then
    select coalesce(jsonb_agg(jsonb_build_object('salida_id', s.id, 'empaquetado_id', s.empaquetado_id, 'valor_tiquete', s.valor_tiquete, 'fee_infante', s.fee_infante) order by s.id), '[]'::jsonb)
      into v_fuentes from public.salidas_dinamicas s where s.paquete_id = p_paquete_id and s.empaquetado_id is not null;
    insert into public.tarifario_oferta_63 as o (paquete_id, modo, trm, generacion, revision_fuente, fuentes, publicado_en)
      values (p_paquete_id, m.modo, m.trm, p_generacion, m.revision_capturada, v_fuentes, now())
      on conflict (paquete_id) do update set modo = excluded.modo, trm = excluded.trm, generacion = excluded.generacion, revision_fuente = excluded.revision_fuente, fuentes = excluded.fuentes, publicado_en = excluded.publicado_en;
  end if;
  delete from public.tarifario_cambio_fuente where paquete_id = p_paquete_id and revision <= m.revision_capturada;
  return 'ok';
end $$;
revoke all on function public.tarifario_lote_activar_i(bigint, bigint) from public, anon, authenticated;

create or replace function public.tarifario_lote_activar(p_paquete_id bigint, p_generacion bigint)
returns text language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '30s' set lock_timeout = '8s' as $$
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'tarifario_lote_activar: rol sin permiso de escritura sobre tarifario_resultado';
  end if;
  return public.tarifario_lote_activar_i(p_paquete_id, p_generacion);
end $$;
revoke all on function public.tarifario_lote_activar(bigint, bigint) from public, anon;
grant execute on function public.tarifario_lote_activar(bigint, bigint) to authenticated;

-- 5.5 LIMPIEZA SEGURA. Un único DELETE: el paquete y las filas se leen en la MISMA instantánea, así que lo que borra es exactamente «ni publicada ni en curso»
-- según ese instante; una generación que arranque o se active después no existe para este DELETE. Los manifiestos (y con ellos la espera) se borran igual.
create or replace function public.tarifario_lote_limpiar_i(p_paquete_id bigint, p_max integer default 4000)
returns integer language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '30s' set lock_timeout = '8s' as $$
declare v_n integer;
begin
  with d as (
    delete from public.tarifario_resultado where ctid in (
      select r.ctid from public.tarifario_resultado r join public.armado_paquetes ap on ap.id = r.paquete_id
       where r.paquete_id = p_paquete_id
         and ((r.generacion is null and ap.tarifario_por_generacion)
              or (r.generacion is not null and r.generacion is distinct from ap.tarifario_generacion_publicada and r.generacion <> ap.tarifario_generacion))
       limit greatest(p_max, 1))
    returning id
  ), n as (delete from public.tarifario_resultado_neto where fila_id in (select id from d)),
     o as (delete from public.tarifario_fila_oculta where fila_id in (select id from d))
  select count(*) into v_n from d;
  delete from public.tarifario_manifiesto m using public.armado_paquetes ap
   where ap.id = m.paquete_id and m.paquete_id = p_paquete_id
     and m.generacion is distinct from ap.tarifario_generacion_publicada and m.generacion <> ap.tarifario_generacion;
  return v_n;
end $$;
revoke all on function public.tarifario_lote_limpiar_i(bigint, integer) from public, anon, authenticated;

create or replace function public.tarifario_lote_limpiar(p_paquete_id bigint, p_max integer default 4000)
returns integer language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '30s' set lock_timeout = '8s' as $$
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then raise exception 'tarifario_lote_limpiar: rol sin permiso'; end if;
  return public.tarifario_lote_limpiar_i(p_paquete_id, p_max);
end $$;
revoke all on function public.tarifario_lote_limpiar(bigint, integer) from public, anon;
grant execute on function public.tarifario_lote_limpiar(bigint, integer) to authenticated;

-- ── 6. Continuación SIN navegador: espera, cola y trabajador ─────────────────────────────────────────────────────────
-- 6.1 Deja un lote ya calculado «en espera» (la petición lo sube UNA vez; el trabajador no vuelve a transportar filas). Verifica la huella antes de aceptarlo.
create or replace function public.tarifario_lote_espera_guardar(p_paquete_id bigint, p_generacion bigint, p_lote integer, p_filas_txt text)
returns text language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '30s' set lock_timeout = '8s' as $$
declare v_gen bigint; l public.tarifario_manifiesto_lote;
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'tarifario_lote_espera_guardar: rol sin permiso de escritura sobre tarifario_resultado';
  end if;
  if p_paquete_id is null or p_generacion is null or p_lote is null or p_filas_txt is null then raise exception 'tarifario_lote_espera_guardar: parámetros obligatorios'; end if;
  select tarifario_generacion into v_gen from public.armado_paquetes where id = p_paquete_id for key share;
  if not found then raise exception 'tarifario_lote_espera_guardar: paquete % no encontrado', p_paquete_id; end if;
  if v_gen <> p_generacion then return 'obsoleta'; end if;
  select * into l from public.tarifario_manifiesto_lote where paquete_id = p_paquete_id and generacion = p_generacion and lote = p_lote;
  if not found then return 'lote_desconocido'; end if;
  if encode(sha256(convert_to(p_filas_txt, 'UTF8')), 'hex') <> l.huella then return 'huella'; end if;
  -- Un lote que ya está cargado no necesita su texto.
  if exists (select 1 from public.tarifario_lote_control where paquete_id = p_paquete_id and generacion = p_generacion and lote = p_lote) then return 'ok'; end if;
  begin
    insert into public.tarifario_lote_espera (paquete_id, generacion, lote, texto) values (p_paquete_id, p_generacion, p_lote, p_filas_txt) on conflict do nothing;
  exception when foreign_key_violation then
    return 'obsoleta';   -- el manifiesto fue retirado por la limpieza mientras se guardaba
  end;
  return 'ok';
end $$;
revoke all on function public.tarifario_lote_espera_guardar(bigint, bigint, integer, text) from public, anon;
grant execute on function public.tarifario_lote_espera_guardar(bigint, bigint, integer, text) to authenticated;

-- 6.2 Encola la publicación cuando TODOS sus lotes están cargados o en espera. Desde aquí puede continuar sola (trabajador) aunque se cierre la pantalla.
create or replace function public.tarifario_publicacion_encolar(p_paquete_id bigint, p_generacion bigint)
returns text language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '30s' set lock_timeout = '8s' as $$
declare v_gen bigint; v_faltan integer;
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'tarifario_publicacion_encolar: rol sin permiso de escritura sobre tarifario_resultado';
  end if;
  select tarifario_generacion into v_gen from public.armado_paquetes where id = p_paquete_id for key share;
  if not found then raise exception 'tarifario_publicacion_encolar: paquete % no encontrado', p_paquete_id; end if;
  if v_gen <> p_generacion then return 'obsoleta'; end if;
  if not exists (select 1 from public.tarifario_manifiesto where paquete_id = p_paquete_id and generacion = p_generacion) then return 'sin_manifiesto'; end if;
  select count(*) into v_faltan from public.tarifario_manifiesto_lote l
   where l.paquete_id = p_paquete_id and l.generacion = p_generacion
     and not exists (select 1 from public.tarifario_lote_control c where c.paquete_id = l.paquete_id and c.generacion = l.generacion and c.lote = l.lote)
     and not exists (select 1 from public.tarifario_lote_espera e where e.paquete_id = l.paquete_id and e.generacion = l.generacion and e.lote = l.lote);
  if v_faltan > 0 then return 'faltan'; end if;
  insert into public.tarifario_publicacion_cola as q (paquete_id, generacion, estado, intentos, proximo_intento, ultimo_error)
    values (p_paquete_id, p_generacion, 'pendiente', 0, now(), null)
    on conflict (paquete_id) do update
      set generacion = excluded.generacion, estado = 'pendiente', intentos = 0, proximo_intento = now(), ultimo_error = null, actualizado_en = now()
      -- encolar de nuevo la MISMA publicación (otra petición que reanuda) no reinicia sus reintentos ni la saca de 'limpiando'
      where q.generacion <> excluded.generacion;
  return 'ok';
end $$;
revoke all on function public.tarifario_publicacion_encolar(bigint, bigint) from public, anon;
grant execute on function public.tarifario_publicacion_encolar(bigint, bigint) to authenticated;

-- 6.3 UN paso de una publicación encolada: cargar el siguiente lote desde la espera, activar o limpiar. Un solo trabajador por publicación (SKIP LOCKED). Un fallo (incluido el
-- timeout o la espera de un candado) se atrapa por paso: cuenta como intento, reprograma con espera creciente y, agotados los intentos, deja la publicación 'fallida' e INVISIBLE.
-- Devuelve: lote:N · activada · limpieza:N · listo · ocupada · sin_cola · fallida · obsoleta · fuente_cambio · modo_cambio · error:<mensaje> · detenida:<motivo>.
create or replace function public.tarifario_publicacion_avanzar_i(p_paquete_id bigint, p_generacion bigint)
returns text language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '30s' set lock_timeout = '8s' as $$
declare
  c public.tarifario_publicacion_cola; v_lote integer; v_txt text; v_r text; v_n integer; v_max constant integer := 6; v_msg text; v_vigente boolean; v_estado_sql text; v_fatal boolean;
begin
  select * into c from public.tarifario_publicacion_cola where paquete_id = p_paquete_id for update skip locked;
  if not found then
    return case when exists (select 1 from public.tarifario_publicacion_cola where paquete_id = p_paquete_id) then 'ocupada' else 'sin_cola' end;
  end if;
  if c.generacion <> p_generacion then return 'otra_generacion'; end if;
  if c.estado = 'fallida' then return 'fallida'; end if;
  select (tarifario_generacion = c.generacion) into v_vigente from public.armado_paquetes where id = p_paquete_id;
  if c.estado = 'pendiente' and v_vigente is not true then delete from public.tarifario_publicacion_cola where paquete_id = p_paquete_id; return 'obsoleta'; end if;

  begin
    if c.estado = 'limpiando' then
      v_n := public.tarifario_lote_limpiar_i(p_paquete_id, 250);
      if v_n <= 0 then delete from public.tarifario_publicacion_cola where paquete_id = p_paquete_id; return 'listo'; end if;
      update public.tarifario_publicacion_cola set proximo_intento = now(), actualizado_en = now() where paquete_id = p_paquete_id;
      return 'limpieza:' || v_n;
    end if;

    select l.lote into v_lote from public.tarifario_manifiesto_lote l
     where l.paquete_id = p_paquete_id and l.generacion = c.generacion
       and not exists (select 1 from public.tarifario_lote_control k where k.paquete_id = l.paquete_id and k.generacion = l.generacion and k.lote = l.lote)
     order by l.lote limit 1;
    if v_lote is null then
      v_r := public.tarifario_lote_activar_i(p_paquete_id, c.generacion);
      if v_r = 'ok' then
        delete from public.tarifario_lote_espera where paquete_id = p_paquete_id and generacion = c.generacion;
        update public.tarifario_publicacion_cola set estado = 'limpiando', intentos = 0, proximo_intento = now(), ultimo_error = null, actualizado_en = now() where paquete_id = p_paquete_id;
        return 'activada';
      elsif v_r in ('obsoleta', 'fuente_cambio', 'modo_cambio') then
        delete from public.tarifario_publicacion_cola where paquete_id = p_paquete_id;   -- el cálculo quedó superado: hay que generar de nuevo
        return v_r;
      else
        v_msg := 'La activación se rechazó: ' || v_r;
        update public.tarifario_publicacion_cola set estado = 'fallida', ultimo_error = v_msg, actualizado_en = now() where paquete_id = p_paquete_id;
        update public.armado_paquetes set tarifario_estado = 'fallido', tarifario_error = 'La publicación en segundo plano no se pudo completar. Vuelve a pulsar «Generar tarifario».' where id = p_paquete_id and tarifario_generacion = c.generacion;
        return 'detenida:' || v_r;
      end if;
    end if;

    select e.texto into v_txt from public.tarifario_lote_espera e where e.paquete_id = p_paquete_id and e.generacion = c.generacion and e.lote = v_lote;
    if not found then
      v_msg := 'Falta en espera el lote ' || v_lote;
      update public.tarifario_publicacion_cola set estado = 'fallida', ultimo_error = v_msg, actualizado_en = now() where paquete_id = p_paquete_id;
      update public.armado_paquetes set tarifario_estado = 'fallido', tarifario_error = 'La publicación en segundo plano no se pudo completar. Vuelve a pulsar «Generar tarifario».' where id = p_paquete_id and tarifario_generacion = c.generacion;
      return 'detenida:sin_espera';
    end if;
    v_r := public.tarifario_lote_agregar_i(p_paquete_id, c.generacion, v_lote, v_txt);
    if v_r = 'ok' then
      delete from public.tarifario_lote_espera where paquete_id = p_paquete_id and generacion = c.generacion and lote = v_lote;
      update public.tarifario_publicacion_cola set intentos = 0, proximo_intento = now(), ultimo_error = null, actualizado_en = now() where paquete_id = p_paquete_id;
      return 'lote:' || v_lote;
    elsif v_r in ('obsoleta', 'fuente_cambio') then
      delete from public.tarifario_publicacion_cola where paquete_id = p_paquete_id;
      return v_r;
    else
      v_msg := 'El lote ' || v_lote || ' se rechazó: ' || v_r;
      update public.tarifario_publicacion_cola set estado = 'fallida', ultimo_error = v_msg, actualizado_en = now() where paquete_id = p_paquete_id;
      update public.armado_paquetes set tarifario_estado = 'fallido', tarifario_error = 'La publicación en segundo plano no se pudo completar. Vuelve a pulsar «Generar tarifario».' where id = p_paquete_id and tarifario_generacion = c.generacion;
      return 'detenida:' || v_r;
    end if;
  exception
    when query_canceled or others then
      get stacked diagnostics v_msg = message_text, v_estado_sql = returned_sqlstate;
      -- Un error DETERMINISTA (integridad 23, dato malformado 22, sintaxis/permiso 42 o una validación propia P0001) no se arregla reintentando: la publicación se detiene YA, invisible, y el
      -- error llega a quien la espera. Lo transitorio (espera de candado 55P03, timeout 57014, deadlock 40P01, conexión, recursos) se reintenta con espera creciente hasta v_max.
      v_fatal := left(v_estado_sql, 2) in ('22', '23', '42') or v_estado_sql = 'P0001';
      update public.tarifario_publicacion_cola
         set intentos = intentos + 1, ultimo_error = left(v_estado_sql || ': ' || v_msg, 500), actualizado_en = now(),
             proximo_intento = now() + make_interval(secs => least(600, 10 * power(2, intentos))),
             estado = case when v_fatal or intentos + 1 >= v_max then 'fallida' else estado end
       where paquete_id = p_paquete_id;
      if v_fatal or c.intentos + 1 >= v_max then
        update public.armado_paquetes set tarifario_estado = 'fallido', tarifario_error = 'La publicación en segundo plano no se pudo completar. Vuelve a pulsar «Generar tarifario».' where id = p_paquete_id and tarifario_generacion = c.generacion;
      end if;
      if v_fatal then return 'detenida:' || v_estado_sql; end if;
      return 'error:' || left(v_msg, 200);
  end;
end $$;
revoke all on function public.tarifario_publicacion_avanzar_i(bigint, bigint) from public, anon, authenticated;

create or replace function public.tarifario_publicacion_avanzar(p_paquete_id bigint, p_generacion bigint)
returns text language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '30s' set lock_timeout = '8s' as $$
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then raise exception 'tarifario_publicacion_avanzar: rol sin permiso'; end if;
  return public.tarifario_publicacion_avanzar_i(p_paquete_id, p_generacion);
end $$;
revoke all on function public.tarifario_publicacion_avanzar(bigint, bigint) from public, anon;
grant execute on function public.tarifario_publicacion_avanzar(bigint, bigint) to authenticated;

-- 6.4 TRABAJADOR. Lo llama pg_cron (si la extensión existe) o la ruta /api/cron/publicacion-tarifario, sin sesión de usuario. Mantiene la cola (huérfanas, fallidas viejas, esperas sin
-- publicación) y avanza pasos hasta agotar un presupuesto corto (cada paso medido ≤ 5,5 s; el statement_timeout de 30 s no se alcanza).
create or replace function public.tarifario_cola_correr(p_presupuesto_ms integer default 12000)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '30s' set lock_timeout = '8s' as $$
declare t0 timestamptz := clock_timestamp(); c record; r text; v_pasos integer := 0; v_ult text; f record; v_resto integer;
begin
  -- Mantenimiento acotado: (a) publicaciones encoladas cuya generación fue superada; (b) fallidas con más de 3 días (y su generación a medias); (c) esperas sin publicación
  -- encolada con más de 1 día (una petición que murió a mitad de preparar los lotes).
  delete from public.tarifario_publicacion_cola q
   where q.estado = 'pendiente' and not exists (select 1 from public.armado_paquetes ap where ap.id = q.paquete_id and ap.tarifario_generacion = q.generacion);
  for f in delete from public.tarifario_publicacion_cola where estado = 'fallida' and actualizado_en < now() - interval '3 days' returning paquete_id loop
    perform public.tarifario_lote_limpiar_i(f.paquete_id, 250);
  end loop;
  delete from public.tarifario_lote_espera e
   where e.creado_en < now() - interval '1 day'
     and not exists (select 1 from public.tarifario_publicacion_cola q where q.paquete_id = e.paquete_id and q.generacion = e.generacion);

  -- Filas laterales huérfanas (el publicador monolítico borra filas de tarifario_resultado sin saber de estas tablas). Una pasada cada ~5 min: sondea por llave primaria, es barata.
  if (extract(epoch from clock_timestamp())::bigint / 10) % 30 = 0 then
    delete from public.tarifario_fila_oculta o where not exists (select 1 from public.tarifario_resultado r where r.id = o.fila_id);
    delete from public.tarifario_resultado_neto n where not exists (select 1 from public.tarifario_resultado r where r.id = n.fila_id);
  end if;

  loop
    exit when clock_timestamp() - t0 > make_interval(secs => greatest(p_presupuesto_ms, 0) / 1000.0);
    select q.paquete_id, q.generacion into c from public.tarifario_publicacion_cola q
     where q.estado <> 'fallida' and q.proximo_intento <= now() order by q.proximo_intento, q.creado_en limit 1;
    exit when not found;
    r := public.tarifario_publicacion_avanzar_i(c.paquete_id, c.generacion);
    if r not in ('ocupada', 'sin_cola', 'otra_generacion', 'fallida') then v_pasos := v_pasos + 1; end if;   -- solo cuentan los pasos que de verdad avanzaron
    v_ult := r;
    exit when r in ('ocupada', 'sin_cola', 'otra_generacion', 'fallida');   -- otro trabajador la tiene o ya no hay qué hacer: no girar en vacío
  end loop;
  select count(*) into v_resto from public.tarifario_publicacion_cola where estado <> 'fallida';
  return jsonb_build_object('pasos', v_pasos, 'ultimo', v_ult, 'en_cola', v_resto);
end $$;
revoke all on function public.tarifario_cola_correr(integer) from public, anon, authenticated;
grant execute on function public.tarifario_cola_correr(integer) to service_role;

-- 6.5 pg_cron (opcional): si la extensión existe, el trabajador corre cada 10 s sin depender de Vercel. Si no existe, la ruta /api/cron/publicacion-tarifario lo reemplaza (ver la doc).
-- La purga diaria evita que cron.job_run_details crezca sin límite con una ejecución cada 10 s.
do $$
begin
  if to_regclass('cron.job') is not null and exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule(jobid) from cron.job where jobname in ('tarifario_cola_correr', 'tarifario_cola_purga');
      perform cron.schedule('tarifario_cola_correr', '10 seconds', 'select public.tarifario_cola_correr()');
      perform cron.schedule('tarifario_cola_purga', '17 3 * * *',
        $c$delete from cron.job_run_details where end_time < now() - interval '1 day' and jobid in (select jobid from cron.job where jobname = 'tarifario_cola_correr')$c$);
    exception when others then
      raise notice '260: no se pudo programar pg_cron (%). La publicación seguirá avanzando por la ruta /api/cron/publicacion-tarifario.', sqlerrm;
    end;
  else
    raise notice '260: pg_cron no está habilitado. La continuación automática usará la ruta /api/cron/publicacion-tarifario.';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
