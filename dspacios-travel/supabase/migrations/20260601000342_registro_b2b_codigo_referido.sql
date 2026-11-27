-- 342 · #76 — CÓDIGO DE REFERIDO EN EL REGISTRO B2B PÚBLICO (candidato) + confirmación por superadmin/gerencia.
-- Decisiones del dueño (2026-11-24): (1) la agencia/freelance que se registra PUEDE escribir un código de referido en el formulario público; (2) superadmin o gerencia CONFIRMAN la asignación y el
-- porcentaje al aprobar el registro; (3) administración puede VER la información pero NO asigna ni cambia referidor ni porcentaje, tampoco a través de la aprobación.
-- Qué hace (aditiva; no toca datos existentes; sin backfill):
--   · `b2b_solicitudes` gana el CANDIDATO: `codigo_referido` (texto normalizado, formato validado en la base) y `referido_estado` (sin_codigo | candidato | confirmado | reemplazado | descartado).
--     El código escrito NUNCA es una asignación: solo es un texto. Ni el referidor ni el porcentaje viajan desde el navegador; se resuelven aquí contra `referidor_codigos` (341) en el momento de decidir.
--   · `registro_b2b_completar` (324, auditada) se REEMPLAZA con una copia idéntica salvo la lectura del código desde los datos guardados por el servidor en el paso 1 (`registro_b2b_estado.datos`).
--     Se conservan, sin cambios, la validación de correo confirmado en Auth, la marca del flujo, la cuenta inactiva, la idempotencia («ya_existia»), la sugerencia de ficha por documento y los permisos.
--     Un código con formato inválido se descarta en silencio (la solicitud se crea igual, sin candidato): el código nunca puede impedir ni deshacer un registro.
--   · `referido_decidir_solicitud(actor, solicitud, decisión, referidor, pct)`: SOLO superadmin/gerencia (re-verificado aquí). Serializada por la fila de la solicitud (`for update`) y por el candado del
--     aliado (341): repetir o competir no duplica. Exige que el registro esté APROBADO y enlazado a una ficha de aliado (la asignación es sobre el aliado, y rige solo hacia adelante).
--       confirmar_codigo → aplica la regla GUARDADA del código (referidor + % de la base). `p_referidor_id`/`p_pct` solo son lo que la persona VIO en pantalla: si la regla cambió entretanto, se rechaza (F4712)
--                          y no se asigna nada; nunca se toman como fuente.
--       asignar_otro     → alternativa explícita (referidor activo + 1 % o 2 %, como la asignación manual de 341); queda como `manual`.
--       descartar        → no asigna nada y cierra el candidato.
--     Una asignación vigente anterior del aliado solo se reemplaza por una decisión explícita (quedan el historial y los contratos ya atribuidos intactos: 341 no hace retroactivos).
--   · `referidos_candidatos(actor)`: lectura para superadmin/gerencia/administración (cada uno con su alcance de agencia) de los registros con código: candidato resuelto HOY contra la regla guardada
--     (referidor, %) o «no válido», la asignación vigente del aliado y el estado. Sin datos de contacto.
-- Seguridad: nada nuevo para anon/authenticated; solo service_role ejecuta (como 324/341). Rollback: supabase/scripts/rollback_342_registro_b2b_codigo_referido.sql (se niega si hay candidatos).
-- Requiere 324 (registro_b2b_completar), 193/237 (aprobar_solicitud_b2b) y 341 (referidos). Orden de publicación: 340 → 341 → 342.
begin;

do $$
begin
  if to_regprocedure('public.registro_b2b_completar(uuid,jsonb)') is null then raise exception '342 ABORTADA: falta registro_b2b_completar (324).'; end if;
  if to_regclass('public.referidor_codigos') is null or to_regprocedure('public.referido_asignar(uuid,bigint,bigint,numeric,text)') is null then raise exception '342 ABORTADA: falta la 341 (referidos).'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'b2b_solicitudes' and column_name = 'codigo_referido') then raise exception '342: ya aplicada (existe b2b_solicitudes.codigo_referido).'; end if;
end $$;

alter table public.b2b_solicitudes
  add column codigo_referido text check (codigo_referido is null or codigo_referido ~ '^[A-Z0-9][A-Z0-9-]{3,19}$'),
  add column referido_estado text not null default 'sin_codigo' check (referido_estado in ('sin_codigo', 'candidato', 'confirmado', 'reemplazado', 'descartado')),
  add column referido_decidido_por uuid references public.usuarios(id) on delete set null,
  add column referido_decidido_en timestamptz,
  add constraint b2b_solicitudes_referido_coherente check ((referido_estado = 'sin_codigo') = (codigo_referido is null));
comment on column public.b2b_solicitudes.codigo_referido is '#76: CANDIDATO escrito por el aliado en el registro. No es una asignación: se confirma con referido_decidir_solicitud (superadmin/gerencia).';
comment on column public.b2b_solicitudes.referido_estado is '#76: sin_codigo | candidato | confirmado (regla del código aplicada) | reemplazado (otra asignación explícita) | descartado.';

