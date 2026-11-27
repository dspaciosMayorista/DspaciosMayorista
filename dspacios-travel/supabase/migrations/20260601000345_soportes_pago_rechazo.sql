-- ─────────────────────────────────────────────────────────────────────
-- 345 · SOPORTES DE PAGO: RECHAZO INTERNO + CORRECCIÓN DEL ALIADO (S339-02, pedido del dueño)
--
-- QUÉ AGREGA
--   · Un soporte VIGENTE puede ser RECHAZADO por el personal autorizado (superadmin; gerencia/administración/operaciones de la agencia del contrato) con un MOTIVO OBLIGATORIO.
--     Rechazar = retirar con `motivo_retiro = 'rechazo'` y el motivo en `nota_retiro` (1–500 caracteres). Quién y cuándo = `retirado_por` / `retirado_en`.
--     El archivo y la fila se CONSERVAN (nada se borra): el soporte sale de la vista activa y queda en el historial con su motivo.
--   · El aliado CORRIGE un soporte rechazado subiendo el archivo correcto: `soporte_corregir`. La corrección es una fila NUEVA con `corrige_id` = el rechazado (una sola corrección por rechazo).
--   · Aviso al aliado por correo (el envío lo hace la aplicación; esta migración solo guarda el ESTADO del aviso en `soporte_rechazo_aviso`: pendiente / enviando / enviado / fallido /
--     sin_destinatario, con intentos acotados a 5). Que el correo falle NO deshace el rechazo.
--
-- CUPO (decisión explícita, con prueba):
--   · El conteo sigue siendo «soportes VIGENTES ≤ abonos + 1» (339). Un rechazado ya NO es vigente, así que LIBERA su cupo al rechazarse.
--   · La corrección es un soporte NUEVO sujeto al MISMO tope (no hay atajo: la cadena rechazado → corregido ocupa UN solo cupo vigente). Si entre el rechazo y la corrección el aliado llenó
--     el cupo con otros soportes, la corrección se rechaza con SOPORTE_LIMITE como cualquier subida; no es un callejón sin salida: puede REEMPLAZAR uno de sus soportes vigentes (que no depende
--     del tope) o esperar al registro del pago. Eximir la corrección del tope permitiría saltárselo (rechazo → otro soporte ocupa el cupo → corrección extra).
--   · Rechazar y corregir NO crean, aprueban ni modifican ningún pago, saldo, asiento, cuenta por pagar ni comisión: estas funciones solo tocan `contrato_soportes_pago`,
--     `soporte_rechazo_aviso` y `avisos` (el aviso interno de «soporte reemplazado» por la corrección).
--
-- QUÉ NO CAMBIA: soporte_registrar / soporte_reemplazar / soporte_retirar, los avisos internos existentes, la RLS de lectura de soportes, el bucket privado, la serialización (venta
-- `for update` primero), la guarda de identidad del contrato (#75) y la inmutabilidad de la evidencia.
--
-- REEMPLAZA (create or replace, mismo propietario/permisos/trigger) f281_soportes_insert (339) y f281_soportes_update (281), solo sobre sus definiciones EXACTAS (md5): una versión distinta ABORTA.
-- Orden: preflight_345 → 345 → postcheck_345 → despliegue del código. Si el código se despliega antes, el botón «Rechazar» falla con «función no existe» sin corromper nada.
-- Rollback: supabase/scripts/rollback_345_soportes_pago_rechazo.sql (se niega si hay soportes rechazados; no borra evidencia).
-- ─────────────────────────────────────────────────────────────────────

do $$
declare v_ins text; v_upd text;
begin
  if to_regclass('public.contrato_soportes_pago') is null or to_regclass('public.avisos') is null or to_regclass('public.ventas') is null or to_regclass('public.usuarios') is null then
    raise exception '345: faltan contrato_soportes_pago, avisos, ventas o usuarios (migraciones 281/339).';
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_ins from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_insert()');
  select md5(replace(p.prosrc, chr(13), '')) into v_upd from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_update()');
  if v_ins is distinct from '9f00935a6536eabed5bdff9c496c45a8' and v_ins is distinct from 'fb2584f6f98101659e4e70c1dfe9542f' then
    raise exception '345: f281_soportes_insert no es la de la migración 339 (md5 9f00935a6536eabed5bdff9c496c45a8; actual %). No se reemplaza una versión distinta.', v_ins;
  end if;
  if v_upd is distinct from '02d2cb65affe2219efd794fe22d362c7' and v_upd is distinct from '89b9ca09d12272dd4040d2cb3c037961' then
    raise exception '345: f281_soportes_update no es la de la migración 281 (md5 02d2cb65affe2219efd794fe22d362c7; actual %). No se reemplaza una versión distinta.', v_upd;
  end if;
end $$;

-- ── Esquema ────────────────────────────────────────────────────────────────
alter table public.contrato_soportes_pago add column if not exists corrige_id bigint references public.contrato_soportes_pago (id);
create unique index if not exists uq_soportes_corrige on public.contrato_soportes_pago (corrige_id) where corrige_id is not null;   -- cada rechazo se corrige A LO SUMO una vez (cierra correcciones concurrentes)

alter table public.contrato_soportes_pago drop constraint if exists contrato_soportes_pago_motivo_retiro_check;
alter table public.contrato_soportes_pago add constraint contrato_soportes_pago_motivo_retiro_check check (motivo_retiro in ('reemplazo', 'retiro', 'rechazo'));
alter table public.contrato_soportes_pago drop constraint if exists soportes_rechazo_motivo;
alter table public.contrato_soportes_pago add constraint soportes_rechazo_motivo check (motivo_retiro is distinct from 'rechazo' or (nota_retiro is not null and length(btrim(nota_retiro)) between 1 and 500));
alter table public.contrato_soportes_pago drop constraint if exists soportes_corrige_o_reemplaza;
alter table public.contrato_soportes_pago add constraint soportes_corrige_o_reemplaza check (corrige_id is null or reemplaza_id is null);

-- Estado del aviso por correo al aliado (una fila por rechazo). Sin copia del contrato ni del tenant: se derivan del soporte (que sobrevive a renumeraciones).
create table if not exists public.soporte_rechazo_aviso (
  soporte_id        bigint primary key references public.contrato_soportes_pago (id),
  estado            text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'enviado', 'fallido', 'sin_destinatario')),
  intentos          integer not null default 0 check (intentos between 0 and 5),
  destinatarios     integer check (destinatarios is null or destinatarios >= 0),
  ultimo_intento_en timestamptz,
  enviado_en        timestamptz,
  error             text check (error is null or length(error) <= 200),
  creado_en         timestamptz not null default now()
);
alter table public.soporte_rechazo_aviso enable row level security;
revoke all on public.soporte_rechazo_aviso from public, anon, authenticated, service_role;
grant select on public.soporte_rechazo_aviso to authenticated, service_role;
drop policy if exists "soporte_rechazo_aviso: lectura interna" on public.soporte_rechazo_aviso;
create policy "soporte_rechazo_aviso: lectura interna" on public.soporte_rechazo_aviso for select to authenticated
  using (
    public.mi_rol() = 'superadmin'
    or (public.mi_rol() in ('gerencia', 'administracion', 'operaciones')
        and exists (select 1 from public.contrato_soportes_pago s where s.id = soporte_id and s.archivado_en is null and s.tenant = public.mi_tenant()))
  );

