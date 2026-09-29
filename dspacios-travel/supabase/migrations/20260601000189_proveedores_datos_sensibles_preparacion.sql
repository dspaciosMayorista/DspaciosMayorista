-- 189: preparar la separacion de los datos sensibles de proveedores.
-- Aplicar antes del despliegue que lea/escriba proveedores_datos_sensibles.
-- Las columnas antiguas se conservan temporalmente para la version publicada.
begin;

-- Misma transaccion para la redaccion, el backfill y la sincronizacion legacy.
-- El lock evita una escritura entre el ultimo evento antiguo y el trigger nuevo.
lock table public.proveedores in share row exclusive mode;

create function public.redactar_auditoria_proveedor()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_campos constant text[] := array[
    'nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
    'numero_cuenta', 'politica_reservas', 'voucher_contacto'
  ];
  v_cambios_redactados jsonb;
begin
  if new.tabla not in ('proveedores', 'proveedores_datos_sensibles') then
    return new;
  end if;

  if new.tabla = 'proveedores_datos_sensibles' then
    new.registro_id := coalesce(
      new.registro_id, new.despues->>'proveedor_id', new.antes->>'proveedor_id'
    );
  end if;

  new.antes := new.antes - v_campos;
  new.despues := new.despues - v_campos;

  if new.cambios is not null then
    select coalesce(
      jsonb_object_agg(k, jsonb_build_object('antes', '[REDACTADO]', 'despues', '[REDACTADO]')),
      '{}'::jsonb
    ) into v_cambios_redactados
    from unnest(v_campos) as t(k)
    where new.cambios ? k;

    new.cambios := (new.cambios - v_campos) || v_cambios_redactados;
  end if;

  return new;
end;
$$;

revoke all on function public.redactar_auditoria_proveedor() from public, anon, authenticated;

create trigger auditoria_proveedores_redactar
  before insert or update on public.auditoria
  for each row execute function public.redactar_auditoria_proveedor();

-- No borrar eventos: conservar actor, fecha, accion, registro y nombres de
-- campos cambiados, pero nunca los valores de los ocho campos sensibles.
update public.auditoria
set antes = antes, despues = despues, cambios = cambios
where tabla = 'proveedores';

alter policy auditoria_select on public.auditoria
  using (public.mi_rol() in ('superadmin', 'gerencia'));

do $$
declare
  v_campos constant text[] := array[
    'nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
    'numero_cuenta', 'politica_reservas', 'voucher_contacto'
  ];
begin
  if exists (
    select 1 from public.auditoria a
    where a.tabla = 'proveedores'
      and (
        coalesce(a.antes, '{}'::jsonb) ?| v_campos
        or coalesce(a.despues, '{}'::jsonb) ?| v_campos
        or exists (
          select 1 from jsonb_each(coalesce(a.cambios, '{}'::jsonb)) as c(k, v)
          where c.k = any(v_campos)
            and c.v <> '{"antes":"[REDACTADO]","despues":"[REDACTADO]"}'::jsonb
        )
      )
  ) then
    raise exception 'Auditoria de proveedores conserva valores sensibles';
  end if;
end;
$$;

create function public.mi_tenant_real()
returns text
language sql stable security definer set search_path = ''
as $$
  select u.tenant
  from public.usuarios u
  where u.id = auth.uid() and u.activo
$$;

revoke all on function public.mi_tenant_real() from public, anon;
grant execute on function public.mi_tenant_real() to authenticated;

create table public.proveedores_datos_sensibles (
  proveedor_id bigint not null references public.proveedores(id) on delete cascade,
  tenant text not null check (tenant in ('mayorista', 'minorista')),
  nit text,
  razon_social text,
  datos_pago text,
  banco text,
  tipo_cuenta text,
  numero_cuenta text,
  politica_reservas text,
  voucher_contacto text,
  primary key (proveedor_id, tenant)
);