-- ── registro_b2b_completar: copia de la 324 + lectura del candidato ───────────────────────────────────────────────────────────────
create or replace function public.registro_b2b_completar(p_usuario uuid, p_datos jsonb default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.registro_b2b_estado%rowtype; u record; d jsonb; doc text; cand integer; sug bigint; marcada boolean; correo text; cod text;
begin
  if not exists (select 1 from auth.users where id = p_usuario) then return 'sin_cuenta'; end if;
  begin
    insert into public.registro_b2b_estado (usuario_id) values (p_usuario) on conflict (usuario_id) do nothing;
  exception when foreign_key_violation then return 'sin_cuenta';
  end;
  select * into r from public.registro_b2b_estado where usuario_id = p_usuario for update;
  if not found then return 'sin_cuenta'; end if;
  if not public.p324_correo_confirmado(p_usuario) then return 'sin_verificar'; end if;
  select coalesce((raw_app_meta_data ->> 'registro_b2b_codigo') = 'true', false), lower(btrim(email)) into marcada, correo from auth.users where id = p_usuario;
  select id, rol, nombre, activo into u from public.usuarios where id = p_usuario;
  if not found or not marcada or u.activo is distinct from false or u.rol not in ('agencia', 'freelance') then return 'no_aplica'; end if;
  if exists (select 1 from public.b2b_solicitudes where usuario_id = p_usuario) then
    update public.registro_b2b_estado set estado = 'completado', datos = null, actualizado_en = now() where usuario_id = p_usuario;
    return 'ya_existia';
  end if;
  d := coalesce(r.datos, p_datos, '{}'::jsonb);
  doc := nullif(btrim(coalesce(d ->> 'nit', '')), '');
  -- SUGERENCIA (no enlace) de la ficha del catálogo por documento, solo si es inequívoca (migración 143).
  if doc is not null then
    select count(*), min(id) into cand, sug from public.aliados where nit = doc;
    if cand <> 1 then sug := null; end if;
  end if;
  -- #76 (342): CANDIDATO de referido. Solo texto, normalizado y con formato válido; cualquier otra cosa se ignora (no impide el registro). No se consulta ninguna regla aquí.
  cod := upper(btrim(coalesce(d ->> 'codigo_referido', '')));
  if cod !~ '^[A-Z0-9][A-Z0-9-]{3,19}$' then cod := null; end if;
  insert into public.b2b_solicitudes (tipo, nombre, nit, tipo_documento, aliado_sugerido_id, contacto, email, telefono, ciudad, notas, acepta_notificaciones, estado, usuario_id, codigo_referido, referido_estado)
  values (
    u.rol, btrim(coalesce(u.nombre, d ->> 'nombre', '')), doc,
    coalesce(nullif(btrim(coalesce(d ->> 'tipo_documento', '')), ''), case when u.rol = 'agencia' then 'NIT' else 'CC' end),
    sug, nullif(btrim(coalesce(d ->> 'contacto', '')), ''), correo,
    nullif(btrim(coalesce(d ->> 'telefono', '')), ''), nullif(btrim(coalesce(d ->> 'ciudad', '')), ''), nullif(btrim(coalesce(d ->> 'notas', '')), ''),
    coalesce((d ->> 'acepta_notificaciones') = 'true', false), 'pendiente', p_usuario, cod, case when cod is null then 'sin_codigo' else 'candidato' end
  );
  update public.registro_b2b_estado set estado = 'completado', datos = null, actualizado_en = now() where usuario_id = p_usuario;
  return 'creada';
end $$;

-- ── Decisión sobre el candidato (solo superadmin/gerencia) ─────────────────────────────────────────────────────────────────────────
create function public.referido_decidir_solicitud(p_actor uuid, p_solicitud_id bigint, p_decision text, p_referidor_id bigint default null, p_pct numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u public.usuarios; s public.b2b_solicitudes; cuenta public.usuarios; c public.referidor_codigos; r public.referidores; v_res jsonb; v_nuevo text;
begin
  u := f341_priv.actor(p_actor, array['superadmin', 'gerencia']);
  if p_decision is null or p_decision not in ('confirmar_codigo', 'asignar_otro', 'descartar') then raise exception 'REF_DECISION: decisión no válida.' using errcode = 'F4713'; end if;
  select * into s from public.b2b_solicitudes where id = p_solicitud_id for update;
  if not found or s.codigo_referido is null then raise exception 'REF_SOLICITUD: el registro no existe o no trae un código de referido.' using errcode = 'F4713'; end if;
  select * into cuenta from public.usuarios where id = s.usuario_id;
  if not found or not f341_priv.ve_tenant(u, cuenta.tenant) then raise exception 'REF_ACTOR: no tienes permiso para esta operación.' using errcode = 'F4701'; end if;
  -- Idempotente: una decisión ya tomada se devuelve tal cual (repetir o competir no cambia nada).
  if s.referido_estado <> 'candidato' then return jsonb_build_object('estado', 'ya_decidida', 'referido_estado', s.referido_estado); end if;
  if s.estado = 'rechazada' then raise exception 'REF_SOLICITUD: el registro fue rechazado.' using errcode = 'F4711'; end if;

  if p_decision = 'descartar' then
    update public.b2b_solicitudes set referido_estado = 'descartado', referido_decidido_por = u.id, referido_decidido_en = now() where id = s.id;
    return jsonb_build_object('estado', 'descartada', 'referido_estado', 'descartado');
  end if;

  -- Asignar exige registro APROBADO y enlazado a una ficha de aliado (la asignación es sobre el aliado y rige hacia adelante).
  if s.estado <> 'aprobada' or cuenta.aliado_id is null then raise exception 'REF_SOLICITUD: aprueba el registro y enlázalo a una ficha de aliado antes de asignar el referido.' using errcode = 'F4711'; end if;

  if p_decision = 'confirmar_codigo' then
    select * into c from public.referidor_codigos where codigo = s.codigo_referido and activo;
    if found then select * into r from public.referidores where id = c.referidor_id and activo; end if;
    if c.codigo is null or r.id is null or not f341_priv.ve_tenant(u, r.tenant) then raise exception 'REF_CODIGO_INVALIDO: el código de referido no es válido.' using errcode = 'F4707'; end if;
    -- Lo que la persona VIO debe seguir siendo la regla guardada; si cambió, no se asigna nada.
    if p_referidor_id is distinct from c.referidor_id or round(p_pct, 4) is distinct from c.pct then raise exception 'REF_CAMBIO: la regla del código cambió; vuelve a cargar y revisa.' using errcode = 'F4712'; end if;
    v_res := f341_priv.asignar(u, cuenta.aliado_id, c.referidor_id, c.pct, 'codigo', c.codigo, 'Registro B2B #' || s.id, true);
    v_nuevo := 'confirmado';
  else
    if p_referidor_id is null then raise exception 'REF_REFERIDOR: el referidor no existe o está inactivo.' using errcode = 'F4705'; end if;
    v_res := f341_priv.asignar(u, cuenta.aliado_id, p_referidor_id, p_pct, 'manual', null, 'Registro B2B #' || s.id || ' (alternativa al código ' || s.codigo_referido || ')', true);
    v_nuevo := 'reemplazado';
  end if;
  update public.b2b_solicitudes set referido_estado = v_nuevo, referido_decidido_por = u.id, referido_decidido_en = now() where id = s.id;
  return v_res || jsonb_build_object('referido_estado', v_nuevo);
end $$;

-- ── Lectura de candidatos (superadmin/gerencia/administración, cada uno con su alcance) ───────────────────────────────────────────
create function public.referidos_candidatos(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u public.usuarios;
begin
  u := f341_priv.actor(p_actor, array['superadmin', 'gerencia', 'administracion']);
  return coalesce((
    select jsonb_agg(x.j order by x.pendiente desc, x.id desc) from (
      select s.id, (s.referido_estado = 'candidato') as pendiente,
             jsonb_build_object(
               'solicitud_id', s.id, 'nombre', s.nombre, 'tipo', s.tipo, 'estado_solicitud', s.estado, 'tenant', cu.tenant, 'aliado_id', cu.aliado_id, 'aliado_nombre', al.nombre,
               'codigo', s.codigo_referido, 'referido_estado', s.referido_estado, 'decidido_en', s.referido_decidido_en,
               -- Resolución de HOY contra la regla guardada (null = el código no existe, está inactivo o es de otra agencia).
               'referidor_id', rr.id, 'referidor_nombre', rr.nombre, 'pct', rc.pct,
               'vigente_referidor', av.referidor_nombre, 'vigente_pct', av.pct) as j
        from public.b2b_solicitudes s
        join public.usuarios cu on cu.id = s.usuario_id
        left join public.aliados al on al.id = cu.aliado_id
        left join public.referidor_codigos rc on rc.codigo = s.codigo_referido and rc.activo
        left join public.referidores rr on rr.id = rc.referidor_id and rr.activo and f341_priv.ve_tenant(u, rr.tenant)
        left join lateral (select r2.nombre as referidor_nombre, a2.pct from public.aliado_referidores a2 join public.referidores r2 on r2.id = a2.referidor_id
                            where a2.aliado_id = cu.aliado_id and a2.vigente_hasta is null and f341_priv.ve_tenant(u, a2.tenant) order by a2.id desc limit 1) av on true
       where s.codigo_referido is not null and f341_priv.ve_tenant(u, cu.tenant)
         and (s.referido_estado = 'candidato' or s.referido_decidido_en >= now() - interval '60 days')
       order by (s.referido_estado = 'candidato') desc, s.id desc
       limit 200
    ) x), '[]'::jsonb);
end $$;

revoke all on function public.registro_b2b_completar(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.registro_b2b_completar(uuid, jsonb) to service_role;
revoke all on function public.referido_decidir_solicitud(uuid, bigint, text, bigint, numeric) from public, anon, authenticated;
grant execute on function public.referido_decidir_solicitud(uuid, bigint, text, bigint, numeric) to service_role;
revoke all on function public.referidos_candidatos(uuid) from public, anon, authenticated;
grant execute on function public.referidos_candidatos(uuid) to service_role;

commit;
