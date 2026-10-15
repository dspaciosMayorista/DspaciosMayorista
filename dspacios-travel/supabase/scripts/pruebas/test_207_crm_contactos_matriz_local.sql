-- ─────────────────────────────────────────────────────────────────────────
-- MATRIZ DE ACCESO A `crm_contactos` · SOLO BASE LOCAL DESECHABLE
--
-- ⛔ NO es para Producción ni para un Preview/staging que comparta datos.
--    Intenta INSERT, UPDATE y DELETE reales (luego revertidos). Un ROLLBACK
--    no convierte esto en solo lectura: dispara triggers, consume la
--    secuencia del id y toma bloqueos sobre filas reales. Para Producción
--    están `preflight_207_`/`postcheck_207_crm_contactos_acceso.sql` (solo SELECT) y
--    la sonda HEAD `api_207_crm_contactos_acceso.mjs`.
--
--    Guarda: aborta ANTES de tocar nada si la base no se llama
--    `crmacc_<dígitos>` o `crmapi_<dígitos>` (las que crean los runners
--    locales `test_207_crm_contactos_acceso.sh` / `test_207_api_crm_contactos_acceso.sh`).
--
-- Toma UN usuario por (rol, agencia, activo) + un UID sin perfil + `anon`, y
-- se hace pasar por cada uno como lo hace PostgREST: `set local role` +
-- `request.jwt.claims`. Sin el `set role` el superusuario se salta la RLS.
--
-- Columnas:
--   ve_*        filas visibles: de su agencia / de la otra / sin atribuir
--   esp_*       lo que la regla dice que debería ver
--   ins_*       insertar con tenant propio / ajeno / NULL explícito
--   upd_*/del_* filas afectadas por UPDATE/DELETE sobre cada grupo
--   cambio_ten  intentar cambiar el tenant de una fila ya atribuida visible
--   veredicto   OK o la lista de discrepancias
-- ─────────────────────────────────────────────────────────────────────────

do $$
begin
  if current_database() !~ '^crm(acc|api)_[0-9]+$' then
    raise exception 'Matriz LOCAL: la base "%" no es una base desechable de prueba (crmacc_<n>/crmapi_<n>). Abortado sin tocar nada.', current_database();
  end if;
end $$;

begin;

create temp table _crm_acceso (
  caso text, rol text, tenant text, activo boolean,
  ve_propia bigint, ve_ajena bigint, ve_null bigint,
  esp_propia bigint, esp_ajena bigint, esp_null bigint,
  ins_propia text, ins_ajena text, ins_null text,
  upd_propia bigint, upd_ajena bigint, upd_null bigint,
  del_propia bigint, del_ajena bigint, del_null bigint,
  cambio_ten text, veredicto text
) on commit drop;
grant all on _crm_acceso to authenticated, anon;

do $$
declare
  u           record;
  v_tot_may   bigint;
  v_tot_min   bigint;
  v_tot_null  bigint;
  v_interno   boolean;
  v_global    boolean;
  v_otra      text;
  r           _crm_acceso%rowtype;
  n           bigint;

  -- Intenta una sentencia y la revierte SIEMPRE. Devuelve 'si' / 'no:<sqlstate>'.
  -- (No se puede declarar función local en plpgsql: se repite el patrón.)
