-- Casos de la 314. Variable psql :fase = antes | despues | revertida. Salida: UNA tabla caso / observado / esperado / estado.
create or replace function pg_temp.llamar(p_tipo text, p_asesor text, p_aliado bigint, p_usuario uuid default '00000000-0000-0000-0000-000000000001') returns text
language plpgsql as $$
declare v_id bigint; v_cab jsonb; v_ops jsonb;
begin
  v_cab := jsonb_build_object('tipo', p_tipo, 'tenant', 'mayorista', 'moneda', 'COP', 'vigencia_hasta', (current_date + 5)::text,
                              'cliente', 'Ana Pérez', 'payload', jsonb_build_object('tipoAsesor', p_asesor));
  v_ops := jsonb_build_array(
    jsonb_build_object('opcion_ref','A','acomodacion_ref','doble','orden',1,'etiqueta','Hotel A','moneda','COP','total',1000000),
    jsonb_build_object('opcion_ref','B','acomodacion_ref','doble','orden',2,'etiqueta','Hotel B','moneda','COP','total',1200000));
  v_id := public.crear_cotizacion_comparativa(p_usuario, v_cab, '[]'::jsonb, v_ops, p_aliado);
  return 'CREADA';
exception when others then
  return 'RECHAZADA(' || sqlstate || ')';
end $$;

create temp table res (orden int, caso text, observado text, esperado text);
create temp table base_filas as select count(*) as n from public.cotizaciones;

-- B2B sin aliado: el hueco. Antes/revertida se CREA; después se RECHAZA con P0001 y no queda fila.
insert into res select 1, 'agencia manual SIN aliado', pg_temp.llamar('comparativa_manual', 'agencia', null),
  case when :'fase' = 'despues' then 'RECHAZADA(P0001)' else 'CREADA' end;
insert into res select 2, 'freelance manual SIN aliado', pg_temp.llamar('comparativa_manual', 'freelance', null),
  case when :'fase' = 'despues' then 'RECHAZADA(P0001)' else 'CREADA' end;
-- Lo que NO debe cambiar en ninguna fase:
insert into res select 3, 'agencia manual CON aliado de su tipo (7)', pg_temp.llamar('comparativa_manual', 'agencia', 7), 'CREADA';
insert into res select 4, 'freelance manual CON aliado de su tipo (8)', pg_temp.llamar('comparativa_manual', 'freelance', 8), 'CREADA';
insert into res select 5, 'venta interna (B2C) sin aliado', pg_temp.llamar('comparativa_manual', 'interno', null), 'CREADA';
insert into res select 6, 'aliado inexistente (999)', pg_temp.llamar('comparativa_manual', 'agencia', 999), 'RECHAZADA(P0001)';
insert into res select 7, 'aliado de otro tipo (freelance 8 en venta agencia)', pg_temp.llamar('comparativa_manual', 'agencia', 8), 'RECHAZADA(P0001)';
insert into res select 8, 'aliado en venta interna', pg_temp.llamar('comparativa_manual', 'interno', 7), 'RECHAZADA(P0001)';
insert into res select 9, 'carrito (comparativa_carrito) B2B sin aliado: no cambia', pg_temp.llamar('comparativa_carrito', 'agencia', null, null), 'CREADA';
insert into res select 10, 'usuario inactivo/ inexistente', pg_temp.llamar('comparativa_manual', 'agencia', 7, '00000000-0000-0000-0000-0000000000ff'), 'RECHAZADA(42501)';

-- Filas: el histórico sigue y las rechazadas no dejaron nada.
insert into res select 11, 'histórico B2B sin aliado sigue intacto',
  (select count(*) from public.cotizaciones where id in (1, 2) and aliado_id is null)::text, '2';
insert into res select 12, 'filas creadas en esta fase (creadas esperadas: 4 + 2 de B2B sin aliado si NO hay guarda)',
  ((select count(*) from public.cotizaciones) - (select n from base_filas))::text,
  case when :'fase' = 'despues' then '4' else '6' end;
insert into res select 13, 'ninguna fila B2B nueva sin aliado tras la 314 (esperado 0 después; 2 antes/revertida)',
  (select count(*) from public.cotizaciones where id > 2 and tipo = 'comparativa_manual' and aliado_id is null and payload->>'tipoAsesor' in ('agencia','freelance'))::text,
  case when :'fase' = 'despues' then '0' else '2' end;

select orden, caso, observado, esperado, case when observado = esperado then 'OK' else 'FALLO' end as estado from res order by orden;