-- ── Triggers de integridad (reemplazo exacto de 339 / 281) ─────────────────
create or replace function public.f281_soportes_insert() returns trigger language plpgsql set search_path = '' as $$
declare
  v_tenant text; v_abonos bigint; v_vigentes bigint; o public.contrato_soportes_pago;
  c_adicionales constant int := 1;   -- cupo adicional por contrato (339): evidencia de un pago que el equipo aún no registra. NO está ligado a ningún pago.
begin
  select v.tenant into v_tenant from public.ventas v where v.numero_contrato = new.numero_contrato;
  if not found then
    raise exception 'SOPORTE_CONTRATO_INEXISTENTE: el contrato % no existe.', new.numero_contrato using errcode = 'F4510';
  end if;
  if new.tenant is distinct from v_tenant then
    raise exception 'SOPORTE_TENANT: el soporte declara la agencia % y el contrato % es de %.', new.tenant, new.numero_contrato, v_tenant using errcode = 'F4514';
  end if;
  if new.archivado_en is not null then
    raise exception 'SOPORTE_NACE_VIGENTE: un soporte nuevo no nace archivado.' using errcode = 'F4516';
  end if;
  if not new.vigente then
    raise exception 'SOPORTE_NACE_VIGENTE: un soporte nuevo nace vigente.' using errcode = 'F4516';
  end if;

  if new.corrige_id is not null then
    -- Corrección (345): corrige un soporte RECHAZADO del mismo contrato. NO es una sustitución: es un soporte nuevo que cuenta contra el tope (abajo).
    select * into o from public.contrato_soportes_pago s where s.id = new.corrige_id;
    if new.reemplaza_id is not null or o.id is null or o.numero_contrato <> new.numero_contrato or o.vigente or o.archivado_en is not null or o.motivo_retiro is distinct from 'rechazo' then
      raise exception 'SOPORTE_CORRECCION: la fila % no es un soporte rechazado del contrato %.', new.corrige_id, new.numero_contrato using errcode = 'F4525';
    end if;
    if o.sha256 = new.sha256 then
      raise exception 'SOPORTE_MISMO_ARCHIVO: es el mismo archivo que se rechazó; sube el archivo corregido.' using errcode = 'F4524';
    end if;
  end if;

  if new.reemplaza_id is null then
    select count(*) into v_abonos from public.abonos a where a.numero_contrato = new.numero_contrato;
    select count(*) into v_vigentes from public.contrato_soportes_pago s where s.numero_contrato = new.numero_contrato and s.vigente and s.archivado_en is null;
    if v_vigentes + 1 > v_abonos + c_adicionales then
      raise exception 'SOPORTE_LIMITE: el contrato % tiene % abono(s) y % soporte(s) vigente(s); el máximo es abonos + % = %. Reemplaza o retira uno, o registra el pago.', new.numero_contrato, v_abonos, v_vigentes, c_adicionales, v_abonos + c_adicionales using errcode = 'F4515';
    end if;
  else
    -- Sustitución: NO crece el conteo vigente. Se verifica por estructura, sin banderas.
    select * into o from public.contrato_soportes_pago s where s.id = new.reemplaza_id;
    if o.id is null or o.numero_contrato <> new.numero_contrato or o.vigente or o.archivado_en is not null
       or o.motivo_retiro is distinct from 'reemplazo' or o.retirado_en is distinct from now() then
      raise exception 'SOPORTE_SUSTITUCION: la fila % no está retirada por reemplazo en esta transacción para el contrato %.', new.reemplaza_id, new.numero_contrato using errcode = 'F4516';
    end if;
  end if;
  return new;
