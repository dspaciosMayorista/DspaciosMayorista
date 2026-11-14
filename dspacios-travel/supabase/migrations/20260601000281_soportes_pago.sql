-- ─────────────────────────────────────────────────────────────────────
-- 281 · SOPORTES DE PAGO DEL ALIADO B2B + AVISOS INTERNOS (#86)
--
-- QUÉ ES. El aliado adjunta comprobantes (PDF/JPG/PNG) a SUS contratos. Un soporte NO es un pago: no toca abonos, saldos, asientos ni conciliación.
--
-- REGLAS (todas aplicadas EN BASE, no solo en la interfaz):
--   1. Máximo de soportes VIGENTES por contrato = número de abonos registrados del contrato. Puede haber menos; un PDF puede reunir varios abonos.
--      No hay vínculo soporte-abono ni índice único por abono.
--   2. Reemplazar y retirar CONSERVAN el historial y el archivo anterior (nada se borra: ni fila, ni objeto en Storage).
--   3. Reemplazar funciona aunque el contrato quede «excedido» (más soportes vigentes que abonos, p. ej. tras anular un abono) porque no sube el conteo.
--      La sustitución NO usa bandera de bypass: la fila nueva declara `reemplaza_id` y el trigger verifica por ESTRUCTURA que la fila sustituida es del mismo
--      contrato, quedó retirada con motivo 'reemplazo' en ESTA transacción y nadie la sustituyó antes (índice único parcial). Un trigger diferido garantiza
--      al COMMIT que toda fila retirada por reemplazo tiene su sucesor.
--   4. «Excedido» no se guarda: se calcula (vigentes > abonos). Anular un abono (RPC `anular_abono`, 248) NO se modifica ni se bloquea.
--   5. Serialización: todas las funciones toman `FOR UPDATE` sobre `ventas` PRIMERO — el mismo primer bloqueo de `anular_abono` y `registrar_abono`
--      (venta → abono) — y después solo filas de soportes/avisos, que esas RPC nunca tocan. No hay ciclo posible con ellas.
--
-- 6. IDENTIDAD DEL CONTRATO vs CONSECUTIVO REUTILIZABLE. Un minorista eliminado con `eliminar_contrato(p_reusar => true)` libera su número
--    (`numeros_contrato_liberados`) y el siguiente contrato nace con EL MISMO `numero_contrato` —y, quizá, de OTRO aliado—. La evidencia se relaciona por
--    número, así que sin más heredaría soportes y avisos del contrato anterior. Corrección mínima, sin tocar el borrado financiero: un trigger AFTER DELETE
--    sobre `ventas` (`trg_f281_archivar_evidencia`) ARCHIVA (`archivado_en`) los soportes y avisos de ese número en el instante en que el contrato deja de existir.
--    Archivar NO borra nada: filas y archivos se conservan. Lo archivado deja de contar para el límite, de listarse, de abrirse por el aliado y por el
--    personal (salvo superadmin), de reemplazarse/retirarse y de avisarse. Un contrato nuevo con el mismo número empieza limpio.
--
-- 7. RENUMERAR UN CONTRATO NO PIERDE LA EVIDENCIA. fn_renumerar_contrato (115) copia la fila de ventas con el número nuevo, mueve las hijas por FK y borra la vieja. Esta
--    migración la REEMPLAZA (create or replace; mismo propietario, SECURITY DEFINER, search_path y permisos —se comprueba—) añadiendo exactamente DOS líneas: bloquea la
--    fila vieja de ventas ANTES de copiarla (venta primero, igual que anular_abono/registrar_abono y las funciones de soportes: sin interbloqueo) y llama a
--    f281_trasladar_evidencia(viejo, nuevo) ANTES del borrado, en la misma transacción. Esa función (sin ejecutores para ninguna aplicación) mueve soportes (vigentes e
--    historial) y avisos al número nuevo; la ruta física del objeto NO cambia y la autorización usa el número ACTUAL de la fila. Solo se aplica sobre la definición exacta
--    de la 115 (md5): una distinta ABORTA la migración. El rollback restaura la original solo si nada cambió después (cuerpo y permisos), si no se niega.
--
-- AUTORIZACIÓN. Las funciones son SECURITY DEFINER y solo `service_role` puede ejecutarlas: la autorización del aliado (propiedad del contrato por ids)
-- la decide el código con `accesoDocumentoContrato`/`contratosDelPortalB2B`, igual que los documentos por URL. La base garantiza la integridad
-- (contrato existe, tenant coincide, límite, sustitución, inmutabilidad). La LECTURA interna sí es RLS (policy abajo): superadmin; gerencia/administración/
-- operaciones de la MISMA agencia; venta solo en contratos propios de su agencia — el mismo alcance que la 150 da a los archivos del bucket `contratos`.
--
-- STORAGE. Bucket PRIVADO `soportes-pago` (tamaño y tipos limitados) SIN ninguna policy en storage.objects: ningún usuario lo lee ni escribe con su sesión;
-- todo pasa por el servidor (service-role) tras autorizar. El bucket `contratos` y sus policies NO se tocan.
--
-- AVISOS. Solo dentro del sistema. `notificado_en` (reclamado por una pestaña para mostrar notificación/sonido) y `leido_en` (visto por la persona) son
-- DISTINTOS: reclamar nunca marca leído. El aviso lleva tipo y número de contrato, nada más. Recibir un aviso no concede acceso a nada.
-- Destinatarios: superadmin; gerencia/administración/operaciones de la agencia del contrato; y el asesor SOLO si `ventas.asesor` identifica a UN único
-- usuario `venta` activo de esa agencia (nombre o correo, normalizado). Ambiguo o sin coincidencia = no se avisa por esa vía. Participantes solo por
-- comisión: NO se incluyen (pendiente de aclaración del dueño).
--
-- Errores: F4510 contrato inexistente · F4511 actor inválido · F4512 soporte inexistente · F4513 soporte ya no vigente · F4514 tenant distinto ·
--          F4515 límite de soportes · F4516 sustitución inválida · F4517 fila inmutable · F4518 borrado prohibido · F4519 reemplazo sin sucesor · F4520 soporte archivado (de un contrato que ya no existe).
-- Rollback: supabase/scripts/rollback_281_soportes.sql (se niega si ya hay soportes o archivos).
-- ─────────────────────────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.ventas') is null or to_regclass('public.abonos') is null or to_regclass('public.usuarios') is null
     or to_regprocedure('public.mi_rol()') is null or to_regprocedure('public.mi_tenant()') is null
     or to_regprocedure('public.puede_ver_contrato(text)') is null or to_regprocedure('public.soy_asesor_del_contrato(text)') is null then
    raise exception '281: faltan tablas/funciones base (ventas, abonos, usuarios, mi_rol, mi_tenant, puede_ver_contrato, soy_asesor_del_contrato).';
  end if;
  if to_regprocedure('public.fn_renumerar_contrato(text,text)') is null then
    raise exception '281: falta fn_renumerar_contrato(text,text) (migración 115).';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = 'public.fn_renumerar_contrato(text,text)'::regprocedure) is distinct from '9199d3146e04c44d949a1c4703e2e81e' then
    raise exception '281: la definición de fn_renumerar_contrato en esta base NO es la esperada (migración 115, md5 9199d3146e04c44d949a1c4703e2e81e). La 281 la reemplaza; no se aplica sobre una versión distinta. Revisa qué cambió y adapta la 281.';
  end if;
  if to_regclass('public.contrato_soportes_pago') is not null or to_regclass('public.avisos') is not null then
    raise exception '281: ya aplicada (existen contrato_soportes_pago o avisos). No se re-aplica.';
  end if;
