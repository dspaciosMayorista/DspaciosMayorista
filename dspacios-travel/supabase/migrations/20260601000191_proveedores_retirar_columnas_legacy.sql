-- 191: cierre de la separacion de datos sensibles de proveedores.
--
-- Requisitos (verificar con supabase/scripts/preflight_191_proveedores_retirar_legacy.sql):
--   - 189 y 190 aplicadas.
--   - La app publicada ya no lee ni escribe las ocho columnas antiguas de
--     public.proveedores (lee public.proveedores_datos_sensibles y escribe por
--     public.guardar_proveedor).
--
-- Que hace, en UNA transaccion:
--   1. Bloquea el catalogo y verifica paridad fila a fila entre las columnas
--      antiguas y public.proveedores_datos_sensibles (tenant = 'mayorista').
--   2. Reemplaza guardar_proveedor(jsonb, bigint) con la misma firma,
--      validaciones, SECURITY INVOKER y permisos, escribiendo los campos
--      generales en public.proveedores y los sensibles directamente en
--      public.proveedores_datos_sensibles.
--      datos_pago: igual que en 190, la RPC NUNCA lo escribe. Al crear queda
--      NULL; al editar se conserva el valor existente, venga o no la clave en
--      el JSON. (La app no la envia; hoy solo se conserva gracias al trigger
--      legacy, que esta migracion retira.)
--   3. Retira los triggers legacy de sincronizacion y su funcion.
--   4. Elimina las ocho columnas antiguas SIN CASCADE: si algo mas depende de
--      ellas, la migracion falla y no cambia nada.
--   5. Sustituye la lectura transitoria del catalogo BASE por una unica policy
--      de SELECT: solo personal interno activo de Mayorista y Minorista. El
--      catalogo es de uso interno: agencia, freelance y cliente_final no lo
--      leen en ningun tenant (los flujos B2B de reservar lo consultan en el
--      servidor con service-role). Escritura sin cambios (solo Mayorista autorizado).
--   6. Revoca TRUNCATE del catalogo a anon/authenticated (TRUNCATE no pasa por RLS).
--
-- No toca: public.proveedores_datos_sensibles (ni columnas ni RLS), la
-- auditoria ni su redaccion, ni permisos de contratos/pasajeros/contactos/campanas.
-- Reversion: supabase/scripts/rollback_191_proveedores_retirar_legacy.sql
begin;

set local lock_timeout = '5s';

-- Mismo orden que la RPC y el trigger legacy (catalogo -> sensibles) para no
-- invertir el orden de bloqueo. ACCESS EXCLUSIVE es el que exige DROP COLUMN;
-- tomarlo al inicio evita escalar el lock a mitad de la transaccion.
lock table public.proveedores in access exclusive mode;
lock table public.proveedores_datos_sensibles in share row exclusive mode;

-- 1. Paridad antes de retirar nada.
do $$
declare
  v_faltantes bigint;
  v_diferentes bigint;
begin
  select count(*) filter (where s.proveedor_id is null),
         count(*) filter (
           where s.proveedor_id is not null
             and row(p.nit, p.razon_social, p.datos_pago, p.banco,
                     p.tipo_cuenta, p.numero_cuenta, p.politica_reservas,
                     p.voucher_contacto)
                 is distinct from
                 row(s.nit, s.razon_social, s.datos_pago, s.banco,
                     s.tipo_cuenta, s.numero_cuenta, s.politica_reservas,
                     s.voucher_contacto))
    into v_faltantes, v_diferentes
  from public.proveedores p
  left join public.proveedores_datos_sensibles s
    on s.proveedor_id = p.id and s.tenant = 'mayorista';

  if v_faltantes > 0 or v_diferentes > 0 then
    raise exception '191: paridad incompleta (sin fila sensible: %, con valores distintos: %)',
      v_faltantes, v_diferentes;
  end if;
end;
$$;

