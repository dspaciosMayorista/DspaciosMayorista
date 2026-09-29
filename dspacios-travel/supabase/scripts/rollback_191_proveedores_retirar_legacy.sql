-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 191 (retiro de columnas legacy de proveedores).
--
-- Deja public.proveedores como lo dejó la 190:
--   - Vuelven las ocho columnas (al final de la tabla; el orden físico no
--     importa a la app) y se repueblan desde proveedores_datos_sensibles
--     (tenant 'mayorista'), que es la fuente de verdad desde la 189.
--   - guardar_proveedor vuelve al texto de la 190 (escribe las columnas
--     antiguas) y vuelve la sincronización legacy de la 189.
--   - Vuelve la policy "proveedores: lectura transitoria" de la 189.
--
-- ⚠️ Al volver atrás:
--   - Los internos de Minorista (administracion, operaciones, venta,
--     control_vuelo) dejan otra vez de leer el catálogo base. Agencia,
--     freelance y cliente_final siguen sin leerlo, igual que con la 191.
--   - Los valores sensibles vuelven a existir en public.proveedores.
--   - NO se devuelve el TRUNCATE a anon/authenticated: era un permiso por
--     defecto, no una decisión, y TRUNCATE no pasa por RLS.
--   - No se pierden datos: la tabla sensible no se toca.
--
-- Se pega completo en el editor SQL de Supabase. Una sola transacción: si una
-- verificación falla, no cambia nada.
-- ───────────────────────────────────────────────────────────────────────────
begin;

set local lock_timeout = '5s';
lock table public.proveedores in access exclusive mode;
lock table public.proveedores_datos_sensibles in share row exclusive mode;

alter table public.proveedores
  add column nit text,
  add column razon_social text,
  add column datos_pago text,
  add column banco text,
  add column tipo_cuenta text,
  add column numero_cuenta text,
  add column politica_reservas text,
  add column voucher_contacto text;

-- Antes de reponer triggers: este UPDATE no debe generar copias de vuelta.
update public.proveedores p set
  nit = s.nit,
  razon_social = s.razon_social,
  datos_pago = s.datos_pago,
  banco = s.banco,
  tipo_cuenta = s.tipo_cuenta,
  numero_cuenta = s.numero_cuenta,
  politica_reservas = s.politica_reservas,
  voucher_contacto = s.voucher_contacto
from public.proveedores_datos_sensibles s
where s.proveedor_id = p.id and s.tenant = 'mayorista';

-- Texto idéntico al de la migración 189.
create function public.sincronizar_proveedor_sensible_legacy()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.proveedores_datos_sensibles (
    proveedor_id, tenant, nit, razon_social, datos_pago, banco,
    tipo_cuenta, numero_cuenta, politica_reservas, voucher_contacto
  ) values (
    new.id, 'mayorista', new.nit, new.razon_social, new.datos_pago,
    new.banco, new.tipo_cuenta, new.numero_cuenta,
    new.politica_reservas, new.voucher_contacto
  )
  on conflict (proveedor_id, tenant) do update set
    nit = excluded.nit,
    razon_social = excluded.razon_social,
    datos_pago = excluded.datos_pago,
    banco = excluded.banco,
    tipo_cuenta = excluded.tipo_cuenta,
    numero_cuenta = excluded.numero_cuenta,
    politica_reservas = excluded.politica_reservas,
    voucher_contacto = excluded.voucher_contacto;
  return new;
end;
$$;

revoke all on function public.sincronizar_proveedor_sensible_legacy() from public, anon, authenticated;

create trigger proveedores_sensibles_legacy_insert
  after insert on public.proveedores
  for each row execute function public.sincronizar_proveedor_sensible_legacy();

create trigger proveedores_sensibles_legacy_update
  after update of nit, razon_social, datos_pago, banco, tipo_cuenta,
    numero_cuenta, politica_reservas, voucher_contacto on public.proveedores
  for each row execute function public.sincronizar_proveedor_sensible_legacy();