end $$;

-- ── Bucket privado, sin policies ──────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('soportes-pago', 'soportes-pago', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- ── Soportes ──────────────────────────────────────────────────────────────
-- Sin FK a ventas/abonos A PROPÓSITO (igual que abonos_anulados): la evidencia sobrevive a la anulación de un abono y a la eliminación del contrato;
-- la existencia del contrato y la coincidencia de tenant las verifica el trigger de inserción.
create table public.contrato_soportes_pago (
  id              bigserial primary key,
  numero_contrato text not null,
  tenant          text not null,
  path            text not null unique,   -- ruta FÍSICA del objeto: no cambia nunca (ni al renumerar). La autorización usa numero_contrato, no la ruta.
  nombre_original text not null check (length(btrim(nombre_original)) between 1 and 200),
  mime            text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes      bigint not null check (size_bytes > 0),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  subido_por      uuid not null,
  subido_en       timestamptz not null default now(),
  vigente         boolean not null default true,
  reemplaza_id    bigint references public.contrato_soportes_pago (id),
  retirado_en     timestamptz,
  retirado_por    uuid,
  motivo_retiro   text check (motivo_retiro in ('reemplazo', 'retiro')),
  nota_retiro     text check (nota_retiro is null or length(nota_retiro) <= 500),
  archivado_en    timestamptz,   -- el contrato al que pertenecía dejó de existir (su número pudo reutilizarse): evidencia conservada, fuera de circulación
  constraint soportes_vigencia_coherente check (
    (vigente and retirado_en is null and retirado_por is null and motivo_retiro is null)
    or (not vigente and retirado_en is not null and retirado_por is not null and motivo_retiro is not null)
  )
);
-- Cada fila se sustituye A LO SUMO una vez (cierra reemplazos concurrentes de la misma fila).
create unique index uq_soportes_reemplaza on public.contrato_soportes_pago (reemplaza_id) where reemplaza_id is not null;
create index idx_soportes_contrato on public.contrato_soportes_pago (numero_contrato, vigente) where archivado_en is null;

alter table public.contrato_soportes_pago enable row level security;
revoke all on public.contrato_soportes_pago from public, anon, authenticated, service_role;
revoke all on sequence public.contrato_soportes_pago_id_seq from public, anon, authenticated, service_role;
grant select on public.contrato_soportes_pago to authenticated, service_role;

create policy "soportes_pago: lectura interna" on public.contrato_soportes_pago for select to authenticated
  using (
    public.mi_rol() = 'superadmin'      -- superadmin conserva el acceso a TODA la evidencia, incluida la archivada
    or (archivado_en is null and (
      (public.mi_rol() in ('gerencia', 'administracion', 'operaciones') and tenant = public.mi_tenant())
      or (public.mi_rol() = 'venta' and tenant = public.mi_tenant()
          and public.puede_ver_contrato(numero_contrato) and public.soy_asesor_del_contrato(numero_contrato))
    ))
  );

-- ── Triggers de integridad ────────────────────────────────────────────────
create function public.f281_soportes_insert() returns trigger language plpgsql set search_path = '' as $$
declare
  v_tenant text; v_abonos bigint; v_vigentes bigint; o public.contrato_soportes_pago;
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

  if new.reemplaza_id is null then
    select count(*) into v_abonos from public.abonos a where a.numero_contrato = new.numero_contrato;
    select count(*) into v_vigentes from public.contrato_soportes_pago s where s.numero_contrato = new.numero_contrato and s.vigente and s.archivado_en is null;
    if v_vigentes + 1 > v_abonos then
      raise exception 'SOPORTE_LIMITE: el contrato % tiene % abono(s) y % soporte(s) vigente(s); no caben más. Reemplaza o retira uno.', new.numero_contrato, v_abonos, v_vigentes using errcode = 'F4515';
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
create trigger trg_f281_soportes_insert before insert on public.contrato_soportes_pago
  for each row execute function public.f281_soportes_insert();

create function public.f281_soportes_update() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.tenant, new.path, new.nombre_original, new.mime, new.size_bytes, new.sha256, new.subido_por, new.subido_en, new.reemplaza_id)
     is distinct from
     (old.tenant, old.path, old.nombre_original, old.mime, old.size_bytes, old.sha256, old.subido_por, old.subido_en, old.reemplaza_id) then
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
create trigger trg_f281_soportes_update before update on public.contrato_soportes_pago
  for each row execute function public.f281_soportes_update();

