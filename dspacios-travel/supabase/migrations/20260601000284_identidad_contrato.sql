-- ============================================================================
-- 284 — Identidad interna del contrato y guardas de escritura (#75, entrega 1)
-- ============================================================================
-- POR QUÉ: la entrega 3 de #75 permite reutilizar el consecutivo DTM de un contrato pendiente, nunca confirmado y vacío. Una pantalla abierta sobre el
-- contrato ANTERIOR (Ana) seguiría apuntando al mismo número cuando ese número pertenezca a otro contrato (Carlos). El dueño NO autorizó que esa
-- pantalla escriba sobre el contrato nuevo. El número es una etiqueta visible; la IDENTIDAD del contrato es `ventas.contrato_uid`.
--
-- QUÉ HACE (todo inerte mientras ningún contrato haya nacido de un número reutilizado: hoy `nacio_de_reuso` es false en TODAS las filas y la 284 NO
-- puede activarlo — lo hará la entrega 3 y, aun entonces, solo con el reuso habilitado por decisión del dueño):
--   1. `ventas.contrato_uid` (uuid, único, inmutable; se conserva al renumerar porque fn_renumerar_contrato copia la fila completa) y
--      `ventas.nacio_de_reuso` (inmutable).
--   2. Una petición DECLARA qué contrato abrió con la cabecera HTTP `x-contratos` = JSON {"<numero>": "<uid>", ...} (PostgREST la expone a triggers
--      y funciones como `request.headers`, en la MISMA transacción). Las tareas automáticas SIN pantalla declaran lo que LEYERON bajo bloqueo con
--      `contrato_declarar_identidad()` (GUC `app.identidades`); NO hay excepción por rol: service_role también declara.
--   3. Guarda genérica `contrato_guarda_identidad()` (BEFORE INSERT/UPDATE/DELETE, por fila) en TODA tabla con `numero_contrato`/`contrato_numero`
--      y en seis tablas que cuelgan por id; modos por tabla en `contrato_guardas_config` (estricto | vinculo | estado_personal | desajuste | excluida).
--      · identidad declarada que NO es la del contrato vigente → CONTRATO_CAMBIO (SQLSTATE F4601), siempre;
--      · identidad AUSENTE sobre un contrato nacido de reuso → IDENTIDAD_REQUERIDA (F4602), salvo modo `desajuste`;
--      · contrato de siempre sin identidad → pasa exactamente como hoy.
--   4. `contratos_identidades(text[])`: la pantalla lee el uid al cargar (respeta puede_ver_contrato).
--
-- QUÉ NO HACE: no cambia ninguna función existente (eso es la 285), no toca Storage (285), no crea el pool ni el reuso (286), no toca la 281 ni la 283.
-- NO se reescribe ventas_basica: el uid se lee con contratos_identidades() (misma regla de acceso, sin duplicar la definición de la vista).
--
-- LOCKS: la verificación toma `FOR KEY SHARE` sobre la fila de `ventas` (el MISMO bloqueo que la FK ya toma al insertar un hijo; solo choca con un
-- DELETE o un cambio de clave de esa fila). Dos intentos (instantánea nueva) cierran la carrera «el contrato se borró y renació con el mismo número».
--
-- FALLA CERRADO: si alguna tabla con numero_contrato/contrato_numero (o FK hacia ventas) no está clasificada en contrato_guardas_config, esta
-- migración ABORTA nombrándola; el postcheck vuelve a comprobarlo después de cada migración que cree tablas de contrato.
-- Rollback: supabase/scripts/rollback_284_identidad_contrato.sql
-- ============================================================================
begin;

-- 1) Identidad ---------------------------------------------------------------
alter table public.ventas
  add column if not exists contrato_uid uuid not null default gen_random_uuid(),
  add column if not exists nacio_de_reuso boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ventas_contrato_uid_uq' and conrelid = 'public.ventas'::regclass) then
    -- DEFERRABLE INITIALLY DEFERRED: fn_renumerar_contrato copia la fila (mismo uid) y borra la vieja en la misma transacción.
    -- Límite conocido: un INSERT … ON CONFLICT DO NOTHING SIN objetivo no admite restricciones diferibles; el repo usa siempre objetivo explícito.
    alter table public.ventas add constraint ventas_contrato_uid_uq unique (contrato_uid) deferrable initially deferred;
  end if;
