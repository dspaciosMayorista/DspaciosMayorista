-- ─────────────────────────────────────────────────────────────────────────
-- 235 · FIXTURE PREVIA (variante de la de la 234 para esquemas 001-234: los paquetes en modo 63 se publican por el envoltorio)
-- (origen: 234 · FIXTURE PREVIA (se COMMITEA en una base desechable con 001-233, ANTES de aplicar la 234, para probar que lo ya existente sobrevive).
-- Paquetes (ids 234901-234904) con su tarifario ya publicado por el publicador vigente (181/226), sin tocar tablas a mano:
--   234901  modo 63 en COP con TRM 4000, publicado, con UNA oferta COP ABIERTA (cotizada antes de la 234)
--   234902  modo 63 en COP sin TRM (todo COP), publicado
--   234903  legacy en USD, publicado
--   234904  modo 63 sin publicar y sin moneda elegida (NULL = COP, como los de antes de la 233)
--   234905/234906  antecedentes del preflight remoto (oferta abierta desfasada no publicable / filas en otra moneda): ver más abajo
-- ─────────────────────────────────────────────────────────────────────────
begin;

create schema t234p;
create function t234p.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000234' || case p_k when 'oper' then '004' when 'vent' then '006' else '999' end)::uuid $$;

insert into auth.users (id, email) values (t234p.u('oper'), 'c234p-oper@x.test'), (t234p.u('vent'), 'c234p-vent@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  (t234p.u('oper'), 'c234p-oper@x.test', 'C234P oper', 'operaciones'::rol_usuario, true, 'mayorista'),
  (t234p.u('vent'), 'c234p-vent@x.test', 'C234P vent', 'venta'::rol_usuario, true, 'mayorista')
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;

insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (234910, 'T234P CARTAGENA', 'CTG', 'Colombia', true);
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id, modo_oferta, trm_oferta, moneda_publicacion) values
  (234901, 'T234P modo 63 COP con TRM', 'dinamico', true, 234910, 'cop_trm_63', 4000, 'COP'),
  (234902, 'T234P modo 63 COP sin TRM', 'dinamico', true, 234910, 'cop_trm_63', null, 'COP'),
  (234903, 'T234P legacy USD', 'dinamico', true, 234910, 'legacy', null, 'USD'),
  (234904, 'T234P modo 63 sin moneda elegida', 'dinamico', true, 234910, 'cop_trm_63', 4000, null);

-- Publica por el publicador vigente como lo haría el servidor (rol operaciones, token de generación/revisión actuales).
create function t234p.publicar(p_paquete bigint, p_moneda text) returns void language plpgsql as $$
declare v_gen bigint; v_rev bigint; v_res text;
begin
  select tarifario_generacion, tarifario_revision_fuente into v_gen, v_rev from public.armado_paquetes where id = p_paquete;
  perform set_config('request.jwt.claims', json_build_object('sub', t234p.u('oper'), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', t234p.u('oper')::text, true);
  set local role authenticated;
  begin
    -- En la 234 un paquete en modo cop_trm_63 solo se publica por el envoltorio publicar_tarifario_resultado_63 (con su TRM); los demás, por el publicador base.
    if (select modo_oferta from public.armado_paquetes where id = p_paquete) = 'cop_trm_63' then
      execute format($f$select public.publicar_tarifario_resultado_63(%s, %s, %s, %L, %L::jsonb, 'cop_trm_63', %s)::text$f$, p_paquete, v_gen, v_rev, p_moneda,
        jsonb_build_array(jsonb_build_object('modulo', 'dinamico', 'categoria', 'ESTANDAR', 'regimen', 'PC', 'acomodacion', 'doble', 'noches', 3,
          'fecha_ida', (current_date + 40)::text, 'fecha_regreso', (current_date + 43)::text,
          'base_comisionable', 550000, 'impuesto', 0, 'precio_pvp', 550000))::text,
        coalesce((select trm_oferta::text from public.armado_paquetes where id = p_paquete), 'null')) into v_res;
    else
      execute format($f$select public.publicar_tarifario_resultado(%s, %s, %s, %L, %L::jsonb)::text$f$, p_paquete, v_gen, v_rev, p_moneda,
        jsonb_build_array(jsonb_build_object('modulo', 'dinamico', 'categoria', 'ESTANDAR', 'regimen', 'PC', 'acomodacion', 'doble', 'noches', 3,
          'fecha_ida', (current_date + 40)::text, 'fecha_regreso', (current_date + 43)::text,
          'base_comisionable', 550000, 'impuesto', 0, 'precio_pvp', 550000))::text) into v_res;
    end if;
  exception when others then
    reset role;
    raise exception 'fixture previa: no se pudo publicar el paquete %: % %', p_paquete, sqlstate, sqlerrm;
  end;
  reset role;
  if v_res is distinct from 'true' then raise exception 'fixture previa: la publicación del paquete % devolvió %', p_paquete, v_res; end if;
end $$;

select t234p.publicar(234901, 'COP');
select t234p.publicar(234902, 'COP');
select t234p.publicar(234903, 'USD');

-- Oferta COP ABIERTA cotizada antes de la 234 (como la crearía el servidor): debe seguir aceptándose después.
insert into public.cotizaciones (id, tenant, payload, detalle, cliente, destino, hotel, modulo, plan_nombre, pax, precio_venta, moneda, fecha_salida, fecha_regreso,
                                 vigencia_hasta, paquete_armado_id, asesor, creado_por)
values (234990, 'mayorista', '{}'::jsonb, '{}'::jsonb, 'Cliente 234P', 'T234P CARTAGENA', 'T234P HOTEL', 'dinamico', 'ESTANDAR · PC', 2, 3360000, 'COP',
        current_date + 60, current_date + 63, current_date + 1, 234901, 'Asesor 234P', 'c234p@x.test');
insert into public.p63_oferta (cotizacion_id, tenant, paquete_id, salida_id, trm, rev_fuente, rev_publicada, gen_publicada, rev_costos, huella, huella_financiera, snapshot)
select 234990, 'mayorista', p.id, null, 4000, p.tarifario_revision_fuente, p.tarifario_revision_publicada, p.tarifario_generacion_publicada, p.p63_rev_costos,
       'h-previa', 'f-previa',
       jsonb_build_object('v', 1, 'paquete_id', p.id, 'salida_id', null, 'empaquetado_id', null, 'trm', 4000, 'moneda', 'COP',
         'cabecera', jsonb_build_object('tipo_paquete', 'dinamico', 'moneda', 'COP', 'pax', 2, 'precio_venta', 3360000, 'paquete_armado_id', p.id,
           'n_tramos', 0, 'n_items', 0, 'n_hoteles', 0, 'tipo_asesor', 'interno', 'canal', 'B2C'),
         'b2b', null, 'vigencias', '[]'::jsonb, 'financiero', jsonb_build_object('costos', '{}'::jsonb, 'cxp', '[]'::jsonb))
  from public.armado_paquetes p where p.id = 234901;

-- ── Antecedentes del preflight remoto (se conservan SIN tocar; la 234 no puede alterarlos) ─────────────────────────────────────────────
-- 234905 (≈ paquete 70): oferta ABIERTA cotizada en COP y el paquete hoy elige USD con tarifario NO publicable (la RPC 233 impide aceptarla).
--        Se arma como ocurrió: modo 63 en COP, publicado y cotizado; luego pasó a USD (legacy, único modo que admite USD antes de la 234).
-- 234906 (≈ paquete 71): elige COP pero conserva filas publicadas en USD; estado pendiente, revisión fuente > publicada, snapshot no publicable.
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id, modo_oferta, trm_oferta, moneda_publicacion) values
  (234905, 'T234P oferta COP, paquete luego en USD', 'dinamico', true, 234910, 'cop_trm_63', 4000, 'COP'),
  (234906, 'T234P filas USD, paquete luego en COP', 'dinamico', true, 234910, 'legacy', null, 'USD');
select t234p.publicar(234905, 'COP');
select t234p.publicar(234906, 'USD');
insert into public.cotizaciones (id, tenant, payload, detalle, cliente, destino, hotel, modulo, plan_nombre, pax, precio_venta, moneda, fecha_salida, fecha_regreso,
                                 vigencia_hasta, paquete_armado_id, asesor, creado_por)
values (234991, 'mayorista', '{}'::jsonb, '{}'::jsonb, 'Cliente 234P-2', 'T234P CARTAGENA', 'T234P HOTEL', 'dinamico', 'ESTANDAR · PC', 2, 3360000, 'COP',
        current_date + 60, current_date + 63, current_date + 1, 234905, 'Asesor 234P', 'c234p@x.test');
insert into public.p63_oferta (cotizacion_id, tenant, paquete_id, salida_id, trm, rev_fuente, rev_publicada, gen_publicada, rev_costos, huella, huella_financiera, snapshot)
select 234991, 'mayorista', p.id, null, 4000, p.tarifario_revision_fuente, p.tarifario_revision_publicada, p.tarifario_generacion_publicada, p.p63_rev_costos,
       'h-hist', 'f-hist',
       jsonb_build_object('v', 1, 'paquete_id', p.id, 'salida_id', null, 'empaquetado_id', null, 'trm', 4000, 'moneda', 'COP',
         'cabecera', jsonb_build_object('tipo_paquete', 'dinamico', 'moneda', 'COP', 'pax', 2, 'precio_venta', 3360000, 'paquete_armado_id', p.id,
           'n_tramos', 0, 'n_items', 0, 'n_hoteles', 0, 'tipo_asesor', 'interno', 'canal', 'B2C'),
         'b2b', null, 'vigencias', '[]'::jsonb, 'financiero', jsonb_build_object('costos', '{}'::jsonb, 'cxp', '[]'::jsonb))
  from public.armado_paquetes p where p.id = 234905;
-- El paquete 234905 cambia de moneda y de modo (antes de la 234 solo legacy admite USD): su tarifario deja de ser publicable.
update public.armado_paquetes set modo_oferta = 'legacy', trm_oferta = null, moneda_publicacion = 'USD' where id = 234905;
-- El paquete 234906 pasa a COP (modo 63) con las filas publicadas en USD: se invalida y queda pendiente.
update public.armado_paquetes set modo_oferta = 'cop_trm_63', trm_oferta = 4000, moneda_publicacion = 'COP' where id = 234906;
update public.armado_paquetes set tarifario_revision_fuente = tarifario_revision_fuente + 3 where id = 234906;
do $$
begin
  if exists (select 1 from public.armado_paquetes where id in (234905, 234906) and coalesce(tarifario_snapshot_publicable, false)) then
    raise exception 'fixture previa: 234905/234906 deben quedar con snapshot NO publicable';
  end if;
  if (select tarifario_estado from public.armado_paquetes where id = 234906) is distinct from 'pendiente'
     or (select tarifario_revision_fuente <= tarifario_revision_publicada from public.armado_paquetes where id = 234906) then
    raise exception 'fixture previa: 234906 debe quedar pendiente con revisión fuente > publicada';
  end if;
end $$;

drop function t234p.publicar(bigint, text);
drop function t234p.u(text);
drop schema t234p;
commit;
