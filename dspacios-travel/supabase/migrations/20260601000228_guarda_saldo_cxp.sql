-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 228 · E5a (#90)
-- Guarda atómica de saldo de cuentas por pagar (CxP).
-- Tolerancia por obligación (decisión del dueño): COP 10,00 / USD 0,10. R3 confirmado por el dueño.
-- Preflight/postcheck/rollback: supabase/scripts/{preflight,postcheck,rollback}_228_guarda_saldo_cxp.sql
--
-- Qué garantiza, dentro de la transacción de cada escritura y para CUALQUIER camino
-- (Server Action, Data API directa, RPC, conciliaciones, SQL manual):
--   · pagos + retenciones de una CxP no superan su valor_total + tolerancia, en la
--     MONEDA NOMINAL de esa CxP (la unidad de las retenciones está comprobada: el formulario
--     y la acción las rotulan y comparan en la moneda de la cuenta);
--   · dos escrituras concurrentes sobre la misma CxP se serializan (solo en READ COMMITTED;
--     en cualquier otro nivel la operación FALLA CERRADO, Z9607);
--   · bajar valor_total por debajo de lo ya asignado, o cambiar la moneda de una CxP con
--     movimientos, queda rechazado;
--   · el pago/retención hereda la agencia (tenant) de su CxP;
--   · importes positivos;
--   · R1 (v3): el origen de la petición se clasifica ANTES de leer o bloquear nada. Solo se
--     confía en (a) una sesión de usuario autenticado, (b) el rol service_role o (c) la
--     AUSENCIA TOTAL de claims JWT en una conexión que no es la de la API (SQL directo del
--     dueño). Cualquier otra petición —incluido `anon`, con o sin uid— recibe el rechazo
--     de RLS y no llega a bloquear filas ni a ver importes;
--   · R3 (v3): impide registrar retenciones (y pagos) sobre una CxP de OTRA agencia. Hoy la
--     RLS de retenciones_cxp (125:28-29) solo mira el rol y lo permite;
--   · NO revela datos de otra agencia: se autoriza ANTES de bloquear o calcular, y una cuenta
--     inexistente, ajena o sin rol produce el MISMO error que la RLS (42501, mismo texto, sin
--     DETAIL ni HINT). Ningún mensaje contiene importes.
-- No toca datos existentes: los triggers solo actúan sobre escrituras futuras.
-- No usa UPDATE no-op para bloquear (dispararía la auditoría 087): el bloqueo es SELECT … FOR NO KEY UPDATE.
--
-- SQLSTATE: clase de implementación 'Z9'.
--   Z9601 pago_excede_saldo / retencion_excede_saldo   Z9602 moneda_con_movimientos
--   Z9603 valor_total_menor_que_asignado               Z9604 importe_no_positivo
--   Z9605 cxp_no_se_reasigna                           Z9606 cxp_no_disponible (solo origen servicio / SQL directo)
--   Z9607 aislamiento_no_soportado
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.cuentas_por_pagar') is null
     or to_regclass('public.cxp_pagos') is null
     or to_regclass('public.retenciones_cxp') is null then
    raise exception '228 ABORTADA: faltan tablas de cuentas por pagar.';
  end if;
  if to_regprocedure('public.cxp_tolerancia(text)') is not null
     or to_regprocedure('public.cxp_rechazo_rls(text)') is not null
     or to_regprocedure('public.cxp_origen_peticion()') is not null
     or to_regprocedure('public.cxp_roles_contables(text)') is not null
     or to_regprocedure('public.trg_cxp_guarda_saldo_hija()') is not null
     or to_regprocedure('public.trg_cxp_guarda_valor()') is not null then
    raise exception '228 ABORTADA: ya existen objetos con estos nombres.';
  end if;
end $$;

-- Tolerancia por moneda (constante a propósito: es un control de integridad y no debe
-- poder editarse desde la aplicación; cambiarla exige migración).
create function public.cxp_tolerancia(p_moneda text)
returns numeric
language sql immutable parallel safe set search_path = ''
as $$
  select case upper(coalesce(btrim(p_moneda), ''))
           when 'COP' then 10.00::numeric
           when 'USD' then 0.10::numeric
           else 0::numeric
         end
$$;

-- R4: roles con acceso contable, en UN solo lugar (ordenados). Deben coincidir con las policies
-- vivas: cxp_pagos "acceso contable" (130:31-39) y retenciones_cxp "contable" (125:28-29). El
-- postcheck compara esta lista con pg_policies; si una policy cambia, la diferencia salta.
create function public.cxp_roles_contables(p_tabla text)
returns text[]
language sql immutable parallel safe set search_path = ''
as $$
  select case p_tabla
           when 'cxp_pagos'       then array['administracion', 'gerencia', 'operaciones', 'superadmin']
           when 'retenciones_cxp' then array['administracion', 'gerencia', 'superadmin']
           else array[]::text[]
         end
$$;

-- R1: clasificación del origen de la petición. Devuelve 'usuario' | 'servicio' | 'sql_directo'
-- | 'rechazado'. NO decide por `auth.uid() is null`: ese caso incluye al rol anon.
--   · usuario     : claim sub presente Y claim role = authenticated (leídos de request.jwt.claims, B1);
--   · servicio    : rol de la petición = service_role;
--   · sql_directo : NINGÚN claim JWT presente Y la sesión de base de datos no es la de la API
--                   (session_user <> 'authenticator'); es el SQL del dueño, sin impersonar;
--   · rechazado   : todo lo demás (anon con o sin uid, claims vacíos de la API, rol desconocido,
--                   o cualquier fallo al leer los claims: se falla CERRADO).
create function public.cxp_origen_peticion()
returns text
language plpgsql stable set search_path = ''
as $$
declare
  v_txt    text;
  v_claims jsonb;
  v_rol    text;
  v_sub    text;
begin
  -- C1: TODA lectura y parseo de claims va dentro del cuerpo: cualquier excepción (p. ej. un
  -- claims que no sea jsonb válido) cae en el handler y devuelve 'rechazado' (falla cerrado).
  -- B1: se leen los claims directamente; no se usa auth.role()/auth.uid() (en desuso en Supabase).
  v_txt    := nullif(current_setting('request.jwt.claims', true), '');
  v_claims := case when v_txt is null then null else v_txt::jsonb end;
  v_rol    := coalesce(nullif(v_claims ->> 'role', ''), nullif(current_setting('request.jwt.claim.role', true), ''));
  v_sub    := coalesce(nullif(v_claims ->> 'sub', ''), nullif(current_setting('request.jwt.claim.sub', true), ''));

  if v_sub is not null and v_rol = 'authenticated' then
    return 'usuario';
  elsif v_rol = 'service_role' then
    return 'servicio';
  elsif v_txt is null and v_rol is null and v_sub is null and session_user <> 'authenticator' then
    return 'sql_directo';
  end if;
  return 'rechazado';
exception when others then
  return 'rechazado';
end $$;

-- Rechazo ÚNICO con la forma exacta de un rechazo de RLS (mismo SQLSTATE y mismo texto, sin
-- DETAIL ni HINT). Se usa para "no existe", "es de otra agencia", "rol no autorizado" y
-- "origen no confiable": que sean indistinguibles impide enumerar ids o inferir saldos ajenos.
create function public.cxp_rechazo_rls(p_tabla text)
returns void
language plpgsql set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = format('new row violates row-level security policy for table "%s"', p_tabla);
end $$;

-- Guarda de las tablas hijas (pagos y retenciones).
create function public.trg_cxp_guarda_saldo_hija()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_origen     text;
  v_tenant_vis text;
  v_cxp        record;
  v_pagos      numeric;
  v_ret        numeric;
  v_asig       numeric;
begin
  -- 0. R1: PRIMERA sentencia. Antes de leer una sola fila o tomar un bloqueo, el origen debe
  --    ser confiable. Un anon (con o sin uid) nunca llega a las tablas de abajo.
  v_origen := public.cxp_origen_peticion();
  if v_origen = 'rechazado' then
    perform public.cxp_rechazo_rls(tg_table_name);
  end if;

  -- 1. Esta guarda depende de que cada sentencia tome una instantánea nueva tras esperar el
  --    bloqueo (READ COMMITTED). En REPEATABLE READ / SERIALIZABLE las sumas usarían la
  --    instantánea inicial y dos pagos podrían pasar: se FALLA CERRADO.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = 'Z9607', message = 'aislamiento_no_soportado';
  end if;
  if tg_op = 'UPDATE' and new.cuenta_por_pagar_id is distinct from old.cuenta_por_pagar_id then
    raise exception using errcode = 'Z9605', message = 'cxp_no_se_reasigna';
  end if;

  -- 2. AUTORIZAR, sin bloquear nada y sin leer importes. Lectura de la agencia de la cuenta
  --    solo para decidir; "no existe" y "no autorizado" producen el mismo rechazo.
  select c.tenant into v_tenant_vis from public.cuentas_por_pagar c where c.id = new.cuenta_por_pagar_id;
  if v_origen = 'usuario' then
    -- Mismos roles que las policies de cada tabla (R4: lista única) y, además, la agencia de la
    -- CUENTA (la policy de cxp_pagos mira el tenant del pago y la de retenciones_cxp no mira
    -- ninguno: esta guarda cierra ambos huecos, R3).
    if v_tenant_vis is null
       or coalesce(public.mi_rol()::text, '') <> all (public.cxp_roles_contables(tg_table_name))
       or not coalesce(public.puede_ver_tenant(v_tenant_vis), false) then
      perform public.cxp_rechazo_rls(tg_table_name);
    end if;
  elsif v_tenant_vis is null then
    -- Origen servicio / SQL directo: no hay nada que ocultar.
    raise exception using errcode = 'Z9606', message = 'cxp_no_disponible';
  end if;

  -- 3. Bloqueo de la CxP: serializa pagos, retenciones y cambios de valor_total de ESTA cuenta.
  select c.valor_total, c.moneda, c.tenant into v_cxp
    from public.cuentas_por_pagar c
   where c.id = new.cuenta_por_pagar_id
   for no key update;
  if not found or v_cxp.tenant is distinct from v_tenant_vis then
    -- La cuenta cambió o desapareció entre la lectura y el bloqueo.
    if v_origen = 'usuario' then
      perform public.cxp_rechazo_rls(tg_table_name);
    end if;
    raise exception using errcode = 'Z9606', message = 'cxp_no_disponible';
  end if;

  -- El tenant del pago/retención es SIEMPRE el de su CxP (hoy lo decide el default
  -- 'mayorista', 130:24). La RLS evalúa su WITH CHECK DESPUÉS de los triggers BEFORE.
  new.tenant := v_cxp.tenant;

  if new.valor is null or new.valor <= 0 then
    raise exception using errcode = 'Z9604', message = 'importe_no_positivo';
  end if;

  -- 4. Lo ya asignado, sin la fila que se está actualizando (si es UPDATE). Cada sentencia
  --    toma su propia instantánea: tras esperar el bloqueo ve lo que otra transacción confirmó.
  select coalesce(sum(p.valor), 0) into v_pagos
    from public.cxp_pagos p
   where p.cuenta_por_pagar_id = new.cuenta_por_pagar_id
     and not (tg_table_name = 'cxp_pagos' and tg_op = 'UPDATE' and p.id = new.id);
  select coalesce(sum(r.valor), 0) into v_ret
    from public.retenciones_cxp r
   where r.cuenta_por_pagar_id = new.cuenta_por_pagar_id
     and not (tg_table_name = 'retenciones_cxp' and tg_op = 'UPDATE' and r.id = new.id);

  if tg_table_name = 'cxp_pagos' then
    v_pagos := v_pagos + new.valor;
  else
    v_ret := v_ret + new.valor;
  end if;
  v_asig := v_pagos + v_ret;

  -- Sin DETAIL: ningún importe viaja en el error. La aplicación, que sí puede leer la cuenta
  -- que ve, calcula y muestra el saldo.
  if v_asig > coalesce(v_cxp.valor_total, 0) + public.cxp_tolerancia(v_cxp.moneda) then
    raise exception using
      errcode = 'Z9601',
      message = case tg_table_name when 'cxp_pagos' then 'pago_excede_saldo' else 'retencion_excede_saldo' end;
  end if;
  return new;
end $$;

-- Guarda de la propia CxP: bajar valor_total o cambiar de moneda. Solo llegan aquí filas que la
-- RLS de UPDATE de cuentas_por_pagar ya dejó modificar (el filtro USING se aplica antes de los
-- triggers de UPDATE), por lo que no hay datos ajenos que proteger.
create function public.trg_cxp_guarda_valor()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_pagos numeric;
  v_ret   numeric;
  v_n     bigint;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = 'Z9607', message = 'aislamiento_no_soportado';
  end if;
  -- La fila ya está bloqueada por el propio UPDATE (el trigger solo corre si cambió
  -- valor_total o moneda, ver la cláusula WHEN).
  if new.moneda is distinct from old.moneda then
    select (select count(*) from public.cxp_pagos where cuenta_por_pagar_id = new.id)
         + (select count(*) from public.retenciones_cxp where cuenta_por_pagar_id = new.id)
      into v_n;
    if v_n > 0 then
      raise exception using errcode = 'Z9602', message = 'moneda_con_movimientos';
    end if;
  end if;

  select coalesce(sum(valor), 0) into v_pagos from public.cxp_pagos where cuenta_por_pagar_id = new.id;
  select coalesce(sum(valor), 0) into v_ret   from public.retenciones_cxp where cuenta_por_pagar_id = new.id;
  if v_pagos + v_ret > coalesce(new.valor_total, 0) + public.cxp_tolerancia(new.moneda) then
    raise exception using errcode = 'Z9603', message = 'valor_total_menor_que_asignado';
  end if;
  return new;
end $$;

create trigger cxp_pagos_guarda_saldo
  before insert or update of valor, cuenta_por_pagar_id, tenant on public.cxp_pagos
  for each row execute function public.trg_cxp_guarda_saldo_hija();
create trigger retenciones_cxp_guarda_saldo
  before insert or update of valor, cuenta_por_pagar_id, tenant on public.retenciones_cxp
  for each row execute function public.trg_cxp_guarda_saldo_hija();
create trigger cxp_guarda_valor
  before update on public.cuentas_por_pagar
  for each row
  when (new.valor_total is distinct from old.valor_total or new.moneda is distinct from old.moneda)
  execute function public.trg_cxp_guarda_valor();

comment on function public.cxp_tolerancia(text) is '228 · tolerancia de saldo de CxP por moneda (COP 10,00; USD 0,10).';
comment on function public.cxp_roles_contables(text) is '228 · roles contables por tabla; deben coincidir con las policies 130 (cxp_pagos) y 125 (retenciones_cxp). El postcheck lo compara con pg_policies.';
comment on function public.cxp_origen_peticion() is '228 · clasifica la petición: usuario | servicio | sql_directo | rechazado (anon y cualquier otro origen). No decide por auth.uid() nulo.';
comment on function public.cxp_rechazo_rls(text) is '228 · rechazo con la forma exacta de un rechazo de RLS (42501), sin detalle.';
comment on function public.trg_cxp_guarda_saldo_hija() is '228 · guarda atómica: pagos + retenciones <= valor_total + tolerancia, en la moneda de la CxP.';
comment on function public.trg_cxp_guarda_valor() is '228 · guarda de valor_total/moneda de la CxP frente a lo ya asignado.';

-- Las funciones de trigger y auxiliares no se ejecutan por la API; EXECUTE no es necesario para que el trigger dispare.
revoke all on function public.cxp_tolerancia(text) from public, anon, authenticated;
revoke all on function public.cxp_roles_contables(text) from public, anon, authenticated;
revoke all on function public.cxp_origen_peticion() from public, anon, authenticated;
revoke all on function public.cxp_rechazo_rls(text) from public, anon, authenticated;
revoke all on function public.trg_cxp_guarda_saldo_hija() from public, anon, authenticated;
revoke all on function public.trg_cxp_guarda_valor() from public, anon, authenticated;

commit;