end $$;

create or replace function public.fn_ventas_identidad_inmutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.contrato_uid is distinct from old.contrato_uid or new.nacio_de_reuso is distinct from old.nacio_de_reuso then
    raise exception 'IDENTIDAD_INMUTABLE: la identidad del contrato % no se puede modificar.', old.numero_contrato using errcode = 'F4603';
  end if;
  return new;
end $$;
drop trigger if exists trg_ventas_identidad_inmutable on public.ventas;
create trigger trg_ventas_identidad_inmutable before update of contrato_uid, nacio_de_reuso on public.ventas
  for each row execute function public.fn_ventas_identidad_inmutable();

-- 1b) Quien CREA un contrato conoce su identidad (entrega 3): un INSERT en `ventas` deja el par (número, uid) declarado SOLO dentro de esa transacción
-- (set_config local; un rollback de subtransacción también lo deshace). Así las funciones SQL que crean el contrato y escriben sus hijas en la misma
-- transacción (convertir_cotizacion_*, paquetes, programas) no necesitan declarar nada ni se rechazan cuando el número nació de un reuso. Una pantalla
-- antigua nunca comparte transacción con la creación, por lo que no se beneficia: su petición llega por otra transacción y sigue exigiendo su uid.
create or replace function public.fn_ventas_autodeclara_creacion() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform set_config('app.identidades',
    (coalesce(nullif(current_setting('app.identidades', true), '')::jsonb, '{}'::jsonb) || jsonb_build_object(new.numero_contrato, new.contrato_uid))::text, true);
  return null;
end $$;
revoke all on function public.fn_ventas_autodeclara_creacion() from public, anon, authenticated;
drop trigger if exists trg_ventas_autodeclara_creacion on public.ventas;
create trigger trg_ventas_autodeclara_creacion after insert on public.ventas
  for each row execute function public.fn_ventas_autodeclara_creacion();