begin
  -- Totales reales (como superusuario, ANTES de cambiar de rol).
  select count(*) filter (where tenant = 'mayorista'),
         count(*) filter (where tenant = 'minorista'),
         count(*) filter (where tenant is null)
    into v_tot_may, v_tot_min, v_tot_null
    from public.crm_contactos;

  -- Un usuario por (rol, tenant, activo) + dos sesiones sintéticas: un UID
  -- sin perfil y `anon`. La lista se arma ANTES del set role.
  for u in
    select * from (
      select distinct on (us.rol, us.tenant, us.activo)
             'usuario'::text as caso, us.id, us.rol::text as rol, us.tenant, us.activo
        from public.usuarios us
       order by us.rol, us.tenant, us.activo, us.id
    ) x
    union all select 'uid sin perfil', '00000000-0000-0000-0000-0000000c0ffe'::uuid, '(ninguno)', null, null
    union all select 'anon', null, 'anon', null, null
    order by 1, 3, 4, 5
  loop
    r := null;
    r.caso := u.caso; r.rol := u.rol; r.tenant := u.tenant; r.activo := u.activo;

    v_interno := coalesce(u.activo, false)
                 and u.rol in ('superadmin','gerencia','administracion','operaciones','venta');
    v_global  := v_interno and u.rol in ('superadmin','gerencia');
    v_otra    := case u.tenant when 'mayorista' then 'minorista' when 'minorista' then 'mayorista' else 'mayorista' end;

    r.esp_propia := case when v_interno then case coalesce(u.tenant, '') when 'mayorista' then v_tot_may when 'minorista' then v_tot_min else 0 end else 0 end;
    r.esp_ajena  := case when v_global  then case v_otra when 'mayorista' then v_tot_may else v_tot_min end else 0 end;
    r.esp_null   := case when v_global  then v_tot_null else 0 end;

    -- ── Hacerse pasar por la sesión ──
    if u.caso = 'anon' then
      execute 'set local role anon';
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    else
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    end if;

    -- ── SELECT ──
    begin
      select count(*) filter (where tenant = coalesce(u.tenant, '-')),
             count(*) filter (where tenant = v_otra),
             count(*) filter (where tenant is null)
        into r.ve_propia, r.ve_ajena, r.ve_null
        from public.crm_contactos;
    exception when insufficient_privilege then
      r.ve_propia := 0; r.ve_ajena := 0; r.ve_null := 0;  -- anon: sin privilegio de tabla
    end;

    -- ── INSERT (propia / ajena / NULL explícito), siempre revertido ──
    begin
      insert into public.crm_contactos (nombre, tenant, origen) values ('zz prueba acceso', coalesce(u.tenant, 'mayorista'), 'prueba_acceso');
      raise exception using errcode = 'P0001', message = '__revertir__';
    exception when others then
      r.ins_propia := case when sqlerrm = '__revertir__' then 'si' else 'no:' || sqlstate end;
    end;
    begin
      insert into public.crm_contactos (nombre, tenant, origen) values ('zz prueba acceso', v_otra, 'prueba_acceso');
      raise exception using errcode = 'P0001', message = '__revertir__';
    exception when others then
      r.ins_ajena := case when sqlerrm = '__revertir__' then 'si' else 'no:' || sqlstate end;
    end;
    begin
      insert into public.crm_contactos (nombre, tenant, origen) values ('zz prueba acceso', null, 'prueba_acceso');
      raise exception using errcode = 'P0001', message = '__revertir__';
    exception when others then
      r.ins_null := case when sqlerrm = '__revertir__' then 'si' else 'no:' || sqlstate end;
    end;

    -- ── UPDATE / DELETE: filas afectadas por grupo, siempre revertido ──
    begin
      update public.crm_contactos set notas = notas where tenant = coalesce(u.tenant, '-');
      get diagnostics n = row_count; r.upd_propia := n;
      update public.crm_contactos set notas = notas where tenant = v_otra;
      get diagnostics n = row_count; r.upd_ajena := n;
      update public.crm_contactos set notas = notas where tenant is null;
      get diagnostics n = row_count; r.upd_null := n;
      delete from public.crm_contactos where tenant = coalesce(u.tenant, '-');
      get diagnostics n = row_count; r.del_propia := n;
      delete from public.crm_contactos where tenant = v_otra;
      get diagnostics n = row_count; r.del_ajena := n;
      delete from public.crm_contactos where tenant is null;
      get diagnostics n = row_count; r.del_null := n;
      raise exception using errcode = 'P0001', message = '__revertir__';
    exception
      when insufficient_privilege then
        r.upd_propia := coalesce(r.upd_propia, 0); r.upd_ajena := coalesce(r.upd_ajena, 0); r.upd_null := coalesce(r.upd_null, 0);
        r.del_propia := coalesce(r.del_propia, 0); r.del_ajena := coalesce(r.del_ajena, 0); r.del_null := coalesce(r.del_null, 0);
      when others then
        if sqlerrm <> '__revertir__' then raise; end if;
    end;

    -- ── Cambiar el tenant de una fila atribuida que SÍ ve ──
    begin
      update public.crm_contactos set tenant = case tenant when 'mayorista' then 'minorista' else 'mayorista' end
       where id = (select min(id) from public.crm_contactos where tenant is not null);
      get diagnostics n = row_count;
      raise exception using errcode = 'P0001', message = case when n = 0 then '__nada__' else '__revertir__' end;
    exception when others then
      r.cambio_ten := case sqlerrm when '__nada__' then 'sin fila visible'
                                   when '__revertir__' then 'PERMITIDO'
                                   else 'no:' || sqlstate end;
    end;

    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);

    -- ── Veredicto ──
    r.veredicto := concat_ws('; ',
      case when r.ve_propia <> r.esp_propia then format('ve propia %s≠%s', r.ve_propia, r.esp_propia) end,
      case when r.ve_ajena  <> r.esp_ajena  then format('ve ajena %s≠%s',  r.ve_ajena,  r.esp_ajena)  end,
      case when r.ve_null   <> r.esp_null   then format('ve sin atribuir %s≠%s', r.ve_null, r.esp_null) end,
      case when (r.ins_propia = 'si') <> (v_interno and u.tenant is not null) then 'insert propia ' || r.ins_propia end,
      case when (r.ins_ajena  = 'si') <> v_global                          then 'insert ajena '  || r.ins_ajena  end,
      case when r.ins_null = 'si'                                          then 'insert NULL permitido' end,
      case when r.upd_propia <> r.esp_propia or r.upd_ajena <> r.esp_ajena or r.upd_null <> r.esp_null then 'update fuera de alcance' end,
      case when r.del_propia <> r.esp_propia or r.del_ajena <> r.esp_ajena or r.del_null <> r.esp_null then 'delete fuera de alcance' end,
      case when r.cambio_ten = 'PERMITIDO' then 'cambio de tenant permitido' end
    );
    if r.veredicto = '' then r.veredicto := 'OK'; end if;

    insert into _crm_acceso select r.*;
  end loop;
end $$;

select caso, rol, tenant, activo,
       ve_propia || '/' || ve_ajena || '/' || ve_null       as "ve propia/ajena/sin_atr",
       esp_propia || '/' || esp_ajena || '/' || esp_null    as "esperado",
       ins_propia || ' · ' || ins_ajena || ' · ' || ins_null as "insert propia·ajena·null",
       upd_propia || '/' || upd_ajena || '/' || upd_null    as "update",
       del_propia || '/' || del_ajena || '/' || del_null    as "delete",
       cambio_ten, veredicto
  from _crm_acceso
 order by veredicto <> 'OK' desc, caso, rol, tenant, activo;

rollback;