-- Texto idéntico al de la migración 190.
create or replace function public.guardar_proveedor(
  p_proveedor jsonb,
  p_id bigint default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
  v_nombre text := nullif(btrim(p_proveedor->>'nombre'), '');
  v_tipo text := p_proveedor->>'tipo';
  v_clasificacion text := coalesce(p_proveedor->>'clasificacion', 'costo');
begin
  if public.mi_rol() not in ('superadmin', 'gerencia', 'administracion', 'operaciones')
     or public.mi_tenant_real() is distinct from 'mayorista' then
    raise exception 'No autorizado para guardar proveedores' using errcode = '42501';
  end if;
  if v_nombre is null then
    raise exception 'El nombre es obligatorio' using errcode = '22023';
  end if;
  if v_tipo is null or v_tipo not in ('hotelero', 'aereo', 'servicios', 'programa') then
    raise exception 'Tipo de proveedor invalido' using errcode = '22023';
  end if;
  if v_clasificacion not in ('costo', 'irt') then
    raise exception 'Clasificacion de proveedor invalida' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.proveedores (
      tipo, nombre, ciudad, contacto, aplica_retencion, pct_retencion, clasificacion,
      nit, razon_social, banco, tipo_cuenta, numero_cuenta,
      politica_reservas, voucher_contacto
    ) values (
      v_tipo, v_nombre, nullif(btrim(p_proveedor->>'ciudad'), ''),
      nullif(btrim(p_proveedor->>'contacto'), ''),
      coalesce((p_proveedor->>'aplica_retencion')::boolean, false),
      coalesce((p_proveedor->>'pct_retencion')::numeric, 0), v_clasificacion,
      nullif(btrim(p_proveedor->>'nit'), ''),
      nullif(btrim(p_proveedor->>'razon_social'), ''),
      nullif(btrim(p_proveedor->>'banco'), ''),
      nullif(btrim(p_proveedor->>'tipo_cuenta'), ''),
      nullif(btrim(p_proveedor->>'numero_cuenta'), ''),
      nullif(btrim(p_proveedor->>'politica_reservas'), ''),
      nullif(btrim(p_proveedor->>'voucher_contacto'), '')
    ) returning id into v_id;
  else
    update public.proveedores set
      tipo = v_tipo,
      nombre = v_nombre,
      ciudad = nullif(btrim(p_proveedor->>'ciudad'), ''),
      contacto = nullif(btrim(p_proveedor->>'contacto'), ''),
      aplica_retencion = coalesce((p_proveedor->>'aplica_retencion')::boolean, false),
      pct_retencion = coalesce((p_proveedor->>'pct_retencion')::numeric, 0),
      clasificacion = v_clasificacion,
      nit = nullif(btrim(p_proveedor->>'nit'), ''),
      razon_social = nullif(btrim(p_proveedor->>'razon_social'), ''),
      banco = nullif(btrim(p_proveedor->>'banco'), ''),
      tipo_cuenta = nullif(btrim(p_proveedor->>'tipo_cuenta'), ''),
      numero_cuenta = nullif(btrim(p_proveedor->>'numero_cuenta'), ''),
      politica_reservas = nullif(btrim(p_proveedor->>'politica_reservas'), ''),
      voucher_contacto = nullif(btrim(p_proveedor->>'voucher_contacto'), '')
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Proveedor no encontrado o sin permiso' using errcode = '42501';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.guardar_proveedor(jsonb, bigint) from public, anon;
grant execute on function public.guardar_proveedor(jsonb, bigint) to authenticated;

-- Policy de lectura de la 189 (texto idéntico).
drop policy "proveedores: lectura catalogo" on public.proveedores;

create policy "proveedores: lectura transitoria"
  on public.proveedores for select to authenticated
  using (
    public.mi_rol() in ('superadmin', 'gerencia')
    or (
      public.mi_rol() in ('administracion', 'operaciones', 'venta', 'control_vuelo')
      and public.mi_tenant_real() = 'mayorista'
    )
  );

do $$
begin
  if exists (
    select 1
    from public.proveedores p
    left join public.proveedores_datos_sensibles s
      on s.proveedor_id = p.id and s.tenant = 'mayorista'
    where s.proveedor_id is null
       or row(p.nit, p.razon_social, p.datos_pago, p.banco,
              p.tipo_cuenta, p.numero_cuenta, p.politica_reservas,
              p.voucher_contacto)
          is distinct from
          row(s.nit, s.razon_social, s.datos_pago, s.banco,
              s.tipo_cuenta, s.numero_cuenta, s.politica_reservas,
              s.voucher_contacto)
  ) then
    raise exception 'rollback 191: columnas antiguas sin paridad con la tabla sensible';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