-- 2) Declaración de identidades ---------------------------------------------
create or replace function public.contrato_ident_cabecera(p_numero text) returns uuid
language plpgsql stable set search_path = pg_catalog, public as $$
begin
  return (nullif(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-contratos', '')::jsonb ->> p_numero)::uuid;
exception when others then
  return null;
end $$;

create or replace function public.contrato_ident_interna(p_numero text) returns uuid
language plpgsql stable set search_path = pg_catalog, public as $$
begin
  return (nullif(current_setting('app.identidades', true), '')::jsonb ->> p_numero)::uuid;
exception when others then
  return null;
end $$;

-- SOLO para funciones SECURITY DEFINER de confianza que ELIGEN el contrato por estado bajo bloqueo (tareas automáticas). Una función que recibe el
-- número/ID desde una pantalla NO la usa: debe verificar la identidad que trae la petición.
create or replace function public.contrato_declarar_identidad(p_numero text, p_uid uuid) returns void
language plpgsql set search_path = pg_catalog, public as $$
begin
  perform set_config('app.identidades',
    (coalesce(nullif(current_setting('app.identidades', true), '')::jsonb, '{}'::jsonb) || jsonb_build_object(p_numero, p_uid))::text, true);
end $$;
revoke all on function public.contrato_declarar_identidad(text, uuid) from public, anon, authenticated, service_role;

create or replace function public.contrato_verificar_identidad(p_numero text, p_estricto boolean default true) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid; v_reuso boolean; d_int uuid; d_hdr uuid; i int;
begin
  if p_numero is null then return; end if;
  for i in 1..2 loop   -- dos sentencias = dos instantáneas: ver el contrato que otra transacción creó tras borrar el anterior
    select v.contrato_uid, v.nacio_de_reuso into v_uid, v_reuso from public.ventas v where v.numero_contrato = p_numero for key share;
    exit when found;
  end loop;
  d_int := public.contrato_ident_interna(p_numero);
  d_hdr := public.contrato_ident_cabecera(p_numero);
  if v_uid is null then
    if d_int is not null or d_hdr is not null then
      raise exception 'CONTRATO_CAMBIO: el contrato que abriste con el número % ya no existe. No se cambió nada.', p_numero using errcode = 'F4601';
    end if;
    return;
  end if;
  if (d_int is not null and d_int <> v_uid) or (d_hdr is not null and d_hdr <> v_uid) then
    raise exception 'CONTRATO_CAMBIO: el contrato que abriste con el número % ya no es el vigente (otra persona lo eliminó o lo reemplazó). No se cambió nada.', p_numero using errcode = 'F4601';
  end if;
  if d_int is null and d_hdr is null and v_reuso and p_estricto then
    raise exception 'IDENTIDAD_REQUERIDA: el contrato % nació de un número reutilizado y esta operación no indicó qué contrato abrió. Recarga la página.', p_numero using errcode = 'F4602';
  end if;
end $$;
revoke all on function public.contrato_verificar_identidad(text, boolean) from public, anon, authenticated;

-- 3) Configuración de guardas ------------------------------------------------
create table if not exists public.contrato_guardas_config (
  tabla     text primary key,
  modo      text not null check (modo in ('estricto','vinculo','estado_personal','desajuste','excluida')),
  resolvedor text,              -- expresión SQL ($1 = fila como jsonb) que devuelve el número de contrato; null = columna numero_contrato/contrato_numero
  columnas_exentas text[],      -- solo modo estado_personal: un UPDATE que cambie ÚNICAMENTE estas columnas no cuenta como escribir el contrato
  motivo    text not null
);
alter table public.contrato_guardas_config enable row level security;   -- sin policies: solo funciones de confianza y el dueño de la base
revoke all on public.contrato_guardas_config from anon, authenticated;

insert into public.contrato_guardas_config (tabla, modo, resolvedor, columnas_exentas, motivo) values
  ('ventas', 'estricto', null, null, 'el contrato mismo (INSERT queda libre: lo gobierna el ticket de reserva de la migración del reuso (287))'),
  ('sillas', 'estricto', 'select coalesce($1->>''numero_contrato'', (select r.numero_contrato from public._resolver_contrato_manual($1->>''contrato_manual'') r))', null,
     'la silla se liga a un contrato por número O por referencia manual de texto (misma regla de resolución que el RPC)'),
  ('movimientos_silla', 'desajuste', null, null, 'bitácora solo de inserción: las funciones que la escriben ya están guardadas por sillas; solo se rechaza una identidad declarada que no sea la vigente'),
  ('cotizaciones', 'vinculo', null, null, 'se edita por id de cotización; solo ligar/desligar el número a un contrato exige identidad'),
  ('avisos', 'estado_personal', null, array['notificado_en','leido_en'], 'marcar leído/notificado un aviso PROPIO es estado personal; crear, borrar o recablear un aviso vinculado a un contrato es evidencia'),
  ('cxp_pagos', 'estricto', 'select numero_contrato from public.cuentas_por_pagar where id = ($1->>''cuenta_por_pagar_id'')::bigint', null, 'cuelga de cuentas_por_pagar'),
  ('retenciones_cxp', 'estricto', 'select numero_contrato from public.cuentas_por_pagar where id = ($1->>''cuenta_por_pagar_id'')::bigint', null, 'cuelga de cuentas_por_pagar'),
  ('comision_b2b_pagos', 'estricto', 'select numero_contrato from public.aliados_b2b where id = ($1->>''aliado_b2b_id'')::bigint', null, 'cuelga de aliados_b2b'),
  ('comision_b2b_revision', 'estricto', 'select numero_contrato from public.aliados_b2b where id = ($1->>''aliado_b2b_id'')::bigint', null, 'cuelga de aliados_b2b'),
  ('factura_items', 'estricto', 'select numero_contrato from public.facturacion where id = ($1->>''factura_id'')::bigint', null, 'cuelga de facturacion'),
  ('_pasajeros_exentos_167', 'estricto', 'select numero_contrato from public.contrato_pasajeros where id = ($1->>''pasajero_id'')::bigint', null, 'cuelga de contrato_pasajeros')
on conflict (tabla) do nothing;

-- Resto de tablas con numero_contrato / contrato_numero: modo estricto, clasificadas de forma EXPLÍCITA (una tabla nueva sin clasificar aborta el instalador).
insert into public.contrato_guardas_config (tabla, modo, motivo)
select t, 'estricto', 'escribe datos del contrato por número'
  from unnest(array[
    'abono_operaciones','abonos','abonos_anulados','aliados_b2b','conciliacion_sistema','contrato_adjuntos','contrato_alojamiento_bernalo','contrato_condiciones',
    'contrato_facturacion','contrato_financiero_pendiente','contrato_hoteles','contrato_items','contrato_pasajeros','contrato_programa_estancia',
    'contrato_programa_estancia_costo','contrato_servicios','contrato_soportes_pago','contrato_vuelo_control','contrato_vuelo_control_cambios','contrato_vuelos',
    'cuentas_por_pagar','cuotas','factura_revision_fuera_libros','facturacion','liquidacion_comisiones','liquidacion_descuentos','p63_aceptacion',
    'persona_capturas','rentabilidad','restriccion_overrides','vouchers']) as t
on conflict (tabla) do nothing;

-- 4) Instalador (idempotente; aborta si hay tablas sin clasificar) -----------
create or replace function public.contrato_instalar_guardas() returns text
language plpgsql set search_path = public, pg_temp as $$
declare r record; n int := 0; sin text[] := '{}';
begin
  -- tablas de contrato = columna numero_contrato/contrato_numero o FK hacia ventas
  for r in
    select distinct c.relname::text as tabla
      from pg_class c join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
     where c.relkind in ('r','p') and (
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attname in ('numero_contrato','contrato_numero'))
        or exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'public.ventas'::regclass)
        or c.relname = 'ventas')
       and not exists (select 1 from public.contrato_guardas_config g where g.tabla = c.relname::text)
  loop
    sin := sin || r.tabla;
  end loop;
  if cardinality(sin) > 0 then
    raise exception 'GUARDA_SIN_CLASIFICAR: tablas de contrato sin fila en contrato_guardas_config: %. Clasifícalas (estricto/vinculo/estado_personal/desajuste/excluida) antes de continuar.', array_to_string(sin, ', ');
  end if;
  for r in select g.* from public.contrato_guardas_config g where to_regclass('public.' || quote_ident(g.tabla)) is not null loop
    execute format('drop trigger if exists trg_contrato_guarda on public.%I', r.tabla);
    if r.modo = 'excluida' then continue; end if;
    if r.tabla = 'ventas' then
      execute 'create trigger trg_contrato_guarda before update or delete on public.ventas for each row execute function public.contrato_guarda_identidad('''', ''estricto'', '''')';
    else
      execute format('create trigger trg_contrato_guarda before insert or update or delete on public.%I for each row execute function public.contrato_guarda_identidad(%L, %L, %L)',
                     r.tabla, coalesce(r.resolvedor, ''), r.modo, coalesce(array_to_string(r.columnas_exentas, ','), ''));
    end if;
    n := n + 1;
  end loop;
  return format('guardas instaladas: %s', n);
