-- Ayudantes de la prueba de la 267 (se incluyen con \ir DENTRO de una transacción, después de las fixtures 216/211/222). SOLO base desechable.
create schema t267;

-- Convierte por el wrapper REAL y evalúa el trigger diferido a continuación. Devuelve el contrato o 'ERR <sqlstate>: <mensaje>'.
-- p_decoy = true inserta, ANTES de evaluar, otra cotización «convertida» con el MISMO número y otra ficha (la «última con ese número»).
create function t267.conv(p bigint, p_decoy bigint default null, p_romper_numero boolean default false) returns text
language plpgsql as $f$
declare r text; v_otra bigint;
begin
  begin
    r := t216.escalar('service_role', null, t216.convertir_sql(p));
    if r like 'ERR%' then return r; end if;
    if p_decoy is not null then
      update public.cotizaciones set aliado_id = null where id = p_decoy and false;  -- sin efecto: la señuelo se crea abajo
      insert into public.cotizaciones (tenant, tipo, estado, payload, detalle, cliente, cliente_documento, destino, hotel, modulo,
          plan_nombre, pax, precio_venta, moneda, fecha_salida, fecha_regreso, vigencia_hasta, asesor, creado_por, numero_contrato, aliado_id)
      select tenant, tipo, 'convertida', payload, detalle, cliente, cliente_documento, destino, hotel, modulo,
          plan_nombre, pax, precio_venta, moneda, fecha_salida, fecha_regreso, vigencia_hasta, asesor, creado_por, r, p_decoy
        from public.cotizaciones where id = p;
    end if;
    if p_romper_numero then
      -- La venta pasa a apuntar a OTRA cotización (abierta, sin contrato): el origen ya no corresponde al contrato convertido.
      v_otra := t267.cot('freelance', 'Free 267');
      perform set_config('session_replication_role', 'replica', true);   -- solo la prueba: la base protege ventas.cotizacion_id tras la conversión
      update public.ventas set cotizacion_id = v_otra where numero_contrato = r;
      perform set_config('session_replication_role', 'origin', true);
    end if;
    set constraints all immediate;
    set constraints all deferred;
  exception when others then return 'ERR ' || sqlstate || ': ' || sqlerrm;
  end;
  return r;
end $f$;

-- Cotización manual simple (la 198 la convierte) con el recobro del aliado; opcionalmente con aliado_id explícito.
create function t267.cot(p_tipo text, p_nombre text, p_aliado bigint default null, p_clave text default null) returns bigint
language plpgsql as $f$
declare c jsonb; v_id bigint;
begin
  c := t216.cab(p_tipo, 200000, 0, 0, 'COP', 1500000);
  c := jsonb_set(c, '{payload,recobroAliado}', '100000');
  c := jsonb_set(c, '{detalle,recobro}', '{"total":200000,"empresa":100000,"aliado":100000}');
  if p_tipo = 'freelance' then c := jsonb_set(c, '{payload,freelanceNombre}', to_jsonb(p_nombre)); end if;
  if p_tipo = 'agencia' then c := jsonb_set(c, '{payload,agenciaNombre}', to_jsonb(p_nombre)); end if;
  v_id := t216.crear('admin', c);
  if p_aliado is not null then
    update public.cotizaciones set aliado_id = p_aliado where id = v_id;
  end if;
  perform t216.pagar(v_id, 600000, coalesce(p_clave, 'k267-' || v_id));
  return v_id;
end $f$;

-- Todo lo que NO debe cambiar por la 267: dinero, abonos, CxP y propietario de la venta.
create function t267.huella(p_num text) returns jsonb language sql stable as $f$
  select jsonb_build_object(
    'venta', (select jsonb_build_object('precio', precio_venta, 'comision_b2b', comision_b2b, 'rec_total', recobro_total, 'rec_emp', recobro_empresa,
                'rec_ali', recobro_aliado, 'asesor', asesor, 'aliado_id', aliado_id, 'b2b_usuario', b2b_usuario_id, 'canal', canal, 'estado', estado)
                from public.ventas where numero_contrato = p_num),
    'comision', (select jsonb_agg(jsonb_build_object('base', base_comision, 'rec_total', recobro_total, 'pct_rec', pct_recobro_aliado, 'estado', estado,
                'pct', pct_comision, 'valor', comision_valor, 'ret', aplica_retencion, 'tipo', tipo_aliado) order by id)
                from public.aliados_b2b where numero_contrato = p_num),
    'abonos', (select jsonb_build_object('n', count(*), 'suma', coalesce(sum(valor_abono), 0)) from public.abonos where numero_contrato = p_num),
    'cxp', (select jsonb_build_object('n', count(*), 'suma', coalesce(sum(valor_total), 0)) from public.cuentas_por_pagar where numero_contrato = p_num),
    'pagos_comision', (select count(*) from public.comision_b2b_pagos p join public.aliados_b2b x on x.id = p.aliado_b2b_id where x.numero_contrato = p_num))
$f$;

insert into public.aliados (id, nombre, nit, tipo, pct_comision) values
  (925701, 'Free 267', '925701', 'freelance', null),
  (925702, 'Ambigua 267', '925702', 'freelance', null),
  (925703, 'ambigua 267 ', '925703', 'freelance', null),
  (925704, 'Free Señuelo 267', '925704', 'freelance', null);