end $$;

create or replace function public.f281_soportes_update() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.tenant, new.path, new.nombre_original, new.mime, new.size_bytes, new.sha256, new.subido_por, new.subido_en, new.reemplaza_id, new.corrige_id)
     is distinct from
     (old.tenant, old.path, old.nombre_original, old.mime, old.size_bytes, old.sha256, old.subido_por, old.subido_en, old.reemplaza_id, old.corrige_id) then
    raise exception 'SOPORTE_INMUTABLE: la evidencia del soporte % no se modifica.', old.id using errcode = 'F4517';
  end if;
  if old.archivado_en is not null then
    raise exception 'SOPORTE_ARCHIVADO: el soporte % pertenece a un contrato que ya no existe; está conservado y congelado.', old.id using errcode = 'F4520';
  end if;
  if new.numero_contrato is distinct from old.numero_contrato then
    -- Renumeración del contrato: SOLO dentro de f281_trasladar_evidencia (que ninguna aplicación puede ejecutar), con la marca local de transacción que ella fija
    -- Y la coherencia estructural (misma agencia y mismo created_at entre la venta vieja y la nueva). Ninguna de las dos basta por sí sola.
    if coalesce(pg_catalog.current_setting('app.f281_traslado', true), '') <> old.numero_contrato || '>' || new.numero_contrato
       or new.archivado_en is not null
       or (new.vigente, new.retirado_en, new.retirado_por, new.motivo_retiro, new.nota_retiro) is distinct from (old.vigente, old.retirado_en, old.retirado_por, old.motivo_retiro, old.nota_retiro)
       or not exists (select 1 from public.ventas a join public.ventas b on b.tenant = a.tenant and b.created_at = a.created_at
                       where a.numero_contrato = old.numero_contrato and b.numero_contrato = new.numero_contrato and a.tenant = old.tenant) then
      raise exception 'SOPORTE_INMUTABLE: el número del contrato del soporte % solo cambia en la renumeración del contrato.', old.id using errcode = 'F4517';
    end if;
    return new;
  end if;
  if new.archivado_en is distinct from old.archivado_en then
    -- Archivar: lo ÚNICO que puede cambiar es archivado_en (null → fecha).
    if (new.vigente, new.retirado_en, new.retirado_por, new.motivo_retiro, new.nota_retiro) is distinct from (old.vigente, old.retirado_en, old.retirado_por, old.motivo_retiro, old.nota_retiro) then
      raise exception 'SOPORTE_INMUTABLE: archivar el soporte % no cambia nada más.', old.id using errcode = 'F4517';
    end if;
    return new;
  end if;
  if not old.vigente or new.vigente then
    raise exception 'SOPORTE_INMUTABLE: el soporte % solo pasa de vigente a retirado, una vez.', old.id using errcode = 'F4517';
  end if;
  return new;