end $$;
revoke all on function public.contrato_instalar_guardas() from public, anon, authenticated, service_role;

-- 5) Guarda genérica ---------------------------------------------------------
-- tg_argv: [0] resolvedor SQL del número ('' = columna numero_contrato o contrato_numero) · [1] modo · [2] columnas exentas (csv, solo estado_personal)
create or replace function public.contrato_guarda_identidad() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  j_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  resolvedor text := nullif(tg_argv[0], '');
  modo text := coalesce(nullif(tg_argv[1], ''), 'estricto');
  exentas text[] := string_to_array(nullif(tg_argv[2], ''), ',');
  estricto boolean := modo in ('estricto','vinculo','estado_personal');
  n_old text; n_new text;
begin
  if modo = 'estado_personal' and tg_op = 'UPDATE' and exentas is not null and (j_old - exentas) = (j_new - exentas) then return new; end if;
  if resolvedor is null then
    n_old := coalesce(j_old->>'numero_contrato', j_old->>'contrato_numero');
    n_new := coalesce(j_new->>'numero_contrato', j_new->>'contrato_numero');
  else
    if j_old is not null then execute resolvedor into n_old using j_old; end if;
    if j_new is not null then execute resolvedor into n_new using j_new; end if;
  end if;
  -- modo vinculo (cotizaciones): editar la fila sin tocar el número no es escribir el contrato; ligar/desligar sí
  if modo = 'vinculo' and tg_op = 'UPDATE' and n_old is not distinct from n_new then return new; end if;

  if tg_op = 'UPDATE' and n_old is distinct from n_new then
    -- Mover una fila entre contratos: se verifican AMBOS. Excepción exacta: RENUMERACIÓN (mismo contrato, misma identidad viva, ambas filas de ventas
    -- coexisten); aun así se verifica el ORIGEN, de lo contrario una pantalla antigua podría renumerar el contrato nuevo.
    if n_old is not null and n_new is not null and exists (
         select 1 from public.ventas a join public.ventas b on b.contrato_uid = a.contrato_uid
          where a.numero_contrato = n_old and b.numero_contrato = n_new) then
      perform public.contrato_verificar_identidad(n_old, estricto);
      return new;
    end if;
    perform public.contrato_verificar_identidad(n_old, estricto);
    perform public.contrato_verificar_identidad(n_new, estricto);
    return new;
  end if;
  if tg_table_name = 'ventas' and tg_op = 'DELETE' and exists (
       select 1 from public.ventas v2 where v2.contrato_uid = (j_old->>'contrato_uid')::uuid and v2.numero_contrato <> n_old) then
    perform public.contrato_verificar_identidad(n_old, estricto);   -- borrado de la fila vieja tras una renumeración
    return old;
  end if;
  perform public.contrato_verificar_identidad(coalesce(n_new, n_old), estricto and modo <> 'desajuste');
  return coalesce(new, old);
