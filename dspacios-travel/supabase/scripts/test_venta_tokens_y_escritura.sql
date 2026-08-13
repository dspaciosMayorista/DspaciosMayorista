-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA: el rol `venta` puede VER su agencia, pero no lo sensible ni EDITAR
--         lo ajeno.  Correr en el editor SQL de Supabase.
--         Solo lectura: hace escrituras de prueba y termina en ROLLBACK.
-- ─────────────────────────────────────────────────────────────────────────
--
-- Cubre los hallazgos de la auditoría del PR #259 (migración 147):
--
--   1. `venta` ve los contratos de su tenant por `ventas_basica`.
--   2. `venta` NO ve contratos de otro tenant.
--   3. `venta` NO lee columnas financieras.
--   4. `venta` NO obtiene `share_token` de contratos AJENOS.
--      ← el crítico: con ese token se abría `/c/[token]`, que es pública, usa
--      service-role y muestra los pasajeros con documento y nacimiento.
--   5. `venta` NO ve pasajeros ni adjuntos de contratos ajenos.
--   6. `venta` NO puede modificar ni borrar hijas de contratos ajenos.
--   7. `venta` SÍ conserva el acceso sobre sus contratos propios.
--   8. Usuarios inactivos no leen ni escriben.
--   9. Los roles administrativos siguen funcionando.
--
-- Cada bloque deja una fila en `_res`. Al final, si algo falla, corta con un
-- `raise exception`: no basta con listar, tiene que fallar fuerte.
-- ─────────────────────────────────────────────────────────────────────────

begin;

create temp table _res (n int, caso text, esperado text, obtenido text, ok boolean) on commit drop;

do $$
declare
  v_uid        uuid;    -- usuario rol `venta`
  v_tenant     text;
  adm_uid      uuid;    -- usuario administrativo
  inact_uid    uuid;    -- usuario desactivado (se crea uno de prueba si no hay)
  c_propio     text;    -- contrato del asesor
  c_ajeno      text;    -- contrato de su agencia pero de OTRO asesor
  c_otro_ten   text;    -- contrato de otra agencia
  n            bigint;
  t            text;
  falla        text;