create function public.f281_soportes_no_borrar() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'SOPORTE_NO_SE_BORRA: los soportes se retiran, no se borran (evidencia).' using errcode = 'F4518';
end $$;
create trigger trg_f281_soportes_delete before delete on public.contrato_soportes_pago
  for each row execute function public.f281_soportes_no_borrar();
create trigger trg_f281_soportes_truncate before truncate on public.contrato_soportes_pago
  for each statement execute function public.f281_soportes_no_borrar();

-- Al COMMIT: toda fila retirada por reemplazo tiene exactamente un sucesor.
create function public.f281_reemplazo_completo() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.contrato_soportes_pago s where s.reemplaza_id = new.id) then
    raise exception 'SOPORTE_REEMPLAZO_INCOMPLETO: el soporte % se retiró por reemplazo y no tiene sucesor.', new.id using errcode = 'F4519';
  end if;
  return null;
end $$;
create constraint trigger trg_f281_reemplazo_completo after update on public.contrato_soportes_pago
  deferrable initially deferred for each row when (new.motivo_retiro = 'reemplazo')
  execute function public.f281_reemplazo_completo();

-- ── Avisos ────────────────────────────────────────────────────────────────
create table public.avisos (
  id              bigserial primary key,
  usuario_id      uuid not null,
  tipo            text not null check (tipo in ('soporte_pago_nuevo', 'soporte_pago_reemplazado')),
  numero_contrato text not null,
  soporte_id      bigint,
  creado_en       timestamptz not null default now(),
  notificado_en   timestamptz,   -- una pestaña lo RECLAMÓ para notificación/sonido. NO implica leído.
  leido_en        timestamptz,   -- la persona lo vio
  archivado_en    timestamptz    -- su contrato dejó de existir (número reutilizable): ya no se reclama, cuenta ni lista
);
create index idx_avisos_usuario on public.avisos (usuario_id, id desc);
create index idx_avisos_sin_notificar on public.avisos (usuario_id) where notificado_en is null and leido_en is null and archivado_en is null;
alter table public.avisos enable row level security;
revoke all on public.avisos from public, anon, authenticated, service_role;
revoke all on sequence public.avisos_id_seq from public, anon, authenticated, service_role;
grant select on public.avisos to service_role;