-- 2. RPC: misma firma, validaciones, SECURITY INVOKER y permisos que 190.
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
      tipo, nombre, ciudad, contacto, aplica_retencion, pct_retencion, clasificacion
    ) values (
      v_tipo, v_nombre, nullif(btrim(p_proveedor->>'ciudad'), ''),
      nullif(btrim(p_proveedor->>'contacto'), ''),
      coalesce((p_proveedor->>'aplica_retencion')::boolean, false),
      coalesce((p_proveedor->>'pct_retencion')::numeric, 0), v_clasificacion
    ) returning id into v_id;
  else
    update public.proveedores set
      tipo = v_tipo,
      nombre = v_nombre,
      ciudad = nullif(btrim(p_proveedor->>'ciudad'), ''),
      contacto = nullif(btrim(p_proveedor->>'contacto'), ''),
      aplica_retencion = coalesce((p_proveedor->>'aplica_retencion')::boolean, false),
      pct_retencion = coalesce((p_proveedor->>'pct_retencion')::numeric, 0),
      clasificacion = v_clasificacion
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Proveedor no encontrado o sin permiso' using errcode = '42501';
    end if;
  end if;

  -- datos_pago no figura en la lista de columnas: en un alta queda NULL y en
  -- una edicion el DO UPDATE no lo toca (se conserva).
  insert into public.proveedores_datos_sensibles (
    proveedor_id, tenant, nit, razon_social, banco, tipo_cuenta,
    numero_cuenta, politica_reservas, voucher_contacto
  ) values (
    v_id, 'mayorista',
    nullif(btrim(p_proveedor->>'nit'), ''),
    nullif(btrim(p_proveedor->>'razon_social'), ''),
    nullif(btrim(p_proveedor->>'banco'), ''),
    nullif(btrim(p_proveedor->>'tipo_cuenta'), ''),
    nullif(btrim(p_proveedor->>'numero_cuenta'), ''),
    nullif(btrim(p_proveedor->>'politica_reservas'), ''),
    nullif(btrim(p_proveedor->>'voucher_contacto'), '')
  )
  on conflict (proveedor_id, tenant) do update set
    nit = excluded.nit,
    razon_social = excluded.razon_social,
    banco = excluded.banco,
    tipo_cuenta = excluded.tipo_cuenta,
    numero_cuenta = excluded.numero_cuenta,
    politica_reservas = excluded.politica_reservas,
    voucher_contacto = excluded.voucher_contacto;

  return v_id;
end;
$$;

revoke all on function public.guardar_proveedor(jsonb, bigint) from public, anon;
grant execute on function public.guardar_proveedor(jsonb, bigint) to authenticated;

-- 3. Sincronizacion legacy: ya nadie escribe las columnas antiguas.
drop trigger proveedores_sensibles_legacy_insert on public.proveedores;
drop trigger proveedores_sensibles_legacy_update on public.proveedores;
drop function public.sincronizar_proveedor_sensible_legacy();

-- 4. Columnas antiguas. Sin CASCADE: cualquier dependencia no prevista aborta.
alter table public.proveedores
  drop column nit,
  drop column razon_social,
  drop column datos_pago,
  drop column banco,
  drop column tipo_cuenta,
  drop column numero_cuenta,
  drop column politica_reservas,
  drop column voucher_contacto;

-- 5. Lectura del catalogo BASE (ya sin datos sensibles): solo personal interno.
-- mi_rol() devuelve NULL para usuarios inactivos o sin perfil (migracion 140),
-- asi que quedan fuera igual que agencia, freelance y cliente_final. Una sola
-- policy de SELECT: con policies permisivas, cualquier otra se sumaria con OR.
drop policy "proveedores: lectura transitoria" on public.proveedores;

create policy "proveedores: lectura catalogo"
  on public.proveedores for select to authenticated
  using (
    public.mi_rol() in (
      'superadmin', 'gerencia', 'administracion', 'operaciones', 'venta', 'control_vuelo'
    )
  );

-- 6. TRUNCATE ignora RLS: nadie desde la API debe poder vaciar el catalogo.
revoke truncate on public.proveedores from anon, authenticated;

-- Forma EFECTIVA esperada de las policies de las dos tablas. En vez de buscar
-- nombres de rol con una regex (que un USING (true) eludiria), se crean las
-- policies esperadas sobre tablas temporales con la misma forma y se comparan
-- una a una con las reales: nombre, comando, permisiva/restrictiva, roles,
-- USING y WITH CHECK, deparseados por el propio Postgres. Cualquier policy de
-- mas, de menos o con otra expresion (incluido USING (true)) aborta la 191.
-- La lectura del catalogo es la definida arriba; las otras siete son las de la
-- 189, copiadas literalmente. Las tablas temporales desaparecen al commit.
create temp table _ref191_catalogo (id bigint) on commit drop;
create temp table _ref191_sensibles (tenant text) on commit drop;

create policy "proveedores: lectura catalogo"
  on pg_temp._ref191_catalogo for select to authenticated
  using (
    public.mi_rol() in (
      'superadmin', 'gerencia', 'administracion', 'operaciones', 'venta', 'control_vuelo'
    )
  );

create policy "proveedores: insertar mayorista"
  on pg_temp._ref191_catalogo for insert to authenticated
  with check (
    public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    and public.mi_tenant_real() = 'mayorista'
  );

create policy "proveedores: actualizar mayorista"
  on pg_temp._ref191_catalogo for update to authenticated
  using (
    public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    and public.mi_tenant_real() = 'mayorista'
  )
  with check (
    public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    and public.mi_tenant_real() = 'mayorista'
  );

create policy "proveedores: borrar mayorista"
  on pg_temp._ref191_catalogo for delete to authenticated
  using (
    public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    and public.mi_tenant_real() = 'mayorista'
  );