alter table public.proveedores_datos_sensibles enable row level security;
revoke all on public.proveedores_datos_sensibles from public, anon, authenticated;
grant select, insert, update, delete on public.proveedores_datos_sensibles to authenticated;
grant select, insert, update, delete on public.proveedores_datos_sensibles to service_role;

create policy "proveedores sensibles: lectura autorizada"
  on public.proveedores_datos_sensibles for select to authenticated
  using (
    public.mi_rol() in ('superadmin', 'gerencia')
    or (
      public.mi_rol() in ('administracion', 'operaciones', 'venta', 'control_vuelo')
      and public.mi_tenant_real() = 'mayorista'
      and tenant = 'mayorista'
    )
  );

create policy "proveedores sensibles: insertar mayorista"
  on public.proveedores_datos_sensibles for insert to authenticated
  with check (
    public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    and public.mi_tenant_real() = 'mayorista'
    and tenant = 'mayorista'
  );

create policy "proveedores sensibles: actualizar mayorista"
  on public.proveedores_datos_sensibles for update to authenticated
  using (
    public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    and public.mi_tenant_real() = 'mayorista'
    and tenant = 'mayorista'
  )
  with check (
    public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    and public.mi_tenant_real() = 'mayorista'
    and tenant = 'mayorista'
  );

create policy "proveedores sensibles: borrar mayorista"
  on public.proveedores_datos_sensibles for delete to authenticated
  using (
    public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    and public.mi_tenant_real() = 'mayorista'
    and tenant = 'mayorista'
  );

insert into public.proveedores_datos_sensibles (
  proveedor_id, tenant, nit, razon_social, datos_pago, banco,
  tipo_cuenta, numero_cuenta, politica_reservas, voucher_contacto
)
select id, 'mayorista', nit, razon_social, datos_pago, banco,
       tipo_cuenta, numero_cuenta, politica_reservas, voucher_contacto
from public.proveedores;

-- Mientras exista codigo publicado que escribe las columnas antiguas,
-- mantener la copia sensible alineada dentro de la misma transaccion.
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

-- Se adjunta despues del backfill: solo los cambios reales posteriores
-- generan eventos, filtrados por auditoria_proveedores_redactar.
create trigger trg_auditoria
  after insert or update or delete on public.proveedores_datos_sensibles
  for each row execute function public.fn_auditoria();

-- FOR ALL otorgaba tambien SELECT. Se reemplaza para limitar la lectura
-- de la tabla antigua hasta que se eliminen sus columnas sensibles.
drop policy "proveedores: escritura admin" on public.proveedores;
drop policy "proveedores: lectura interna" on public.proveedores;

create policy "proveedores: lectura transitoria"
  on public.proveedores for select to authenticated
  using (
    public.mi_rol() in ('superadmin', 'gerencia')
    or (
      public.mi_rol() in ('administracion', 'operaciones', 'venta', 'control_vuelo')
      and public.mi_tenant_real() = 'mayorista'
    )
  );

create policy "proveedores: insertar mayorista"
  on public.proveedores for insert to authenticated
  with check (
    public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    and public.mi_tenant_real() = 'mayorista'
  );

create policy "proveedores: actualizar mayorista"
  on public.proveedores for update to authenticated
  using (
    public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    and public.mi_tenant_real() = 'mayorista'
  )
  with check (
    public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    and public.mi_tenant_real() = 'mayorista'
  );

create policy "proveedores: borrar mayorista"
  on public.proveedores for delete to authenticated
  using (
    public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    and public.mi_tenant_real() = 'mayorista'
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
    raise exception 'Backfill de proveedores sensibles incompleto';
  end if;

  if has_table_privilege('anon', 'public.proveedores_datos_sensibles', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.proveedores_datos_sensibles', 'TRUNCATE') then
    raise exception 'TRUNCATE no autorizado en proveedores_datos_sensibles';
  end if;
end;
$$;

commit;