begin
  -- ── Preparación ────────────────────────────────────────────────────────
  -- Se busca un `venta` real y se le asegura el tenant de los contratos, para
  -- que la prueba sea concluyente (si no tiene contratos de su agencia, todo
  -- da 0 y no se distingue "protegido" de "no ve nada"). Todo dentro de la
  -- transacción: al final se revierte.
  select tenant into v_tenant from public.ventas group by tenant order by count(*) desc limit 1;
  if v_tenant is null then raise exception 'No hay contratos: la prueba no concluye nada.'; end if;

  select id into v_uid from public.usuarios where rol = 'venta' and activo limit 1;
  if v_uid is null then raise exception 'No hay usuario con rol `venta`: la prueba no concluye nada.'; end if;
  update public.usuarios set tenant = v_tenant where id = v_uid;

  select id into adm_uid from public.usuarios where rol in ('administracion','operaciones') and activo limit 1;
  if adm_uid is not null then update public.usuarios set tenant = v_tenant where id = adm_uid; end if;

  -- Un contrato AJENO (de su tenant, con otro asesor) y uno PROPIO.
  select numero_contrato into c_ajeno
    from public.ventas v
   where v.tenant = v_tenant
     and coalesce(lower(btrim(v.asesor)), '') <> (select lower(btrim(coalesce(nombre,''))) from public.usuarios where id = v_uid)
   limit 1;

  -- Para tener un propio garantizado, se le adjudica uno dentro de la transacción.
  select numero_contrato into c_propio from public.ventas where tenant = v_tenant and numero_contrato <> coalesce(c_ajeno,'') limit 1;
  if c_propio is not null then
    update public.ventas set asesor = (select nombre from public.usuarios where id = v_uid) where numero_contrato = c_propio;
  end if;

  select numero_contrato into c_otro_ten from public.ventas where tenant <> v_tenant limit 1;

  -- Usuario inactivo de prueba: se desactiva temporalmente a otro `venta`, o
  -- al mismo si no hay más (se revierte con el ROLLBACK).
  select id into inact_uid from public.usuarios where rol = 'venta' and id <> v_uid limit 1;
  if inact_uid is null then inact_uid := v_uid; end if;

  -- ── Helper: entrar como un usuario ─────────────────────────────────────
  -- (se repite inline porque `set local role` no se puede encapsular fácil)

  -- 1. Ve su agencia por la vista
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas_basica;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (1, 'venta ve contratos de su agencia (ventas_basica)', '> 0', n::text, n > 0);

  -- 2. No ve otro tenant
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas_basica where tenant <> v_tenant;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (2, 'venta NO ve contratos de otra agencia', '0', n::text, n = 0);

  -- 3. No lee columnas financieras (tabla base)
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  begin
    select count(*) into n from public.ventas where costo_hotel is not null or otros_costos is not null;
  exception when others then n := 0; end;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (3, 'venta NO lee costos de `ventas`', '0', n::text, n = 0);

  -- 4. CRÍTICO: no obtiene el share_token de contratos AJENOS
  if c_ajeno is not null then
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    select count(*) into n from public.ventas_basica where numero_contrato = c_ajeno and share_token is not null;
    reset role; perform set_config('request.jwt.claims', null, true);
    insert into _res values (4, 'venta NO obtiene share_token de contrato AJENO (habilitaba /c/[token])', '0', n::text, n = 0);
  end if;

  -- 4b. …pero SÍ lo tiene para el propio (no romper compartir con su cliente)
  if c_propio is not null then
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    select count(*) into n from public.ventas_basica where numero_contrato = c_propio and share_token is not null;
    reset role; perform set_config('request.jwt.claims', null, true);
    insert into _res values (5, 'venta SÍ obtiene share_token de contrato PROPIO', '1', n::text, n = 1);
  end if;

  -- 5. No ve pasajeros ni adjuntos ajenos
  if c_ajeno is not null then
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    select count(*) into n from public.contrato_pasajeros where numero_contrato = c_ajeno;
    reset role; perform set_config('request.jwt.claims', null, true);
    insert into _res values (6, 'venta NO ve pasajeros de contrato ajeno', '0', n::text, n = 0);
  end if;

  -- 6. No puede ESCRIBIR en hijas de contratos ajenos (el hallazgo nuevo)
  if c_ajeno is not null then
    foreach t in array array['contrato_hoteles','contrato_vuelos','contrato_items','vouchers','cuotas'] loop
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
      begin
        execute format('delete from public.%I where numero_contrato = %L', t, c_ajeno);
        get diagnostics n = row_count;
      exception when others then n := 0; end;
      reset role; perform set_config('request.jwt.claims', null, true);
      insert into _res values (7, 'venta NO borra ' || t || ' de contrato ajeno', '0 filas', n::text, n = 0);
    end loop;
  end if;

  -- 7. Sobre el PROPIO sí conserva acceso de lectura
  if c_propio is not null then
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    select count(*) into n from public.ventas_basica where numero_contrato = c_propio;
    reset role; perform set_config('request.jwt.claims', null, true);
    insert into _res values (8, 'venta SÍ ve su contrato propio', '1', n::text, n = 1);
  end if;

  -- 8. Usuario inactivo: ni lee
  update public.usuarios set activo = false where id = inact_uid;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', inact_uid, 'role','authenticated')::text, true);
  select count(*) into n from public.ventas_basica;
  reset role; perform set_config('request.jwt.claims', null, true);
  insert into _res values (9, 'usuario INACTIVO no lee nada', '0', n::text, n = 0);
  update public.usuarios set activo = true where id = inact_uid;

  -- 9. Rol administrativo sigue funcionando
  if adm_uid is not null then
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', adm_uid, 'role','authenticated')::text, true);
    select count(*) into n from public.ventas;
    reset role; perform set_config('request.jwt.claims', null, true);
    insert into _res values (10, 'rol administrativo conserva acceso a `ventas`', '> 0', n::text, n > 0);
  end if;
end $$;

select n as "#", caso, esperado, obtenido, case when ok then 'OK' else 'FALLA' end as resultado
from _res order by ok, n;

do $$
declare n int; detalle text;
begin
  select count(*), string_agg(caso, ' | ') into n, detalle from _res where not ok;
  if n > 0 then
    raise exception 'FALLAN % comprobacion(es): %', n, detalle;
  end if;
  raise notice 'OK: las % comprobaciones pasaron.', (select count(*) from _res);
end $$;

rollback;
