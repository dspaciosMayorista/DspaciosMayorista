-- ───────────────────────────────────────────────────────────────────────────
-- 208 · FACTURACIÓN TRANSACCIONAL E IDEMPOTENTE (#30 B)
--
-- Problema (RACE-1 / COMP-1, reproducidos en Postgres real):
--   La factura de un contrato eran varias llamadas sueltas por PostgREST
--   (config → reversa → asiento → líneas), sin transacción ni bloqueo.
--   · RACE-1: dos guardados simultáneos dejaban dos facturas vigentes o una
--     factura vigente sin configuración.
--   · COMP-1: si fallaban el asiento nuevo y la compensación quedaba un
--     encabezado de reversa vacío que falseaba el estado (el siguiente
--     guardado duplicaba la factura).
--
-- Solución: tres RPC atómicas (una transacción por operación), SOLO para
-- `service_role` (la Server Action las llama con el actor revalidado aquí):
--   · facturar_factura      emitir o re-emitir (reversa + asiento + config)
--   · quitar_factura        retirar (reversa + borrado de la config)
--   · marcar_dian_factura   marcar la factura vigente como emitida a la DIAN
-- Orden de bloqueos SIEMPRE: venta (FOR UPDATE / FOR KEY SHARE) → numeración
-- por agencia (`_siguiente_numero_asiento`, advisory lock de la 164). Espera
-- máxima 5 s (`lock_timeout`).
--
-- Abonos históricos sin asiento (decisión del dueño, 2026-10-13): NO se
-- bloquea la emisión en general (sin F4423). Si el contrato tiene abonos
-- "fuera de libros", la emisión exige que quien factura revise la fotografía
-- de esos abonos (hash sha256) y deja una CONSTANCIA atómica en
-- `factura_revision_fuera_libros`, vinculada a ESA emisión. Cartera no cambia.
--
-- M1 (abonos): el asiento de un abono solo lo escribe `postear_asiento_abono`
-- (venta FOR KEY SHARE → abono FOR UPDATE, en la misma transacción): nunca
-- queda un asiento de un abono borrado a mitad de camino (posteo tardío).
--
-- Guardas permanentes (sobreviven a la retirada parcial, D-RET): sin la RPC,
-- emitir, cambiar importes y quitar facturas quedan CONGELADOS (F4440); solo se
-- permite marcar DIAN (false → true) sobre una factura vigente. Las guardas que
-- dependen de `current_user` son SECURITY INVOKER; los helpers privilegiados
-- (DEFINER) viven en el esquema `f208_priv`, que NO expone PostgREST, y
-- comprueban rol y agencia de quien llama.
--
-- Errores: SQLSTATE propio F44xx (llega a la app como `error.code`), mensaje
-- 'FIN_<CODIGO>: texto'.
--   F4401 FIN_NO_AUTORIZADO            F4402 FIN_OTRA_AGENCIA
--   F4403 FIN_SIN_ACCESO               F4404 FIN_CONTRATO_INEXISTENTE
--   F4405 FIN_ABONO_INEXISTENTE        F4410 FIN_IMPORTES_DESACTUALIZADOS
--   F4411 FIN_IRT_SUPERA_TOTAL         F4412 FIN_FACTURA_EN_OTRA_AGENCIA
--   F4413 FIN_SIN_TRM                  F4416 FIN_PUC_INCOMPLETO
--   F4415 FIN_ABONO_CON_ASIENTO        F4418 FIN_ANTICIPO_APLICADO        F4420 FIN_ABONO_PENDIENTE_CONTABILIZAR
--   F4421 FIN_ASIENTO_ABONO_SOLO_RPC   F4426 FIN_ABONO_NO_CONTABILIZABLE
--   F4430 FIN_REVISION_DESACTUALIZADA  F4431 FIN_REVISION_REQUERIDA
--   F4432 FIN_NOTA_REQUERIDA           F4434 FIN_DIAN_INMUTABLE
--   F4435 FIN_DIAN_SIN_FACTURA         F4436 FIN_REVISION_NO_VINCULADA
--   F4437 FIN_CONSTANCIA_SOLO_RPC      F4438 FIN_SIN_FACTURA_VIGENTE
--   F4439 FIN_CONSTANCIA_INMUTABLE     F4440 FIN_FACTURACION_EN_MANTENIMIENTO
--   F4450 FIN_HISTORIA_CONTABLE
--
-- Fuera de esta migración (a propósito): el bloqueo general F4423; la
-- ampliación r5 (abonos_historial, RPC/UI de abonos, importador); la operación
-- atómica de eliminar abono (aquí solo la guarda mínima F4415);
-- la clave de idempotencia de abonos (exige UI no reservada); #44 (K15) y 207.
-- Preflight / postcheck / rollback / pruebas: supabase/scripts/*_208_*.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 0. Precondiciones ──────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public._siguiente_numero_asiento(text)') is null
     or to_regprocedure('public._cuenta_disponible(text,text)') is null
     or to_regprocedure('public.fecha_negocio(timestamptz)') is null
     or to_regprocedure('public.mi_rol()') is null
     or to_regprocedure('public.puede_ver_tenant(text)') is null then
    raise exception '208: faltan funciones base (164/198/107/140).';
  end if;
  if to_regclass('public.contrato_facturacion') is null or to_regclass('public.asientos_contables') is null then
    raise exception '208: faltan tablas base (098/126).';
  end if;
  if to_regclass('public.factura_revision_fuera_libros') is not null then
    raise exception '208: ya aplicada (existe factura_revision_fuera_libros). No se re-aplica.';
  end if;
end $$;

-- ── 1. Esquema privado (no expuesto por PostgREST) ────────────────────────
create schema f208_priv;
revoke all on schema f208_priv from public;
grant usage on schema f208_priv to authenticated, service_role;

-- Corte: último abono existente al instalar. Los abonos posteriores que la app
-- registra (contabilizables) deben tener su asiento; los anteriores son historia.
create table f208_priv.corte (
  id smallint primary key default 1 check (id = 1),
  ultimo_abono_id bigint not null,
  instalado_en timestamptz not null default now()
);
insert into f208_priv.corte (ultimo_abono_id) select coalesce(max(id), 0) from public.abonos;
revoke all on f208_priv.corte from public;
grant select on f208_priv.corte to service_role;

-- Acceso de quien llama a un helper privilegiado (DEFINER). Dentro de un
-- DEFINER `current_user` es el dueño; el rol de la sesión se lee del GUC
-- `role` (SET ROLE de PostgREST), que un rol no puede falsificar sin ser
-- miembro del rol destino.
--   · service_role                → sí
--   · sesión de administración (sin SET ROLE, superusuario) → sí
--   · authenticated con rol contable activo y la agencia visible → sí
--   · cualquier otro              → F4403
create function f208_priv.exigir_acceso(p_tenant text, p_roles text[] default array['superadmin','gerencia','administracion'])
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_rol_sesion text := coalesce(pg_catalog.current_setting('role', true), 'none');
begin
  if v_rol_sesion = 'service_role' then return; end if;
  if v_rol_sesion in ('none', '') and (select rolsuper from pg_catalog.pg_roles where rolname = session_user) then return; end if;
  if v_rol_sesion = 'authenticated' and auth.uid() is not null
     and public.mi_rol()::text = any (p_roles) and public.puede_ver_tenant(p_tenant) then
    return;
  end if;
  raise exception 'FIN_SIN_ACCESO: sin acceso a la facturación de esta agencia.' using errcode = 'F4403';
end $$;

-- Bloquea la venta (orden único: venta primero) y devuelve su agencia.
create function f208_priv.bloquear_venta(p_numero text, p_modo text default 'update')
returns text language plpgsql security definer set search_path = '' as $$
declare v_tenant text;
begin
  if p_modo = 'key_share' then
    select tenant into v_tenant from public.ventas where numero_contrato = p_numero for key share;
  else
    select tenant into v_tenant from public.ventas where numero_contrato = p_numero for update;
  end if;
  if not found then
    raise exception 'FIN_CONTRATO_INEXISTENTE: el contrato % no existe.', p_numero using errcode = 'F4404';
  end if;
  perform f208_priv.exigir_acceso(v_tenant);
  return v_tenant;
end $$;

-- Id del asiento de factura VIGENTE del contrato en la agencia del contrato
-- (más 'facturacion' que 'facturacion_reversion'); null si no hay.
create function f208_priv.factura_vigente_id(p_numero text)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare v_tenant text; v_id bigint;
begin
  select tenant into v_tenant from public.ventas where numero_contrato = p_numero;
  if v_tenant is null then return null; end if;
  perform f208_priv.exigir_acceso(v_tenant);
  select case when count(*) filter (where origen = 'facturacion') > count(*) filter (where origen = 'facturacion_reversion')
              then max(id) filter (where origen = 'facturacion') end
    into v_id
    from public.asientos_contables
   where referencia = 'facturacion:' || p_numero and tenant = v_tenant
     and origen in ('facturacion', 'facturacion_reversion');
  return v_id;
end $$;

create function f208_priv.dian_emitida(p_numero text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_tenant text; v_dian boolean;
begin
  select tenant into v_tenant from public.ventas where numero_contrato = p_numero;
  if v_tenant is not null then perform f208_priv.exigir_acceso(v_tenant); end if;
  select dian_emitida into v_dian from public.contrato_facturacion where numero_contrato = p_numero;
  return coalesce(v_dian, false);
end $$;

-- Clase del asiento al que pertenece una línea: 'F:<contrato>' (factura),
-- 'A:<referencia>' (abono) o null (cualquier otro). Comprueba agencia.
create function f208_priv.clase_asiento(p_asiento_id bigint)
returns text language plpgsql stable security definer set search_path = '' as $$
declare r record;
begin
  select tenant, origen, referencia into r from public.asientos_contables where id = p_asiento_id;
  if not found then return null; end if;
  if r.origen in ('facturacion', 'facturacion_reversion') then
    perform f208_priv.exigir_acceso(r.tenant, array['superadmin','gerencia','administracion','operaciones']);
    return 'F:' || substr(coalesce(r.referencia, ''), 13);
  elsif r.origen = 'abono' then
    perform f208_priv.exigir_acceso(r.tenant, array['superadmin','gerencia','administracion','operaciones']);
    return 'A:' || coalesce(r.referencia, '');
  end if;
  return null;
end $$;

-- Historia de facturación de un contrato (protector de ventas).
create function f208_priv.historia_factura(p_numero text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (select 1 from public.asientos_contables where referencia = 'facturacion:' || p_numero
                    and origen in ('facturacion', 'facturacion_reversion'))
      or exists (select 1 from public.factura_revision_fuera_libros where numero_contrato = p_numero);
end $$;

-- ¿Estamos dentro de la RPC de factura de ESTE contrato? (INVOKER: necesita el
-- current_user real; un DEFINER vería al dueño.)
create function f208_priv.es_rpc_factura(p_numero text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select current_user = 'service_role'
     and coalesce(pg_catalog.current_setting('app.factura_rpc', true), '') = coalesce(p_numero, '')
     and p_numero is not null
$$;
create function f208_priv.es_rpc_abono(p_referencia text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select current_user = 'service_role'
     and coalesce(pg_catalog.current_setting('app.posteo_abono', true), '') = coalesce(p_referencia, '')
     and p_referencia is not null
$$;

-- Cuenta del PUC (F4416 si falta).
create function f208_priv.puc_id(p_tenant text, p_codigo text)
returns bigint language plpgsql stable set search_path = '' as $$
declare v bigint;
begin
  select id into v from public.puc_cuentas where tenant = p_tenant and codigo = p_codigo;
  if v is null then
    raise exception 'FIN_PUC_INCOMPLETO: Falta la cuenta % en el Plan de cuentas de %.', p_codigo, p_tenant using errcode = 'F4416';
  end if;
  return v;
end $$;

create function f208_priv.hash_fotografia(p jsonb)
returns text language sql immutable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(p::text, 'UTF8')), 'hex')
$$;

-- ── 2. Abonos: contabilizable (quién lo registró) y revisión ──────────────
-- contabilizable: true = lo registró la app con sesión (debe tener asiento);
-- false = lo escribió el servidor con service_role (importador, pagos previos:
-- no llevan asiento de abono propio); null = histórico anterior a la 208.
alter table public.abonos add column contabilizable boolean;
alter table public.abonos add column rev integer not null default 0;

create function public.f208_abonos_marca() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.contabilizable := (current_user <> 'service_role');
    new.rev := 0;
  else
    if new.contabilizable is distinct from old.contabilizable then
      raise exception 'FIN_ABONO_NO_CONTABILIZABLE: la procedencia del abono % no se cambia.', old.id using errcode = 'F4426';
    end if;
    new.rev := old.rev + 1;
  end if;
  return new;
end $$;
create trigger trg_f208_abonos_marca before insert or update on public.abonos
  for each row execute function public.f208_abonos_marca();

-- Un abono CON asiento no se borra (F4415). Hasta contar con una operación atómica de
-- eliminar abono (fuera de esta migración), borrar el abono primero dejaba su asiento
-- huérfano si fallaba el segundo paso de la app. El helper (DEFINER, esquema privado)
-- mira los asientos sin depender de la RLS de quien borra (p. ej. `operaciones` borra
-- abonos pero no lee asientos). Los abonos SIN asiento se borran como siempre.
-- La guarda corre con la fila ya bloqueada: si el posteo concurrente confirma primero,
-- el DELETE lo ve; si el DELETE confirma primero, el posteo encuentra el abono ausente (F4405).
create function f208_priv.abono_tiene_asiento(p_abono_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.asientos_contables a
     where (a.origen = 'abono' and a.referencia = 'abono:' || p_abono_id)
        or (a.origen = 'pago_previo_aplicacion' and a.referencia like 'pago_previo:%:abono:' || p_abono_id))
$$;

create function public.f208_abonos_borrar() returns trigger language plpgsql set search_path = '' as $$
begin
  if f208_priv.abono_tiene_asiento(old.id) then
    raise exception 'FIN_ABONO_CON_ASIENTO: el abono % ya tiene asiento contable y no se elimina; no se borró nada.', old.id using errcode = 'F4415';
  end if;
  return old;
end $$;
create trigger trg_f208_abonos_borrar before delete on public.abonos
  for each row execute function public.f208_abonos_borrar();

-- ── 3. Fotografía de abonos "fuera de libros" ─────────────────────────────
-- Un abono está EN LIBROS si su asiento estándar respalda exactamente su valor
-- en pesos: asiento 'abono:<id>' (Debe caja/bancos X, Haber 280505/130505 X)
-- o la aplicación de un pago previo ('pago_previo:<p>:abono:<id>',
-- Debe 280510 X / Haber 280505 X). Todo lo demás está fuera de libros:
-- sin asiento, asiento no estándar, valor en pesos ausente o distinto.
create function f208_priv.asiento_de_abono(p_abono_id bigint, p_tenant text)
returns jsonb language sql stable set search_path = '' as $$
  with cand as (
    select a.id, a.origen
      from public.asientos_contables a
     where a.tenant = p_tenant
       and ((a.origen = 'abono' and a.referencia = 'abono:' || p_abono_id)
         or (a.origen = 'pago_previo_aplicacion' and a.referencia like 'pago_previo:%:abono:' || p_abono_id))
  ), lin as (
    select c.id, c.origen, l.debe, l.haber, l.tercero, p.codigo
      from cand c join public.asiento_lineas l on l.asiento_id = c.id
      join public.puc_cuentas p on p.id = l.cuenta_id
  )
  select case when (select count(*) from cand) = 0 then null else
    jsonb_build_object(
      'asientos', (select jsonb_agg(c.id order by c.id) from cand c),
      'origen', (select min(c.origen) from cand c),
      'total_debe', (select coalesce(sum(debe), 0) from lin),
      'total_haber', (select coalesce(sum(haber), 0) from lin),
      'lineas', (select coalesce(jsonb_agg(jsonb_build_object('cuenta', codigo, 'debe', debe, 'haber', haber, 'tercero', tercero) order by codigo, debe, haber), '[]') from lin),
      -- Importe que respalda: solo si hay UN asiento con la estructura estándar.
      'respaldo', case when (select count(*) from cand) = 1 and (select count(*) from lin) = 2
        and (select count(*) from lin where debe > 0 and haber = 0 and codigo in ('110505','111005','111010','280510')) = 1
        and (select count(*) from lin where haber > 0 and debe = 0 and codigo in ('280505','130505')) = 1
        and (select sum(debe) from lin) = (select sum(haber) from lin)
        then (select sum(debe) from lin) end)
  end
$$;

create function f208_priv.fotografia_fuera_libros(p_numero text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v record;
  v_factor numeric;
  v_corte bigint := (select ultimo_abono_id from f208_priv.corte);
  v_items jsonb;
  v_total_abonado numeric;
begin
  select numero_contrato, tenant, coalesce(moneda, 'COP') as moneda, precio_venta, trm_contrato
    into v from public.ventas where numero_contrato = p_numero;
  if not found then return null; end if;
  v_factor := case when v.moneda = 'USD'
    then coalesce(nullif(v.trm_contrato, 0), (select nullif(valor, 0)::numeric from public.parametros_tributarios where parametro = 'trm_referencia'))
    else 1 end;

  select coalesce(sum(monto_cop), 0) into v_total_abonado from public.abonos where numero_contrato = p_numero;

  with ab as (
    select b.*, f208_priv.asiento_de_abono(b.id, v.tenant) as asiento
      from public.abonos b where b.numero_contrato = p_numero
  ), cl as (
    select ab.*,
           ab.monto_cop as a_cop,
           (ab.asiento ->> 'respaldo')::numeric as s_cop
      from ab
  ), fuera as (
    select cl.* from cl
     where not (cl.a_cop is not null and cl.s_cop is not null and cl.s_cop = cl.a_cop)
       and not (coalesce(cl.a_cop, 0) = 0 and cl.asiento is null and cl.a_cop is not null)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'fecha_abono', f.fecha_abono, 'valor_abono', f.valor_abono, 'monto_cop', f.monto_cop,
           'trm', f.trm, 'forma_pago', f.forma_pago, 'referencia', f.referencia,
           'contabilizable', f.contabilizable, 'created_at', f.created_at, 'rev', f.rev,
           'procedencia', case when f.contabilizable is null then 'historico'
                               when f.contabilizable then 'app' else 'servidor' end,
           'pendiente_contabilizar', (f.id > v_corte and coalesce(f.contabilizable, false)),
           'asiento', f.asiento,
           'respaldo', case
              when f.a_cop is null or (f.asiento is not null and f.s_cop is null)
                then jsonb_build_object('calculable', false)
              else jsonb_build_object('calculable', true,
                     'respaldado', least(f.a_cop, coalesce(f.s_cop, 0)),
                     'sin_respaldo', greatest(f.a_cop - coalesce(f.s_cop, 0), 0),
                     'exceso', greatest(coalesce(f.s_cop, 0) - f.a_cop, 0)) end)
         order by f.id), '[]'::jsonb)
    into v_items
    from fuera f;

  return jsonb_build_object(
    'v', 1,
    'venta', jsonb_build_object(
      'numero_contrato', v.numero_contrato, 'tenant', v.tenant, 'moneda', v.moneda,
      'precio_venta', v.precio_venta, 'factor_cop', v_factor,
      'total_abonado_cop', v_total_abonado,
      'saldo_cartera_cop', case when v_factor is null then null else round(v.precio_venta * v_factor, 2) - v_total_abonado end),
    'abonos', v_items,
    'total_sin_respaldo_cop', (select coalesce(sum((x -> 'respaldo' ->> 'sin_respaldo')::numeric), 0) from jsonb_array_elements(v_items) x),
    'total_exceso_cop', (select coalesce(sum((x -> 'respaldo' ->> 'exceso')::numeric), 0) from jsonb_array_elements(v_items) x),
    'no_calculables', (select count(*) from jsonb_array_elements(v_items) x where not (x -> 'respaldo' ->> 'calculable')::boolean));
end $$;

-- ── 4. Constancia de revisión (append-only) ───────────────────────────────
create table public.factura_revision_fuera_libros (
  id                    bigint generated always as identity primary key,
  evento                text not null check (evento in ('revision_emitida', 'factura_retirada')),
  revision_id           bigint references public.factura_revision_fuera_libros(id),
  numero_contrato       text not null,
  tenant                text not null,
  asiento_factura_id    bigint,
  asiento_reversion_id  bigint,
  fotografia            jsonb not null,
  hash                  text not null,
  algoritmo             text not null default 'sha256/v1',
  config_factura        jsonb,
  actor                 uuid not null,
  actor_email           text,
  actor_rol             text,
  nota                  text,
  registrado_en         timestamptz not null default now(),
  check ((evento = 'revision_emitida') = (revision_id is null))
);
create unique index ux_f208_revision_por_emision on public.factura_revision_fuera_libros (asiento_factura_id)
  where evento = 'revision_emitida' and asiento_factura_id is not null;
create index ix_f208_revision_contrato on public.factura_revision_fuera_libros (numero_contrato);
alter table public.factura_revision_fuera_libros enable row level security;
-- Sin policies: nadie la lee por la API; la consulta va por
-- f208_discrepancias_fuera_libros() (filtro explícito de rol y agencia).
revoke all on public.factura_revision_fuera_libros from public, anon, authenticated, service_role;
grant select, insert on public.factura_revision_fuera_libros to service_role;

create function public.f208_constancia_guarda() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not f208_priv.es_rpc_factura(new.numero_contrato) then
      raise exception 'FIN_CONSTANCIA_SOLO_RPC: la constancia solo la registra la RPC de facturación.' using errcode = 'F4437';
    end if;
    return new;
  end if;
  raise exception 'FIN_CONSTANCIA_INMUTABLE: las constancias de revisión no se modifican ni se borran.' using errcode = 'F4439';
end $$;
create trigger trg_f208_constancia_guarda before insert or update or delete on public.factura_revision_fuera_libros
  for each row execute function public.f208_constancia_guarda();
create function public.f208_truncate_prohibido() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'FIN_FACTURACION_EN_MANTENIMIENTO: % no admite TRUNCATE.', tg_table_name using errcode = 'F4440';
end $$;
create trigger trg_f208_constancia_truncate before truncate on public.factura_revision_fuera_libros
  for each statement execute function public.f208_truncate_prohibido();

-- ── 5. Vínculo de la configuración con su emisión ─────────────────────────
alter table public.contrato_facturacion
  add column asiento_factura_id bigint references public.asientos_contables(id),
  add column revision_id bigint references public.factura_revision_fuera_libros(id);

-- ── 6. Guardas de contrato_facturacion (D-RET) ────────────────────────────
-- BEFORE INSERT: solo bloquea la venta (orden venta → configuración). Las
-- decisiones van en AFTER ROW: con INSERT … ON CONFLICT DO UPDATE el BEFORE
-- INSERT corre aunque la fila termine por la rama UPDATE, así que decidir ahí
-- rechazaría operaciones legítimas (marcar DIAN por upsert).
create function public.f208_cf_bloquear() returns trigger language plpgsql set search_path = '' as $$
begin
  perform f208_priv.bloquear_venta(new.numero_contrato, 'update');
  return new;
end $$;

create function public.f208_cf_validar() returns trigger language plpgsql set search_path = '' as $$
declare
  v_importes boolean;
  v_marca_dian boolean;
  v_vigente bigint;
  r record;
  v_hash text;
begin
  -- Ramas separadas por operación: nunca se lee OLD en un INSERT.
  if tg_op = 'INSERT' then
    v_importes := true;
    v_marca_dian := new.dian_emitida;
  else
    v_importes := (new.numero_contrato, new.irt, new.ingreso_propio, new.lleva_iva, new.ingreso_exento, new.tipo_exento,
                   new.observacion, new.asiento_factura_id, new.revision_id)
      is distinct from (old.numero_contrato, old.irt, old.ingreso_propio, old.lleva_iva, old.ingreso_exento, old.tipo_exento,
                        old.observacion, old.asiento_factura_id, old.revision_id);
    if old.dian_emitida then
      if v_importes or new.dian_emitida is distinct from old.dian_emitida or new.dian_fecha is distinct from old.dian_fecha then
        raise exception 'FIN_DIAN_INMUTABLE: la factura de % ya está emitida a la DIAN; no se cambia, no se desmarca ni se quita.', old.numero_contrato using errcode = 'F4434';
      end if;
    end if;
    v_marca_dian := new.dian_emitida and not old.dian_emitida;
  end if;

  -- Marcar DIAN sin factura vigente: el motivo más preciso va primero (Q10).
  if v_marca_dian then
    if f208_priv.factura_vigente_id(new.numero_contrato) is null then
      raise exception 'FIN_DIAN_SIN_FACTURA: % no tiene factura vigente; no se marca a la DIAN.', new.numero_contrato using errcode = 'F4435';
    end if;
  end if;

  if v_importes and not f208_priv.es_rpc_factura(new.numero_contrato) then
    raise exception 'FIN_FACTURACION_EN_MANTENIMIENTO: la facturación de % solo se emite o cambia por la operación atómica; no se emitió ni cambió nada.', new.numero_contrato using errcode = 'F4440';
  end if;

  -- Vínculo de UNA sola emisión (solo se evalúa dentro de la RPC).
  if v_importes then
    v_vigente := f208_priv.factura_vigente_id(new.numero_contrato);
    if new.asiento_factura_id is not null and new.asiento_factura_id is distinct from v_vigente then
      raise exception 'FIN_REVISION_NO_VINCULADA: la configuración de % no apunta a la factura vigente.', new.numero_contrato using errcode = 'F4436';
    end if;
    if new.revision_id is not null then
      select * into r from public.factura_revision_fuera_libros where id = new.revision_id;
      v_hash := f208_priv.hash_fotografia(f208_priv.fotografia_fuera_libros(new.numero_contrato));
      if r.id is null or r.evento <> 'revision_emitida' or r.numero_contrato <> new.numero_contrato
         or r.asiento_factura_id is distinct from new.asiento_factura_id
         or r.hash <> v_hash
         or r.config_factura is distinct from jsonb_build_object('irt', new.irt, 'ingreso_propio', new.ingreso_propio,
              'ingreso_exento', new.ingreso_exento, 'tipo_exento', new.tipo_exento, 'observacion', new.observacion) then
        raise exception 'FIN_REVISION_NO_VINCULADA: la constancia % no corresponde a esta emisión de %.', new.revision_id, new.numero_contrato using errcode = 'F4436';
      end if;
    end if;
  end if;
  return null;
end $$;

create function public.f208_cf_borrar() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.dian_emitida then
    raise exception 'FIN_DIAN_INMUTABLE: la factura de % ya está emitida a la DIAN; no se quita.', old.numero_contrato using errcode = 'F4434';
  end if;
  if not f208_priv.es_rpc_factura(old.numero_contrato) then
    raise exception 'FIN_FACTURACION_EN_MANTENIMIENTO: la factura de % solo se retira por la operación atómica; no se retiró nada.', old.numero_contrato using errcode = 'F4440';
  end if;
  return old;  -- sin bloquear la venta: evita el interbloqueo con guardar
end $$;

create trigger trg_f208_cf_bloquear before insert on public.contrato_facturacion
  for each row execute function public.f208_cf_bloquear();
create trigger trg_f208_cf_validar after insert or update on public.contrato_facturacion
  for each row execute function public.f208_cf_validar();
create trigger trg_f208_cf_borrar before delete on public.contrato_facturacion
  for each row execute function public.f208_cf_borrar();
create trigger trg_f208_cf_truncate before truncate on public.contrato_facturacion
  for each statement execute function public.f208_truncate_prohibido();

-- ── 7. Guardas de asientos: factura (F4440/F4434) y abono (F4421) ─────────
create function public.f208_asiento_guarda() returns trigger language plpgsql set search_path = '' as $$
declare
  v_viejo text; v_nuevo text; v_ref_v text; v_ref_n text;
  v_n text;
begin
  -- Ramas separadas por operación: nunca se lee OLD en INSERT ni NEW en DELETE.
  if tg_op in ('UPDATE', 'DELETE') then v_viejo := old.origen; v_ref_v := old.referencia; end if;
  if tg_op in ('UPDATE', 'INSERT') then v_nuevo := new.origen; v_ref_n := new.referencia; end if;
  -- Factura: insertar, cambiar o borrar exige la RPC del contrato.
  if v_viejo in ('facturacion', 'facturacion_reversion') or v_nuevo in ('facturacion', 'facturacion_reversion') then
    if tg_op = 'UPDATE' and (coalesce(v_viejo, '') in ('facturacion', 'facturacion_reversion')) <> (coalesce(v_nuevo, '') in ('facturacion', 'facturacion_reversion')) then
      raise exception 'FIN_FACTURACION_EN_MANTENIMIENTO: un asiento no entra ni sale de la facturación por edición.' using errcode = 'F4440';
    end if;
    foreach v_n in array array[v_ref_v, v_ref_n] loop
      continue when v_n is null;
      if v_n not like 'facturacion:%' or not f208_priv.es_rpc_factura(substr(v_n, 13)) then
        raise exception 'FIN_FACTURACION_EN_MANTENIMIENTO: asiento de factura % rechazado; no se registró nada.', v_n using errcode = 'F4440';
      end if;
    end loop;
    if tg_op = 'INSERT' and v_nuevo = 'facturacion_reversion' then
      perform f208_priv.bloquear_venta(substr(v_ref_n, 13), 'update');
      if f208_priv.dian_emitida(substr(v_ref_n, 13)) then
        raise exception 'FIN_DIAN_INMUTABLE: la factura de % ya está emitida a la DIAN; no se reversa.', substr(v_ref_n, 13) using errcode = 'F4434';
      end if;
    end if;
  end if;

  -- Abono (M1): solo `postear_asiento_abono` escribe su asiento. Borrar sigue
  -- permitido (eliminarAbono); editar origen/referencia, no.
  if (tg_op = 'INSERT' and v_nuevo = 'abono')
     or (tg_op = 'UPDATE' and (v_viejo = 'abono' or v_nuevo = 'abono')) then
    if not f208_priv.es_rpc_abono(v_ref_n) or (tg_op = 'UPDATE' and v_ref_v is distinct from v_ref_n) then
      raise exception 'FIN_ASIENTO_ABONO_SOLO_RPC: el asiento de un abono solo lo registra la operación de posteo (%).', coalesce(v_ref_n, v_ref_v) using errcode = 'F4421';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger trg_f208_asiento_guarda_i before insert on public.asientos_contables
  for each row when (new.origen in ('facturacion', 'facturacion_reversion', 'abono'))
  execute function public.f208_asiento_guarda();
create trigger trg_f208_asiento_guarda_u before update on public.asientos_contables
  for each row when (old.origen in ('facturacion', 'facturacion_reversion', 'abono') or new.origen in ('facturacion', 'facturacion_reversion', 'abono'))
  execute function public.f208_asiento_guarda();
create trigger trg_f208_asiento_guarda_d before delete on public.asientos_contables
  for each row when (old.origen in ('facturacion', 'facturacion_reversion'))
  execute function public.f208_asiento_guarda();
create trigger trg_f208_asientos_truncate before truncate on public.asientos_contables
  for each statement execute function public.f208_truncate_prohibido();

-- Líneas: las de un asiento de factura solo dentro de su RPC; las de un
-- asiento de abono solo se insertan/editan dentro del posteo (borrar, sí).
create function public.f208_linea_guarda() returns trigger language plpgsql set search_path = '' as $$
declare
  v_clase text;
  v_id bigint;
  v_ids bigint[] := '{}';
begin
  if tg_op in ('UPDATE', 'DELETE') then v_ids := v_ids || old.asiento_id; end if;
  if tg_op in ('UPDATE', 'INSERT') then v_ids := v_ids || new.asiento_id; end if;
  foreach v_id in array v_ids loop
    continue when v_id is null;
    v_clase := f208_priv.clase_asiento(v_id);
    continue when v_clase is null;
    if v_clase like 'F:%' and not f208_priv.es_rpc_factura(substr(v_clase, 3)) then
      raise exception 'FIN_FACTURACION_EN_MANTENIMIENTO: líneas del asiento de factura % rechazadas.', substr(v_clase, 3) using errcode = 'F4440';
    end if;
    if v_clase like 'A:%' and tg_op <> 'DELETE' and not f208_priv.es_rpc_abono(substr(v_clase, 3)) then
      raise exception 'FIN_ASIENTO_ABONO_SOLO_RPC: líneas del asiento % rechazadas.', substr(v_clase, 3) using errcode = 'F4421';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger trg_f208_linea_guarda before insert or update or delete on public.asiento_lineas
  for each row execute function public.f208_linea_guarda();
create trigger trg_f208_lineas_truncate before truncate on public.asiento_lineas
  for each statement execute function public.f208_truncate_prohibido();

-- ── 8. Protector de la historia de ventas (P-a) ───────────────────────────
-- Las facturas se enlazan por texto ('facturacion:<contrato>'): borrar o
-- renumerar (o cambiar de agencia) una venta con historia de facturación
-- dejaría asientos huérfanos. Se rechaza en la primera escritura.
create function public.f208_ventas_protector() returns trigger language plpgsql set search_path = '' as $$
declare v_afecta boolean;
begin
  if tg_op = 'DELETE' then
    v_afecta := true;
  else
    v_afecta := new.numero_contrato is distinct from old.numero_contrato or new.tenant is distinct from old.tenant;
  end if;
  if v_afecta and f208_priv.historia_factura(old.numero_contrato) then
    raise exception 'FIN_HISTORIA_CONTABLE: el contrato % tiene historia de facturación en los libros; no se borra, renumera ni cambia de agencia.', old.numero_contrato using errcode = 'F4450';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger trg_f208_ventas_protector before delete or update of numero_contrato, tenant on public.ventas
  for each row execute function public.f208_ventas_protector();

-- ── 9. RPC: comunes ───────────────────────────────────────────────────────
-- Actor revalidado contra `usuarios` (activo + rol); devuelve su fila.
create function f208_priv.actor(p_actor uuid, p_roles text[])
returns public.usuarios language plpgsql stable set search_path = '' as $$
declare u public.usuarios;
begin
  if current_user <> 'service_role' then
    raise exception 'Solo el servidor ejecuta esta operación.' using errcode = '42501';
  end if;
  select * into u from public.usuarios where id = p_actor;
  if u.id is null or u.activo is not true or not (u.rol::text = any (p_roles)) then
    raise exception 'FIN_NO_AUTORIZADO: el usuario no está autorizado para esta operación.' using errcode = 'F4401';
  end if;
  return u;
end $$;

-- Agencia: la del contrato debe ser la activa de la sesión (p_tenant) y, salvo
-- superadmin, la del usuario.
create function f208_priv.exigir_agencia(u public.usuarios, p_tenant text, v_tenant text, p_globales text[] default array['superadmin'])
returns void language plpgsql stable set search_path = '' as $$
begin
  if p_tenant is distinct from v_tenant then
    raise exception 'FIN_OTRA_AGENCIA: el contrato es de la agencia %; cambia a esa agencia.', v_tenant using errcode = 'F4402';
  end if;
  if not (u.rol::text = any (p_globales)) and u.tenant is distinct from v_tenant then
    raise exception 'FIN_OTRA_AGENCIA: el contrato es de la agencia %, que no es la tuya.', v_tenant using errcode = 'F4402';
  end if;
end $$;

-- Importes autoritativos de la factura (en pesos).
create function f208_priv.importes_factura(p_numero text, out pvp numeric, out irt numeric, out tenant text)
language plpgsql stable set search_path = '' as $$
declare v record; v_factor numeric;
begin
  select v2.tenant, coalesce(v2.moneda, 'COP') as moneda, v2.precio_venta, v2.trm_contrato into v
    from public.ventas v2 where v2.numero_contrato = p_numero;
  tenant := v.tenant;
  if v.moneda = 'USD' then
    v_factor := coalesce(nullif(v.trm_contrato, 0), (select nullif(valor, 0)::numeric from public.parametros_tributarios where parametro = 'trm_referencia'));
    if v_factor is null or v_factor <= 0 then
      raise exception 'FIN_SIN_TRM: el contrato es en USD y no tiene TRM para convertir a pesos.' using errcode = 'F4413';
    end if;
  else
    v_factor := 1;
  end if;
  pvp := coalesce(v.precio_venta, 0) * v_factor;
  select coalesce(sum(c.valor_total), 0) * v_factor into irt
    from public.cuentas_por_pagar c
   where c.numero_contrato = p_numero and c.tenant = v.tenant and coalesce(c.clasificacion, 'costo') = 'irt';
end $$;

-- Reversa del asiento vigente (líneas invertidas). Devuelve su id.
create function f208_priv.reversar(p_vigente bigint, p_tenant text, p_numero text, p_email text)
returns bigint language plpgsql set search_path = '' as $$
declare v_num bigint; v_id bigint; v_desc text;
begin
  select descripcion into v_desc from public.asientos_contables where id = p_vigente;
  v_num := public._siguiente_numero_asiento(p_tenant);
  insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
  values (p_tenant, v_num, public.fecha_negocio(), 'Reversión — ' || coalesce(v_desc, 'Factura ' || p_numero),
          'facturacion_reversion', 'facturacion:' || p_numero, p_email)
  returning id into v_id;
  insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
  select p_tenant, v_id, l.cuenta_id, l.tercero, l.descripcion, l.haber, l.debe
    from public.asiento_lineas l where l.asiento_id = p_vigente order by l.id;
  if not found then
    raise exception 'FIN_FACTURACION_EN_MANTENIMIENTO: el asiento vigente % no tiene líneas; revisa el libro diario.', p_vigente using errcode = 'F4440';
  end if;
  return v_id;
end $$;

-- ── 10. RPC: consultar (aviso previo a emitir) ────────────────────────────
create function public.consultar_factura_fuera_libros(p_numero text, p_actor uuid, p_tenant text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare u public.usuarios; v_tenant text; v_foto jsonb; v_cfg record;
begin
  u := f208_priv.actor(p_actor, array['superadmin','gerencia','administracion']);
  select tenant into v_tenant from public.ventas where numero_contrato = p_numero;
  if v_tenant is null then
    raise exception 'FIN_CONTRATO_INEXISTENTE: el contrato % no existe.', p_numero using errcode = 'F4404';
  end if;
  perform f208_priv.exigir_agencia(u, p_tenant, v_tenant);
  v_foto := f208_priv.fotografia_fuera_libros(p_numero);
  select * into v_cfg from public.contrato_facturacion where numero_contrato = p_numero;
  return jsonb_build_object(
    'fotografia', v_foto,
    'hash', f208_priv.hash_fotografia(v_foto),
    'requiere_revision', jsonb_array_length(v_foto -> 'abonos') > 0,
    'pendientes', (select coalesce(jsonb_agg((x ->> 'id')::bigint), '[]') from jsonb_array_elements(v_foto -> 'abonos') x
                    where (x ->> 'pendiente_contabilizar')::boolean),
    'factura_vigente', f208_priv.factura_vigente_id(p_numero) is not null,
    'dian_emitida', coalesce(v_cfg.dian_emitida, false),
    'revision_id', v_cfg.revision_id);
end $$;

-- ── 11. RPC: facturar (emitir / re-emitir) ────────────────────────────────
create function public.facturar_factura(
  p_numero text, p_actor uuid, p_tenant text,
  p_pvp numeric, p_irt numeric, p_ingreso_exento numeric,
  p_tipo_exento text default null, p_observacion text default null,
  p_hash_revision text default null, p_nota_revision text default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  u public.usuarios;
  v_tenant text;
  imp record;
  v_cfg public.contrato_facturacion;
  v_vigente bigint;
  v_irt numeric; v_pvp numeric; v_propio numeric; v_exento numeric; v_tipo text; v_obs text;
  v_foto jsonb; v_hash text; v_fuera boolean;
  v_anticipo numeric; v_aplicado_vig numeric; v_aplicar numeric;
  v_rev bigint; v_asiento bigint; v_num bigint; v_revision bigint;
  v_cfg_json jsonb;
  v_otra text;
begin
  u := f208_priv.actor(p_actor, array['superadmin','gerencia','administracion']);
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  v_tenant := f208_priv.bloquear_venta(p_numero, 'update');                           -- L1
  perform f208_priv.exigir_agencia(u, p_tenant, v_tenant);

  select * into imp from f208_priv.importes_factura(p_numero);
  v_pvp := round(imp.pvp, 2);
  v_irt := round(imp.irt, 2);
  if abs(coalesce(p_pvp, 0) - imp.pvp) > 0.5 or abs(coalesce(p_irt, 0) - imp.irt) > 0.5 then
    raise exception 'FIN_IMPORTES_DESACTUALIZADOS: el total o el IRT de proveedores del contrato no coinciden con los del sistema; recarga la página y vuelve a guardar.' using errcode = 'F4410';
  end if;
  if v_irt > v_pvp + 0.5 then
    raise exception 'FIN_IRT_SUPERA_TOTAL: el IRT de proveedores supera el total del contrato; revisa las cuentas por pagar marcadas IRT.' using errcode = 'F4411';
  end if;
  v_irt := least(v_irt, v_pvp);
  select a.tenant into v_otra from public.asientos_contables a
   where a.referencia = 'facturacion:' || p_numero and a.tenant <> v_tenant
   group by a.tenant
  having count(*) filter (where a.origen = 'facturacion') > count(*) filter (where a.origen = 'facturacion_reversion')
   limit 1;
  if v_otra is not null then
    raise exception 'FIN_FACTURA_EN_OTRA_AGENCIA: el contrato % tiene un asiento de factura vigente en la agencia %; corrígelo en el libro diario antes de continuar.', p_numero, v_otra using errcode = 'F4412';
  end if;

  v_propio := greatest(v_pvp - v_irt, 0);
  v_exento := least(greatest(coalesce(p_ingreso_exento, 0), 0), v_propio);
  v_tipo := case when v_exento > 0 then coalesce(nullif(p_tipo_exento, ''), 'exento') end;
  v_obs := nullif(btrim(coalesce(p_observacion, '')), '');
  v_cfg_json := jsonb_build_object('irt', v_irt, 'ingreso_propio', v_propio, 'ingreso_exento', v_exento, 'tipo_exento', v_tipo, 'observacion', v_obs);

  select * into v_cfg from public.contrato_facturacion where numero_contrato = p_numero for update;
  v_vigente := f208_priv.factura_vigente_id(p_numero);

  -- Abonos fuera de libros (se leen con la venta bloqueada; los abonos, en FOR SHARE).
  perform 1 from public.abonos where numero_contrato = p_numero for share;
  v_foto := f208_priv.fotografia_fuera_libros(p_numero);
  v_hash := f208_priv.hash_fotografia(v_foto);
  v_fuera := jsonb_array_length(v_foto -> 'abonos') > 0;
  if exists (select 1 from jsonb_array_elements(v_foto -> 'abonos') x where (x ->> 'pendiente_contabilizar')::boolean) then
    raise exception 'FIN_ABONO_PENDIENTE_CONTABILIZAR: hay abonos recientes de % sin asiento; contabilízalos antes de facturar.', p_numero using errcode = 'F4420';
  end if;

  -- Anticipo neto (280505) del contrato, sin contar lo que ya aplica la factura vigente.
  select coalesce(sum(l.haber - l.debe), 0) into v_anticipo
    from public.asiento_lineas l
   where l.tenant = v_tenant and l.tercero = p_numero and l.cuenta_id = f208_priv.puc_id(v_tenant, '280505');
  select coalesce(sum(l.debe), 0) into v_aplicado_vig
    from public.asiento_lineas l
   where v_vigente is not null and l.asiento_id = v_vigente and l.cuenta_id = f208_priv.puc_id(v_tenant, '280505');
  v_anticipo := greatest(v_anticipo + v_aplicado_vig, 0);
  v_aplicar := least(v_anticipo, v_pvp);

  -- Idempotencia: misma configuración, misma factura vigente, mismo anticipo
  -- aplicado y (si hay abonos fuera de libros) la misma revisión → sin cambios.
  if v_cfg.numero_contrato is not null and v_vigente is not null and v_cfg.asiento_factura_id = v_vigente
     and jsonb_build_object('irt', v_cfg.irt, 'ingreso_propio', v_cfg.ingreso_propio, 'ingreso_exento', v_cfg.ingreso_exento,
                            'tipo_exento', v_cfg.tipo_exento, 'observacion', v_cfg.observacion) = v_cfg_json
     and v_aplicado_vig = v_aplicar
     and (not v_fuera or (v_cfg.revision_id is not null and
          (select r.hash from public.factura_revision_fuera_libros r where r.id = v_cfg.revision_id) = v_hash)) then
    return jsonb_build_object('estado', 'sin_cambios', 'asiento_id', v_vigente, 'revision_id', v_cfg.revision_id);
  end if;

  if coalesce(v_cfg.dian_emitida, false) then
    raise exception 'FIN_DIAN_INMUTABLE: la factura de % ya está emitida a la DIAN; no se cambia.', p_numero using errcode = 'F4434';
  end if;
  if v_fuera then
    if p_hash_revision is null then
      raise exception 'FIN_REVISION_REQUERIDA: el contrato % tiene abonos fuera de libros; revisa el aviso y confirma para emitir.', p_numero using errcode = 'F4431';
    end if;
    if p_hash_revision <> v_hash then
      raise exception 'FIN_REVISION_DESACTUALIZADA: los abonos de % cambiaron desde que se revisó el aviso; vuelve a revisarlo.', p_numero using errcode = 'F4430';
    end if;
  end if;

  perform pg_catalog.set_config('app.factura_rpc', p_numero, true);

  if v_vigente is not null then
    v_rev := f208_priv.reversar(v_vigente, v_tenant, p_numero, u.email);
  end if;

  if v_pvp > 0 then
    v_num := public._siguiente_numero_asiento(v_tenant);                              -- L2
    insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
    values (v_tenant, v_num, public.fecha_negocio(), 'Factura ' || p_numero, 'facturacion', 'facturacion:' || p_numero, u.email)
    returning id into v_asiento;
    insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
    select v_tenant, v_asiento, f208_priv.puc_id(v_tenant, x.cuenta), p_numero, x.descr, x.debe, x.haber
      from (values
        (1, '130505', 'Reconocimiento de factura', v_pvp, 0::numeric),
        (2, '281510', 'Ingreso recibido para terceros', 0::numeric, v_irt),
        (3, '413505', 'Ingreso propio (intermediación)', 0::numeric, v_propio),
        (4, '280505', 'Aplicación de anticipo', v_aplicar, 0::numeric),
        (5, '130505', 'Aplicación de anticipo', 0::numeric, v_aplicar)) as x(orden, cuenta, descr, debe, haber)
     where x.debe > 0 or x.haber > 0
     order by x.orden;
  end if;

  if v_fuera then
    insert into public.factura_revision_fuera_libros
      (evento, numero_contrato, tenant, asiento_factura_id, asiento_reversion_id, fotografia, hash, config_factura,
       actor, actor_email, actor_rol, nota)
    values ('revision_emitida', p_numero, v_tenant, v_asiento, v_rev, v_foto, v_hash, v_cfg_json,
            u.id, u.email, u.rol::text, nullif(btrim(coalesce(p_nota_revision, '')), ''))
    returning id into v_revision;
  end if;

  if v_cfg.numero_contrato is null then
    insert into public.contrato_facturacion (numero_contrato, irt, ingreso_propio, ingreso_exento, tipo_exento, observacion,
                                             asiento_factura_id, revision_id, updated_at)
    values (p_numero, v_irt, v_propio, v_exento, v_tipo, v_obs, v_asiento, v_revision, now());
  else
    update public.contrato_facturacion
       set irt = v_irt, ingreso_propio = v_propio, ingreso_exento = v_exento, tipo_exento = v_tipo, observacion = v_obs,
           asiento_factura_id = v_asiento, revision_id = v_revision, updated_at = now()
     where numero_contrato = p_numero;
  end if;

  perform pg_catalog.set_config('app.factura_rpc', '', true);
  return jsonb_build_object('estado', 'emitida', 'asiento_id', v_asiento, 'reversion_id', v_rev, 'revision_id', v_revision);
end $$;

-- ── 12. RPC: quitar ───────────────────────────────────────────────────────
create function public.quitar_factura(p_numero text, p_actor uuid, p_tenant text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  u public.usuarios;
  v_tenant text;
  v_cfg public.contrato_facturacion;
  v_vigente bigint;
  v_rev bigint;
  v_foto jsonb;
begin
  u := f208_priv.actor(p_actor, array['superadmin','gerencia','administracion']);
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  v_tenant := f208_priv.bloquear_venta(p_numero, 'update');
  perform f208_priv.exigir_agencia(u, p_tenant, v_tenant);
  select * into v_cfg from public.contrato_facturacion where numero_contrato = p_numero for update;
  v_vigente := f208_priv.factura_vigente_id(p_numero);
  if coalesce(v_cfg.dian_emitida, false) then
    raise exception 'FIN_DIAN_INMUTABLE: la factura de % ya está emitida a la DIAN; no se quita.', p_numero using errcode = 'F4434';
  end if;
  if v_cfg.numero_contrato is null and v_vigente is null then
    raise exception 'FIN_SIN_FACTURA_VIGENTE: % no tiene factura vigente que retirar.', p_numero using errcode = 'F4438';
  end if;

  perform pg_catalog.set_config('app.factura_rpc', p_numero, true);
  if v_vigente is not null then
    v_rev := f208_priv.reversar(v_vigente, v_tenant, p_numero, u.email);
  end if;
  if v_cfg.revision_id is not null then
    v_foto := f208_priv.fotografia_fuera_libros(p_numero);
    insert into public.factura_revision_fuera_libros
      (evento, revision_id, numero_contrato, tenant, asiento_factura_id, asiento_reversion_id, fotografia, hash, config_factura,
       actor, actor_email, actor_rol)
    values ('factura_retirada', v_cfg.revision_id, p_numero, v_tenant, v_vigente, v_rev, v_foto, f208_priv.hash_fotografia(v_foto),
            null, u.id, u.email, u.rol::text);
  end if;
  delete from public.contrato_facturacion where numero_contrato = p_numero;
  perform pg_catalog.set_config('app.factura_rpc', '', true);
  return jsonb_build_object('estado', 'retirada', 'reversion_id', v_rev);
end $$;

-- ── 13. RPC: marcar DIAN (solo false → true, solo factura vigente) ────────
create function public.marcar_dian_factura(p_numero text, p_actor uuid, p_tenant text, p_emitida boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare u public.usuarios; v_tenant text; v_cfg public.contrato_facturacion;
begin
  u := f208_priv.actor(p_actor, array['superadmin','gerencia','administracion']);
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  v_tenant := f208_priv.bloquear_venta(p_numero, 'update');
  perform f208_priv.exigir_agencia(u, p_tenant, v_tenant);
  select * into v_cfg from public.contrato_facturacion where numero_contrato = p_numero for update;
  if not coalesce(p_emitida, false) then
    if coalesce(v_cfg.dian_emitida, false) then
      raise exception 'FIN_DIAN_INMUTABLE: la factura de % ya está emitida a la DIAN; la marca no se deshace.', p_numero using errcode = 'F4434';
    end if;
    return jsonb_build_object('estado', 'sin_cambios');
  end if;
  if v_cfg.numero_contrato is null or f208_priv.factura_vigente_id(p_numero) is null then
    raise exception 'FIN_DIAN_SIN_FACTURA: % no tiene factura vigente; no se marca a la DIAN.', p_numero using errcode = 'F4435';
  end if;
  if v_cfg.dian_emitida then
    return jsonb_build_object('estado', 'sin_cambios');
  end if;
  update public.contrato_facturacion set dian_emitida = true, dian_fecha = public.fecha_negocio(), updated_at = now()
   where numero_contrato = p_numero;
  return jsonb_build_object('estado', 'marcada');
end $$;

-- ── 14. RPC: posteo atómico del asiento de un abono (M1) ──────────────────
create function public.postear_asiento_abono(p_abono_id bigint, p_tenant text, p_actor uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  u public.usuarios;
  v_numero text; v_tenant text; v_moneda text;
  b public.abonos;
  v_monto numeric;
  v_ref text := 'abono:' || p_abono_id;
  v_prev record;
  v_credito text; v_debito text;
  v_num bigint; v_id bigint;
begin
  u := f208_priv.actor(p_actor, array['superadmin','gerencia','administracion','operaciones']);
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  select numero_contrato into v_numero from public.abonos where id = p_abono_id;
  if v_numero is null then
    raise exception 'FIN_ABONO_INEXISTENTE: el abono % ya no existe; no se registró asiento.', p_abono_id using errcode = 'F4405';
  end if;
  v_tenant := f208_priv.bloquear_venta(v_numero, 'key_share');                       -- venta viva
  perform f208_priv.exigir_agencia(u, p_tenant, v_tenant, array['superadmin','gerencia']);
  select * into b from public.abonos where id = p_abono_id for update;                  -- abono vivo
  if b.id is null or b.numero_contrato <> v_numero then
    raise exception 'FIN_ABONO_INEXISTENTE: el abono % ya no existe; no se registró asiento.', p_abono_id using errcode = 'F4405';
  end if;
  if b.contabilizable is false then
    raise exception 'FIN_ABONO_NO_CONTABILIZABLE: el abono % lo registró el servidor (importación o pago previo); no lleva asiento propio.', p_abono_id using errcode = 'F4426';
  end if;
  select coalesce(moneda, 'COP') into v_moneda from public.ventas where numero_contrato = v_numero;
  v_monto := coalesce(b.monto_cop, case when v_moneda = 'COP' then b.valor_abono end);
  if v_monto is null then
    raise exception 'FIN_ABONO_NO_CONTABILIZABLE: el abono % no tiene valor en pesos.', p_abono_id using errcode = 'F4426';
  end if;

  select a.id,
         (select p.codigo from public.asiento_lineas l join public.puc_cuentas p on p.id = l.cuenta_id
           where l.asiento_id = a.id and l.haber > 0 order by l.id limit 1) as credito,
         (select p.codigo from public.asiento_lineas l join public.puc_cuentas p on p.id = l.cuenta_id
           where l.asiento_id = a.id and l.debe > 0 order by l.id limit 1) as debito,
         (select coalesce(sum(l.debe), 0) from public.asiento_lineas l where l.asiento_id = a.id) as total,
         a.fecha
    into v_prev
    from public.asientos_contables a
   where a.tenant = v_tenant and a.origen = 'abono' and a.referencia = v_ref
   order by a.id desc limit 1;

  v_debito := public._cuenta_disponible(b.forma_pago, v_moneda);
  if v_prev.id is not null and v_prev.credito in ('280505', '130505') then
    v_credito := v_prev.credito;                       -- conserva la cuenta con que nació
  else
    v_credito := case when f208_priv.factura_vigente_id(v_numero) is not null then '130505' else '280505' end;
  end if;
  if v_prev.id is not null and v_prev.credito = '280505' and v_prev.total <> v_monto
     and f208_priv.factura_vigente_id(v_numero) is not null then
    raise exception 'FIN_ANTICIPO_APLICADO: la factura vigente de % ya aplicó este anticipo; quita la factura antes de cambiar el valor del abono.', v_numero using errcode = 'F4418';
  end if;
  if v_prev.id is not null and v_prev.total = v_monto and v_prev.debito = v_debito and v_prev.fecha = b.fecha_abono then
    return jsonb_build_object('estado', 'sin_cambios', 'asiento_id', v_prev.id);
  end if;

  perform pg_catalog.set_config('app.posteo_abono', v_ref, true);
  delete from public.asientos_contables where tenant = v_tenant and origen = 'abono' and referencia = v_ref;
  if v_monto > 0 then
    v_num := public._siguiente_numero_asiento(v_tenant);
    insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
    values (v_tenant, v_num, b.fecha_abono, 'Abono ' || v_numero || coalesce(' (' || b.forma_pago || ')', ''), 'abono', v_ref, u.email)
    returning id into v_id;
    insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber) values
      (v_tenant, v_id, f208_priv.puc_id(v_tenant, v_debito), v_numero, 'Abono recibido', v_monto, 0),
      (v_tenant, v_id, f208_priv.puc_id(v_tenant, v_credito), v_numero,
       case when v_credito = '130505' then 'Aplicación a cartera' else 'Anticipo de cliente' end, 0, v_monto);
  end if;
  perform pg_catalog.set_config('app.posteo_abono', '', true);
  return jsonb_build_object('estado', case when v_id is null then 'sin_asiento' else 'contabilizado' end, 'asiento_id', v_id);
end $$;

-- ── 15. Consulta de discrepancias (contable; filtro explícito) ────────────
create function public.f208_discrepancias_fuera_libros()
returns table (numero_contrato text, tenant text, tipo text, revision_id bigint, hash text, total_sin_respaldo_cop numeric,
               actor_email text, registrado_en timestamptz)
language sql stable security definer set search_path = '' as $$
  with acceso as (
    select auth.uid() is not null and public.mi_rol()::text in ('superadmin', 'gerencia', 'administracion') as ok,
           public.mi_rol()::text = 'superadmin' as global, public.mi_tenant() as t
  )
  select r.numero_contrato, r.tenant, r.evento, r.id, r.hash,
         (r.fotografia ->> 'total_sin_respaldo_cop')::numeric, r.actor_email, r.registrado_en
    from public.factura_revision_fuera_libros r, acceso a
   where a.ok and (a.global or r.tenant = a.t)
  union all
  select c.numero_contrato, v.tenant, 'factura_sin_revision', null, null,
         (f208_priv.fotografia_fuera_libros(c.numero_contrato) ->> 'total_sin_respaldo_cop')::numeric, null, c.updated_at
    from public.contrato_facturacion c join public.ventas v on v.numero_contrato = c.numero_contrato, acceso a
   where a.ok and (a.global or v.tenant = a.t)
     and c.revision_id is null
     and jsonb_array_length(f208_priv.fotografia_fuera_libros(c.numero_contrato) -> 'abonos') > 0
$$;

-- ── 16. Permisos ──────────────────────────────────────────────────────────
-- Helpers privilegiados: solo los roles cuyas escrituras pasan por las guardas.
revoke all on all functions in schema f208_priv from public, anon, authenticated, service_role;
revoke all on all tables in schema f208_priv from public, anon, authenticated;
grant select on f208_priv.corte to service_role;
grant execute on function
  f208_priv.exigir_acceso(text, text[]), f208_priv.bloquear_venta(text, text), f208_priv.factura_vigente_id(text),
  f208_priv.dian_emitida(text), f208_priv.clase_asiento(bigint), f208_priv.historia_factura(text),
  f208_priv.es_rpc_factura(text), f208_priv.es_rpc_abono(text), f208_priv.hash_fotografia(jsonb), f208_priv.abono_tiene_asiento(bigint)
  to authenticated, service_role;
grant execute on function
  f208_priv.puc_id(text, text), f208_priv.asiento_de_abono(bigint, text), f208_priv.fotografia_fuera_libros(text),
  f208_priv.actor(uuid, text[]), f208_priv.exigir_agencia(public.usuarios, text, text, text[]),
  f208_priv.importes_factura(text), f208_priv.reversar(bigint, text, text, text)
  to service_role;

revoke all on function public.consultar_factura_fuera_libros(text, uuid, text) from public, anon, authenticated;
revoke all on function public.facturar_factura(text, uuid, text, numeric, numeric, numeric, text, text, text, text) from public, anon, authenticated;
revoke all on function public.quitar_factura(text, uuid, text) from public, anon, authenticated;
revoke all on function public.marcar_dian_factura(text, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.postear_asiento_abono(bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.consultar_factura_fuera_libros(text, uuid, text) to service_role;
grant execute on function public.facturar_factura(text, uuid, text, numeric, numeric, numeric, text, text, text, text) to service_role;
grant execute on function public.quitar_factura(text, uuid, text) to service_role;
grant execute on function public.marcar_dian_factura(text, uuid, text, boolean) to service_role;
grant execute on function public.postear_asiento_abono(bigint, text, uuid) to service_role;

revoke all on function public.f208_discrepancias_fuera_libros() from public, anon;
grant execute on function public.f208_discrepancias_fuera_libros() to authenticated;

-- Funciones de disparador: no se invocan por la API.
revoke all on function public.f208_abonos_marca(), public.f208_abonos_borrar(), public.f208_constancia_guarda(), public.f208_truncate_prohibido(),
  public.f208_cf_bloquear(), public.f208_cf_validar(), public.f208_cf_borrar(), public.f208_asiento_guarda(),
  public.f208_linea_guarda(), public.f208_ventas_protector() from public, anon, authenticated;

-- anon no toca la configuración de facturación (no tiene policy; así recibe
-- 42501 en vez de entrar a las guardas). TRUNCATE fuera para todos los roles
-- de la API en las tablas que sostienen la historia contable.
revoke all on public.contrato_facturacion from anon;
revoke truncate on public.ventas, public.abonos, public.contrato_facturacion, public.asientos_contables, public.asiento_lineas
  from anon, authenticated, service_role;

comment on table public.factura_revision_fuera_libros is
  '208: constancias append-only de revisión de abonos fuera de libros al emitir/retirar una factura. Solo la escribe la RPC facturar_factura/quitar_factura.';
comment on schema f208_priv is '208: helpers privilegiados de la facturación transaccional. No exponer en PostgREST.';