create policy "proveedores sensibles: lectura autorizada"
  on pg_temp._ref191_sensibles for select to authenticated
  using (
    public.mi_rol() in ('superadmin', 'gerencia')
    or (
      public.mi_rol() in ('administracion', 'operaciones', 'venta', 'control_vuelo')
      and public.mi_tenant_real() = 'mayorista'
      and tenant = 'mayorista'
    )
  );

create policy "proveedores sensibles: insertar mayorista"
  on pg_temp._ref191_sensibles for insert to authenticated
  with check (
    public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    and public.mi_tenant_real() = 'mayorista'
    and tenant = 'mayorista'
  );

create policy "proveedores sensibles: actualizar mayorista"
  on pg_temp._ref191_sensibles for update to authenticated
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
  on pg_temp._ref191_sensibles for delete to authenticated
  using (
    public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    and public.mi_tenant_real() = 'mayorista'
    and tenant = 'mayorista'
  );

-- Verificaciones finales: si algo no cuadra, se revierte todo.
do $$
declare
  v_campos constant text[] := array[
    'nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
    'numero_cuenta', 'politica_reservas', 'voucher_contacto'
  ];
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'proveedores'
      and column_name = any(v_campos)
  ) then
    raise exception '191: quedan columnas sensibles en public.proveedores';
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.proveedores'::regclass
      and tgname in ('proveedores_sensibles_legacy_insert', 'proveedores_sensibles_legacy_update')
  ) or to_regprocedure('public.sincronizar_proveedor_sensible_legacy()') is not null then
    raise exception '191: quedan restos de la sincronizacion legacy';
  end if;

  -- Policies: la forma efectiva debe ser EXACTAMENTE la de referencia, en
  -- ambos sentidos (ni de mas ni de menos ni distinta).
  if exists (
    with reales as (
      select pol.polrelid, pol.polname, pol.polcmd, pol.polpermissive,
             (select array_agg(case when r = 0 then 'public' else r::regrole::text end order by 1)
              from unnest(pol.polroles) as r) as roles,
             pg_get_expr(pol.polqual, pol.polrelid) as usando,
             pg_get_expr(pol.polwithcheck, pol.polrelid) as verificando
      from pg_policy pol
      where pol.polrelid in ('public.proveedores'::regclass, 'public.proveedores_datos_sensibles'::regclass,
                             'pg_temp._ref191_catalogo'::regclass, 'pg_temp._ref191_sensibles'::regclass)
    ),
    real_ as (
      select case when polrelid = 'public.proveedores'::regclass then 'catalogo' else 'sensibles' end as tabla,
             polname, polcmd, polpermissive, roles, usando, verificando
      from reales
      where polrelid in ('public.proveedores'::regclass, 'public.proveedores_datos_sensibles'::regclass)
    ),
    ref_ as (
      select case when polrelid = 'pg_temp._ref191_catalogo'::regclass then 'catalogo' else 'sensibles' end as tabla,
             polname, polcmd, polpermissive, roles, usando, verificando
      from reales
      where polrelid in ('pg_temp._ref191_catalogo'::regclass, 'pg_temp._ref191_sensibles'::regclass)
    )
    (select * from real_ except select * from ref_)
    union all
    (select * from ref_ except select * from real_)
  ) then
    raise exception '191: las policies de proveedores no tienen la forma esperada (revisar pg_policies)';
  end if;

  if (select count(*) from pg_policy
      where polrelid in ('pg_temp._ref191_catalogo'::regclass, 'pg_temp._ref191_sensibles'::regclass)) <> 8 then
    raise exception '191: referencia de policies incompleta';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.proveedores'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.proveedores_datos_sensibles'::regclass) then
    raise exception '191: RLS desactivada en proveedores';
  end if;

  if has_table_privilege('anon', 'public.proveedores', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.proveedores', 'TRUNCATE')
     or has_table_privilege('anon', 'public.proveedores_datos_sensibles', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.proveedores_datos_sensibles', 'TRUNCATE') then
    raise exception '191: TRUNCATE no autorizado en proveedores';
  end if;

  if (select prosecdef from pg_proc where oid = 'public.guardar_proveedor(jsonb, bigint)'::regprocedure)
     or has_function_privilege('anon', 'public.guardar_proveedor(jsonb, bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.guardar_proveedor(jsonb, bigint)', 'EXECUTE') then
    raise exception '191: guardar_proveedor con seguridad o permisos inesperados';
  end if;

  -- Auditoria y su redaccion siguen en su sitio.
  if (select count(*) from pg_trigger t
      where t.tgenabled <> 'D' and (
        (t.tgrelid = 'public.proveedores'::regclass and t.tgname = 'trg_auditoria')
        or (t.tgrelid = 'public.proveedores_datos_sensibles'::regclass and t.tgname = 'trg_auditoria')
        or (t.tgrelid = 'public.auditoria'::regclass and t.tgname = 'auditoria_proveedores_redactar')
      )) <> 3 then
    raise exception '191: auditoria o redaccion de proveedores ausente';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