end $$;
revoke all on function public.contrato_guarda_identidad() from public, anon, authenticated;

select public.contrato_instalar_guardas();

-- 6) Lectura del uid al cargar la pantalla -----------------------------------
create or replace function public.contratos_identidades(p_numeros text[]) returns table(numero_contrato text, contrato_uid uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.numero_contrato, v.contrato_uid from public.ventas v
   where v.numero_contrato = any (p_numeros) and public.puede_ver_contrato(v.numero_contrato)
$$;
revoke all on function public.contratos_identidades(text[]) from public, anon;
grant execute on function public.contratos_identidades(text[]) to authenticated;

-- 6b) Identidad de las sillas de UN bloqueo (o de todos si p_bloqueo es null), para roles que no leen `ventas` (control_vuelo) --------------------------------------------------
-- control_vuelo no pasa `puede_ver_contrato`: el embed `ventas(contrato_uid)` y `contratos_identidades()` le devuelven vacío y sus escrituras sobre
-- sillas fallarían cerradas. Esta función entrega SOLO (silla, número, uid) —el número ya lo ve en `sillas`— sin columnas financieras, a los roles
-- operativos que leen sillas (no `venta`: sigue por contratos_identidades). La pantalla la llama ANTES de leer las sillas y usa el uid solo si el
-- número de la silla coincide: una identidad leída antes que los datos nunca autoriza una escritura sobre otro contrato.
create or replace function public.sillas_identidades(p_bloqueo bigint default null) returns table(silla_id bigint, numero_contrato text, contrato_uid uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.numero_contrato, v.contrato_uid
    from public.sillas s join public.ventas v on v.numero_contrato = s.numero_contrato
   where (p_bloqueo is null or s.bloqueo_id = p_bloqueo)
     and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','control_vuelo')
$$;
revoke all on function public.sillas_identidades(bigint) from public, anon;
grant execute on function public.sillas_identidades(bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
