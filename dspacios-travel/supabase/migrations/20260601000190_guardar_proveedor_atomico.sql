-- 190: guardar el catalogo y sus datos sensibles en una sola transaccion.
-- Aplicar despues de 189 y antes de desplegar las acciones que llaman esta RPC.
-- Durante la convivencia escribe las columnas antiguas: el trigger 189 copia
-- a la tabla sensible y las versiones publicadas leen los mismos valores.
begin;

create function public.guardar_proveedor(
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

notify pgrst, 'reload schema';

commit;