end $$;

-- ── Destinatarios del aviso al ALIADO (por id, nunca por nombre) ───────────
-- La persona que subió el soporte y los dueños del contrato por la MISMA regla de ids del portal (ventas.b2b_usuario_id, ventas.aliado_id = usuarios.aliado_id): cuentas
-- ACTIVAS de aliado (agencia/freelance) de la agencia del contrato y con correo. El respaldo por nombre (contratos antiguos) NO se usa: adivinar a quién escribir no es aceptable.
create or replace function public.f345_destinatarios_rechazo(p_soporte bigint) returns table (usuario_id uuid, email text, nombre text)
language sql stable security definer set search_path = '' as $$
  select distinct u.id, btrim(u.email), u.nombre
    from public.contrato_soportes_pago s
    join public.ventas v on v.numero_contrato = s.numero_contrato
    join public.usuarios u on u.tenant = v.tenant
   where s.id = p_soporte and u.activo and u.rol::text in ('agencia', 'freelance')
     and nullif(btrim(coalesce(u.email, '')), '') is not null
     and (u.id = s.subido_por or u.id = v.b2b_usuario_id or (v.aliado_id is not null and u.aliado_id = v.aliado_id))
   order by 1 limit 10
$$;
revoke all on function public.f345_destinatarios_rechazo(bigint) from public, anon, authenticated;
grant execute on function public.f345_destinatarios_rechazo(bigint) to service_role;