-- Destinatarios INEQUÍVOCOS del aviso de un contrato. No concede acceso: es solo a quién avisar.
create function public.f281_destinatarios(p_numero text, p_actor uuid) returns table (usuario_id uuid)
language sql stable security definer set search_path = '' as $$
  with v as (select tenant, asesor from public.ventas where numero_contrato = p_numero),
  cargos as (
    select u.id from public.usuarios u, v
     where u.activo and u.id <> p_actor
       and (u.rol::text = 'superadmin' or (u.rol::text in ('gerencia', 'administracion', 'operaciones') and u.tenant = v.tenant))
  ),
  coincidencias as (
    select u.id from public.usuarios u, v
     where u.activo and u.rol::text = 'venta' and u.tenant = v.tenant and u.id <> p_actor
       and btrim(coalesce(v.asesor, '')) <> ''
       and pg_catalog.lower(btrim(v.asesor)) in (pg_catalog.lower(btrim(coalesce(u.nombre, ''))), pg_catalog.lower(btrim(coalesce(u.email, ''))))
  ),
  asesor as (select c.id from coincidencias c where (select count(*) from coincidencias) = 1)
  select id from cargos union select id from asesor
$$;

-- ── Funciones de escritura (solo service_role) ────────────────────────────
create function public.f281_bloquear_venta(p_numero text) returns text language plpgsql security definer set search_path = '' as $$
declare v_tenant text;
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  select v.tenant into v_tenant from public.ventas v where v.numero_contrato = p_numero for update;
  if not found then
    raise exception 'SOPORTE_CONTRATO_INEXISTENTE: el contrato % no existe.', p_numero using errcode = 'F4510';
  end if;
  return v_tenant;
