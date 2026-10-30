-- ─────────────────────────────────────────────────────────────────────────
-- 233 · FIXTURE PREVIA (se COMMITEA en una base desechable ANTES de aplicar la 233, para probar el backfill y el preflight).
-- Paquetes (ids 233901-233906) con su tarifario ya publicado por el publicador vigente (181/226), sin tocar tablas a mano:
--   233901  legacy, dinamico, publicado en USD          → backfill esperado: USD (hecho registrado)
--   233902  legacy, porción terrestre, publicado en COP → COP
--   233903  legacy, sin publicar                        → NULL (debe elegir)
--   233904  modo 63 con TRM 4000, publicado             → COP (el modo publica en COP por definición)
--   233905  modo 63 con TRM 4000, sin publicar          → COP
--   233906  legacy publicado en COP con un hotel en USD → el preflight lo marca (fuente en otra moneda)
-- ─────────────────────────────────────────────────────────────────────────
begin;

create schema t233p;
create function t233p.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000233' || case p_k when 'oper' then '004' else '999' end)::uuid $$;

insert into auth.users (id, email) values (t233p.u('oper'), 'c233p-oper@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
values (t233p.u('oper'), 'c233p-oper@x.test', 'C233P oper', 'operaciones'::rol_usuario, true, 'mayorista')
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;

insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (233910, 'T233P CARTAGENA', 'CTG', 'Colombia', true);
insert into public.proveedores (id, nombre, aplica_retencion, pct_retencion) values (233790, 'T233P PROV', false, 0);
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) values (233690, 233910, 'T233P HOTEL USD', 233790, 'USD');

insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id, fecha_viaje_inicio, fecha_viaje_fin) values
  (233901, 'T233P legacy dinamico publicado USD', 'dinamico', true, 233910, null, null),
  (233902, 'T233P legacy porcion publicado COP', 'porcion_terrestre', true, 233910, current_date + 30, current_date + 60),
  (233903, 'T233P legacy sin publicar', 'dinamico', true, 233910, null, null),
  (233906, 'T233P legacy COP con hotel USD', 'porcion_terrestre', true, 233910, current_date + 30, current_date + 60);
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id, modo_oferta, trm_oferta) values
  (233904, 'T233P modo 63 publicado', 'dinamico', true, 233910, 'cop_trm_63', 4000),
  (233905, 'T233P modo 63 sin publicar', 'dinamico', true, 233910, 'cop_trm_63', 4000);

-- Publica `[fila]` por el publicador VIGENTE como lo haría el servidor (rol operaciones, token de generación/revisión actuales).
create function t233p.publicar(p_paquete bigint, p_moneda text) returns void language plpgsql as $$
declare v_gen bigint; v_rev bigint; v_res text; v_modulo text;
begin
  select tarifario_generacion, tarifario_revision_fuente, case tipo::text when 'porcion_terrestre' then 'porcion_terrestre' else 'dinamico' end
    into v_gen, v_rev, v_modulo from public.armado_paquetes where id = p_paquete;
  perform set_config('request.jwt.claims', json_build_object('sub', t233p.u('oper'), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', t233p.u('oper')::text, true);
  set local role authenticated;
  begin
    execute format($f$select public.publicar_tarifario_resultado(%s, %s, %s, %L, %L::jsonb)::text$f$, p_paquete, v_gen, v_rev, p_moneda,
      jsonb_build_array(jsonb_build_object('modulo', v_modulo, 'categoria', 'ESTANDAR', 'regimen', 'PC', 'acomodacion', 'doble', 'noches', 3,
        'fecha_ida', (current_date + 40)::text, 'fecha_regreso', (current_date + 43)::text,
        'base_comisionable', 550000, 'impuesto', 0, 'precio_pvp', 550000))::text) into v_res;
  exception when others then
    reset role;
    raise exception 'fixture previa: no se pudo publicar el paquete %: % %', p_paquete, sqlstate, sqlerrm;
  end;
  reset role;
  if v_res is distinct from 'true' then raise exception 'fixture previa: la publicación del paquete % devolvió %', p_paquete, v_res; end if;
end $$;

insert into public.armado_hoteles (paquete_id, hotel_id) values (233906, 233690);

select t233p.publicar(233901, 'USD');
select t233p.publicar(233902, 'COP');
select t233p.publicar(233906, 'COP');
select t233p.publicar(233904, 'COP');

drop function t233p.publicar(bigint, text);
drop function t233p.u(text);
drop schema t233p;
commit;