-- ── Rechazar (personal autorizado) ─────────────────────────────────────────
create or replace function public.soporte_rechazar(p_id bigint, p_actor uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_num text; v_tenant text; o public.contrato_soportes_pago; v_rol text; v_tenant_actor text; v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  perform public.f281_exigir_actor(p_actor);
  select u.rol::text, u.tenant into v_rol, v_tenant_actor from public.usuarios u where u.id = p_actor and u.activo;
  if v_rol is null or v_rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'SOPORTE_ROL: tu rol no puede rechazar soportes de pago.' using errcode = 'F4523';
  end if;
  if v_motivo is null or length(v_motivo) > 500 then
    raise exception 'SOPORTE_MOTIVO: el motivo del rechazo es obligatorio (1 a 500 caracteres).' using errcode = 'F4522';
  end if;
  select b.o_numero, b.o_tenant into v_num, v_tenant from public.f281_bloquear_contrato_del_soporte(p_id) b;   -- venta primero (mismo orden que reemplazar/retirar)
  if v_rol <> 'superadmin' and v_tenant_actor is distinct from v_tenant then
    raise exception 'SOPORTE_ROL: el soporte es de otra agencia.' using errcode = 'F4523';
  end if;
  perform public.soporte_verificar_identidad(v_num);   -- #75
  select * into o from public.contrato_soportes_pago s where s.id = p_id for update;
  if o.archivado_en is not null then
    raise exception 'SOPORTE_ARCHIVADO: el soporte % pertenece a un contrato que ya no existe.', p_id using errcode = 'F4520';
  end if;
  if not o.vigente then
    raise exception 'SOPORTE_NO_VIGENTE: el soporte % ya no está vigente (otro reemplazo, retiro o rechazo se adelantó).', p_id using errcode = 'F4513';
  end if;
  update public.contrato_soportes_pago
     set vigente = false, retirado_en = now(), retirado_por = p_actor, motivo_retiro = 'rechazo', nota_retiro = v_motivo
   where id = p_id;
  insert into public.soporte_rechazo_aviso (soporte_id) values (p_id);
  return jsonb_build_object('id', p_id, 'numero_contrato', v_num);
end $$;
revoke all on function public.soporte_rechazar(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.soporte_rechazar(bigint, uuid, text) to service_role;

-- ── Corregir (aliado, por la acción del portal que ya verificó la propiedad) ─
create or replace function public.soporte_corregir(p_id bigint, p_actor uuid, p_path text, p_nombre text, p_mime text, p_size bigint, p_sha text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_num text; v_tenant text; o public.contrato_soportes_pago; v_id bigint;
begin
  perform public.f281_exigir_actor(p_actor);
  select b.o_numero, b.o_tenant into v_num, v_tenant from public.f281_bloquear_contrato_del_soporte(p_id) b;
  perform public.soporte_verificar_identidad(v_num);
  select * into o from public.contrato_soportes_pago s where s.id = p_id for update;
  if o.archivado_en is not null then
    raise exception 'SOPORTE_ARCHIVADO: el soporte % pertenece a un contrato que ya no existe.', p_id using errcode = 'F4520';
  end if;
  if o.vigente or o.motivo_retiro is distinct from 'rechazo' then
    raise exception 'SOPORTE_CORRECCION: el soporte % no está rechazado.', p_id using errcode = 'F4525';
  end if;
  if exists (select 1 from public.contrato_soportes_pago s where s.corrige_id = p_id) then
    raise exception 'SOPORTE_YA_CORREGIDO: ese rechazo ya tiene su corrección.' using errcode = 'F4526';
  end if;
  insert into public.contrato_soportes_pago (numero_contrato, tenant, path, nombre_original, mime, size_bytes, sha256, subido_por, corrige_id)
  values (v_num, v_tenant, p_path, p_nombre, p_mime, p_size, p_sha, p_actor, p_id) returning id into v_id;
  -- El equipo se entera por el mismo aviso interno de «soporte reemplazado» (no hay un tipo nuevo: la corrección sustituye al rechazado).
  insert into public.avisos (usuario_id, tipo, numero_contrato, soporte_id)
    select d.usuario_id, 'soporte_pago_reemplazado', v_num, v_id from public.f281_destinatarios(v_num, p_actor) d;
  return jsonb_build_object('id', v_id, 'numero_contrato', v_num, 'corrige_id', p_id);
end $$;
revoke all on function public.soporte_corregir(bigint, uuid, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.soporte_corregir(bigint, uuid, text, text, text, bigint, text) to service_role;

-- ── Estado del correo (reclamar un envío / cerrarlo) ───────────────────────
-- Reclamar es ATÓMICO: dos pestañas o un doble clic no envían dos veces. Reintentos acotados a 5; un envío «enviando» abandonado (>2 min) puede reclamarse de nuevo.
-- Devuelve null si no hay nada que reclamar (ya enviado, sin destinatarios o límite alcanzado). Los destinatarios se resuelven aquí, por ids.
create or replace function public.soporte_rechazo_aviso_reclamar(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.soporte_rechazo_aviso; s public.contrato_soportes_pago; v_dest jsonb;
begin
  update public.soporte_rechazo_aviso x
     set estado = 'enviando', intentos = x.intentos + 1, ultimo_intento_en = now(), error = null
   where x.soporte_id = p_id and x.intentos < 5
     and (x.estado in ('pendiente', 'fallido') or (x.estado = 'enviando' and x.ultimo_intento_en < now() - interval '2 minutes'))
  returning * into a;
  if a.soporte_id is null then return null; end if;
  select * into s from public.contrato_soportes_pago where id = p_id;
  select coalesce(jsonb_agg(jsonb_build_object('email', d.email, 'nombre', d.nombre)), '[]'::jsonb) into v_dest from public.f345_destinatarios_rechazo(p_id) d;
  return jsonb_build_object('id', p_id, 'numero_contrato', s.numero_contrato, 'nombre_original', s.nombre_original, 'motivo', s.nota_retiro, 'intento', a.intentos, 'destinatarios', v_dest);
end $$;
revoke all on function public.soporte_rechazo_aviso_reclamar(bigint) from public, anon, authenticated;
grant execute on function public.soporte_rechazo_aviso_reclamar(bigint) to service_role;

create or replace function public.soporte_rechazo_aviso_cerrar(p_id bigint, p_estado text, p_destinatarios integer, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_estado not in ('enviado', 'fallido', 'sin_destinatario') then
    raise exception 'SOPORTE_AVISO: estado de cierre no válido.' using errcode = 'F4527';
  end if;
  update public.soporte_rechazo_aviso
     set estado = p_estado, destinatarios = p_destinatarios, error = left(nullif(btrim(coalesce(p_error, '')), ''), 200),
         enviado_en = case when p_estado = 'enviado' then now() else enviado_en end
   where soporte_id = p_id and estado = 'enviando';
end $$;
revoke all on function public.soporte_rechazo_aviso_cerrar(bigint, text, integer, text) from public, anon, authenticated;
grant execute on function public.soporte_rechazo_aviso_cerrar(bigint, text, integer, text) to service_role;

comment on table public.soporte_rechazo_aviso is '345: estado del correo al aliado por un soporte rechazado. El rechazo no depende de que el correo salga.';
comment on column public.contrato_soportes_pago.corrige_id is '345: soporte rechazado que esta fila corrige (una sola corrección por rechazo).';