end $$;

create function public.f281_exigir_actor(p_actor uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_actor is null or not exists (select 1 from public.usuarios u where u.id = p_actor and u.activo) then
    raise exception 'SOPORTE_ACTOR: usuario inexistente o inactivo.' using errcode = 'F4511';
  end if;
end $$;

create function public.soporte_registrar(p_numero text, p_actor uuid, p_path text, p_nombre text, p_mime text, p_size bigint, p_sha text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tenant text; v_id bigint;
begin
  perform public.f281_exigir_actor(p_actor);
  v_tenant := public.f281_bloquear_venta(p_numero);
  insert into public.contrato_soportes_pago (numero_contrato, tenant, path, nombre_original, mime, size_bytes, sha256, subido_por)
  values (p_numero, v_tenant, p_path, p_nombre, p_mime, p_size, p_sha, p_actor) returning id into v_id;
  insert into public.avisos (usuario_id, tipo, numero_contrato, soporte_id)
    select d.usuario_id, 'soporte_pago_nuevo', p_numero, v_id from public.f281_destinatarios(p_numero, p_actor) d;
  return jsonb_build_object('id', v_id, 'numero_contrato', p_numero);
end $$;

-- Bloquea la venta ACTUAL del soporte con el mismo primer bloqueo de siempre (venta). Si el contrato se renumeró mientras esperaba el bloqueo (la fila vieja
-- desapareció y el soporte ya tiene el número nuevo), vuelve a resolver y bloquea la nueva; nunca opera bajo un número que ya no existe.
create function public.f281_bloquear_contrato_del_soporte(p_id bigint, out o_numero text, out o_tenant text)
language plpgsql security definer set search_path = '' as $$
declare v_num text; v_despues text; v_intentos int := 0;
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  loop
    select s.numero_contrato into v_num from public.contrato_soportes_pago s where s.id = p_id;   -- sin bloqueo: solo para saber qué venta bloquear
    if v_num is null then
      raise exception 'SOPORTE_INEXISTENTE: el soporte % no existe.', p_id using errcode = 'F4512';
    end if;
    select v.tenant into o_tenant from public.ventas v where v.numero_contrato = v_num for update;
    if found then
      select s.numero_contrato into v_despues from public.contrato_soportes_pago s where s.id = p_id;
      if v_despues = v_num then o_numero := v_num; return; end if;
    end if;
    v_intentos := v_intentos + 1;
    if v_intentos >= 3 then
      raise exception 'SOPORTE_CONTRATO_INEXISTENTE: el contrato del soporte % no existe.', p_id using errcode = 'F4510';
    end if;
  end loop;
end $$;

create function public.soporte_reemplazar(p_id bigint, p_actor uuid, p_path text, p_nombre text, p_mime text, p_size bigint, p_sha text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_num text; v_tenant text; o public.contrato_soportes_pago; v_id bigint;
begin
  perform public.f281_exigir_actor(p_actor);
  select b.o_numero, b.o_tenant into v_num, v_tenant from public.f281_bloquear_contrato_del_soporte(p_id) b;   -- venta primero (orden de anular_abono)
  select * into o from public.contrato_soportes_pago s where s.id = p_id for update;
  if o.archivado_en is not null then
    raise exception 'SOPORTE_ARCHIVADO: el soporte % pertenece a un contrato que ya no existe.', p_id using errcode = 'F4520';
  end if;
  if not o.vigente then
    raise exception 'SOPORTE_NO_VIGENTE: el soporte % ya no está vigente (otro reemplazo o retiro se adelantó).', p_id using errcode = 'F4513';
  end if;
  update public.contrato_soportes_pago
     set vigente = false, retirado_en = now(), retirado_por = p_actor, motivo_retiro = 'reemplazo'
   where id = p_id;
  insert into public.contrato_soportes_pago (numero_contrato, tenant, path, nombre_original, mime, size_bytes, sha256, subido_por, reemplaza_id)
  values (v_num, v_tenant, p_path, p_nombre, p_mime, p_size, p_sha, p_actor, p_id) returning id into v_id;
  insert into public.avisos (usuario_id, tipo, numero_contrato, soporte_id)
    select d.usuario_id, 'soporte_pago_reemplazado', v_num, v_id from public.f281_destinatarios(v_num, p_actor) d;
  return jsonb_build_object('id', v_id, 'numero_contrato', v_num, 'reemplaza_id', p_id);
end $$;

create function public.soporte_retirar(p_id bigint, p_actor uuid, p_nota text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_num text; o public.contrato_soportes_pago;
begin
  perform public.f281_exigir_actor(p_actor);
  select b.o_numero into v_num from public.f281_bloquear_contrato_del_soporte(p_id) b;
  select * into o from public.contrato_soportes_pago s where s.id = p_id for update;
  if o.archivado_en is not null then
    raise exception 'SOPORTE_ARCHIVADO: el soporte % pertenece a un contrato que ya no existe.', p_id using errcode = 'F4520';
  end if;
  if not o.vigente then
    raise exception 'SOPORTE_NO_VIGENTE: el soporte % ya no está vigente.', p_id using errcode = 'F4513';
  end if;
  update public.contrato_soportes_pago
     set vigente = false, retirado_en = now(), retirado_por = p_actor, motivo_retiro = 'retiro', nota_retiro = nullif(btrim(p_nota), '')
   where id = p_id;
  return jsonb_build_object('id', p_id, 'numero_contrato', v_num);
end $$;

-- Avisos: reclamar (notificación/sonido, UNA sola pestaña) y marcar leídos son operaciones distintas.
create function public.avisos_reclamar(p_usuario uuid, p_limite int default 20)
returns table (id bigint, tipo text, numero_contrato text, creado_en timestamptz)
language sql security definer set search_path = '' as $$
  update public.avisos a set notificado_en = now()
   where a.id in (select x.id from public.avisos x
                   where x.usuario_id = p_usuario and x.notificado_en is null and x.leido_en is null and x.archivado_en is null
                   order by x.id limit greatest(1, least(coalesce(p_limite, 20), 50)) for update skip locked)
  returning a.id, a.tipo, a.numero_contrato, a.creado_en
$$;

create function public.avisos_marcar_leidos(p_usuario uuid, p_ids bigint[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.avisos a set leido_en = now(), notificado_en = coalesce(a.notificado_en, now())
   where a.usuario_id = p_usuario and a.leido_en is null and (p_ids is null or a.id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── Identidad del contrato vs consecutivo reutilizable ────────────────────
-- Cuando una fila de `ventas` desaparece (eliminar_contrato, revertir_contrato_incompleto, cualquier DELETE), la evidencia de ESE número se archiva.
-- Solo ejecuta UPDATE sobre las tablas de esta migración; no toca ni lee nada financiero. Si el número se reutiliza, el contrato nuevo empieza limpio.
create function public.f281_archivar_evidencia() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.contrato_soportes_pago set archivado_en = now() where numero_contrato = old.numero_contrato and archivado_en is null;
  update public.avisos set archivado_en = now() where numero_contrato = old.numero_contrato and archivado_en is null;
  return null;
end $$;
create trigger trg_f281_archivar_evidencia after delete on public.ventas
  for each row execute function public.f281_archivar_evidencia();

-- ── Renumerar un contrato: el MISMO contrato conserva su evidencia bajo el número nuevo ─────────────────────────────────────────────────────────
-- fn_renumerar_contrato (115) copia la fila de ventas con el número nuevo, mueve las hijas por clave foránea y borra la vieja. Estas tablas no tienen esa
-- clave (a propósito: la evidencia sobrevive al contrato), así que sin más el borrado las ARCHIVARÍA y el aliado las perdería de la ficha. La 281 añade
-- UNA llamada, dentro de la misma transacción y antes del borrado, que mueve soportes (vigentes e historial) y avisos al número nuevo. La ruta física
-- del archivo no cambia. Se conservan el propietario, SECURITY DEFINER, search_path y los PERMISOS de la función (CREATE OR REPLACE no los toca; se comprueba abajo).

-- Respaldo de la definición y los permisos originales (para el rollback). Sin acceso para nadie salvo el propietario.
create table public.f281_respaldo_funciones (
  nombre          text primary key,
  definicion      text not null,      -- pg_get_functiondef de la versión ORIGINAL (listo para ejecutarse)
  prosrc_md5      text not null,      -- md5 del cuerpo original (sin CR)
  acl_original    text not null,      -- proacl::text original ('<defecto>' si era NULL)
  propietario     text not null,
  prosrc_md5_281  text,               -- md5 del cuerpo que dejó la 281
  acl_tras_281    text,
  guardado_en     timestamptz not null default now()
);
alter table public.f281_respaldo_funciones enable row level security;
revoke all on public.f281_respaldo_funciones from public, anon, authenticated, service_role;
insert into public.f281_respaldo_funciones (nombre, definicion, prosrc_md5, acl_original, propietario)
  select 'fn_renumerar_contrato', pg_get_functiondef(p.oid), md5(replace(p.prosrc, chr(13), '')), coalesce(p.proacl::text, '<defecto>'), p.proowner::regrole::text
    from pg_proc p where p.oid = 'public.fn_renumerar_contrato(text,text)'::regprocedure;

create function public.f281_trasladar_evidencia(p_viejo text, p_nuevo text) returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.ventas; v_new public.ventas;
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  select * into v_old from public.ventas where numero_contrato = p_viejo for update;   -- ya lo tiene la renumeración; se reafirma (mismo orden: venta primero)
  select * into v_new from public.ventas where numero_contrato = p_nuevo;
  -- Comprobación de COHERENCIA (no autorización): ambas ventas existen, números distintos, misma agencia y mismo created_at (la copia lo conserva).
  if v_old.numero_contrato is null or v_new.numero_contrato is null or p_viejo = p_nuevo
     or v_old.tenant is distinct from v_new.tenant or v_old.created_at is distinct from v_new.created_at then
    raise exception 'TRASLADO_INCOHERENTE: % y % no son el mismo contrato renumerado.', p_viejo, p_nuevo using errcode = 'F4521';
  end if;
  perform pg_catalog.set_config('app.f281_traslado', p_viejo || '>' || p_nuevo, true);   -- marca LOCAL de transacción, fijada solo aquí
  update public.contrato_soportes_pago set numero_contrato = p_nuevo where numero_contrato = p_viejo and archivado_en is null;
  update public.avisos set numero_contrato = p_nuevo where numero_contrato = p_viejo and archivado_en is null;
  perform pg_catalog.set_config('app.f281_traslado', '', true);
end $$;
-- Sin ejecutores: ni public, ni anon, ni authenticated, ni service_role. Solo la renumeración (SECURITY DEFINER, mismo propietario) la invoca.
revoke all on function public.f281_trasladar_evidencia(text, text) from public, anon, authenticated, service_role;
revoke all on function public.f281_bloquear_contrato_del_soporte(bigint) from public, anon, authenticated;

create or replace function public.fn_renumerar_contrato(p_viejo text, p_nuevo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  cols text;
  fk record;
begin
  if public.mi_rol() not in ('superadmin','gerencia') then
    raise exception 'No autorizado para renumerar contratos.';
  end if;
  if exists (select 1 from public.ventas where numero_contrato = p_nuevo) then
    raise exception 'Ya existe un contrato con el número nuevo (%).', p_nuevo;
  end if;

  -- 281 (único añadido, 1/2): bloquea la fila VIEJA de ventas antes de copiarla. Es el MISMO primer bloqueo (venta) de soporte_registrar/reemplazar/retirar,
  -- anular_abono y registrar_abono: una alta de soporte en curso bajo el número viejo termina antes del traslado; una que llegue después no encuentra el contrato.
  -- PERFORM no falla si la fila no existe (igual que antes: la función original tampoco fallaba en ese caso).
  perform 1 from public.ventas where numero_contrato = p_viejo for update;

  -- numero_contrato → el nuevo; share_token → uno nuevo (es UNIQUE, no se puede
  -- copiar mientras la fila vieja lo sigue teniendo). El resto, tal cual.
  select string_agg(
    case
      when column_name = 'numero_contrato' then quote_literal(p_nuevo)
      when column_name = 'share_token' then 'gen_random_uuid()'
      else quote_ident(column_name)
    end,
    ', ' order by ordinal_position
  ) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'ventas';

  -- Orden obligatorio: 1) crear la fila nueva (PK nueva) → 2) mover las hijas a
  -- que apunten a ella (ya pueden, la PK existe) → 3) borrar la fila vieja (ya
  -- no la referencia nadie).
  execute format('insert into public.ventas select %s from public.ventas where numero_contrato = %L', cols, p_viejo);

  for fk in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.ventas'::regclass
      and c.conrelid <> 'public.ventas'::regclass
  loop
    execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col) using p_nuevo, p_viejo;
  end loop;

  -- 281 (único añadido, 2/2): traslada soportes y avisos al número nuevo en ESTA transacción, ANTES de borrar la venta vieja. Sin esto el borrado los archivaría.
  perform public.f281_trasladar_evidencia(p_viejo, p_nuevo);

  delete from public.ventas where numero_contrato = p_viejo;
end;
$$;

do $$
declare r public.f281_respaldo_funciones; v_acl text; v_dueno text;
begin
  select p.proacl::text, p.proowner::regrole::text into v_acl, v_dueno from pg_proc p where p.oid = 'public.fn_renumerar_contrato(text,text)'::regprocedure;
  select * into r from public.f281_respaldo_funciones where nombre = 'fn_renumerar_contrato';
  if coalesce(v_acl, '<defecto>') <> r.acl_original or v_dueno <> r.propietario then
    raise exception '281: la renumeración cambió de permisos o propietario (antes % / %, ahora % / %). No se esperaba.', r.acl_original, r.propietario, coalesce(v_acl, '<defecto>'), v_dueno;
  end if;
  update public.f281_respaldo_funciones
     set prosrc_md5_281 = (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = 'public.fn_renumerar_contrato(text,text)'::regprocedure),
         acl_tras_281 = coalesce(v_acl, '<defecto>')
   where nombre = 'fn_renumerar_contrato';
end $$;

-- Solo service_role ejecuta (la autorización del actor la hace el código); nadie más.
revoke all on function public.f281_destinatarios(text, uuid) from public, anon, authenticated;
revoke all on function public.f281_bloquear_venta(text) from public, anon, authenticated;
revoke all on function public.f281_exigir_actor(uuid) from public, anon, authenticated;
revoke all on function public.soporte_registrar(text, uuid, text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.soporte_reemplazar(bigint, uuid, text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.soporte_retirar(bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.avisos_reclamar(uuid, int) from public, anon, authenticated;
revoke all on function public.avisos_marcar_leidos(uuid, bigint[]) from public, anon, authenticated;
revoke all on function public.f281_soportes_insert(), public.f281_soportes_update(), public.f281_soportes_no_borrar(), public.f281_reemplazo_completo(), public.f281_archivar_evidencia() from public, anon, authenticated;
grant execute on function public.soporte_registrar(text, uuid, text, text, text, bigint, text) to service_role;
grant execute on function public.soporte_reemplazar(bigint, uuid, text, text, text, bigint, text) to service_role;
grant execute on function public.soporte_retirar(bigint, uuid, text) to service_role;
grant execute on function public.avisos_reclamar(uuid, int) to service_role;
grant execute on function public.avisos_marcar_leidos(uuid, bigint[]) to service_role;

comment on table public.contrato_soportes_pago is '281: soportes de pago del aliado B2B. Máx. vigentes = abonos del contrato; reemplazar/retirar conservan historial; nunca se borra.';
comment on table public.avisos is '281: avisos internos. notificado_en (reclamado por una pestaña) ≠ leido_en (visto). El contenido no revela datos del contrato.';
