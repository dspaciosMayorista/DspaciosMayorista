-- Prueba de aislamiento por rol de la 274 (#82) con identidad JWT real (auth.uid()/mi_rol()). Local desechable; termina en ROLLBACK.
-- Uso: psql -X -q -t -A -F" | " -d <base con 001-274> -f supabase/scripts/test_274_rls_por_rol.sql
-- Esperado: venta 0 paquetes / 0 netas; venta autor 1 versión; venta ajeno 0; superadmin 1/1; authenticated no escribe versiones ni ejecuta RPC.
begin;
insert into auth.users (id,email) values ('00000000-0000-0000-0000-000000274001','s@x.test'),('00000000-0000-0000-0000-000000274002','v@x.test'),('00000000-0000-0000-0000-000000274003','v2@x.test') on conflict do nothing;
insert into public.usuarios (id,email,nombre,rol,activo,tenant) values
 ('00000000-0000-0000-0000-000000274001','s@x.test','Super','superadmin',true,'mayorista'),
 ('00000000-0000-0000-0000-000000274002','v@x.test','Venta Uno','venta',true,'mayorista'),
 ('00000000-0000-0000-0000-000000274003','v2@x.test','Venta Dos','venta',true,'mayorista')
 on conflict (id) do update set rol=excluded.rol, activo=true, tenant='mayorista';
insert into public.paquete_din (id,nombre,esquema,pvp_modo,usa_hotel,moneda) values (9001,'P','neta_markup',null,true,'COP');
insert into public.paquete_din_hoteles (paquete_id,nombre,neto) values (9001,'H','{"doble":1000}');
select public.crear_cotizacion_din('00000000-0000-0000-0000-000000274002','mayorista',9001,
 '{"payload":{"cliente":{"nombres":"A"},"ninos":0,"tarifaNino":0,"recobro":0},"detalle":{"venta":{}, "items":[{"valor":100}]},"cliente":"A","precio_venta":100,"moneda":"COP","vigencia_hasta":"2099-01-01","pax":1}'::jsonb,
 '[{"tipo_servicio":"hotel","nombre_servicio":"H","costo_neto":0,"modo":"mk","pct_markup":0,"ta":0,"valor":100,"componente":"hotel","exige_costo":true}]'::jsonb);
create temp table out(c text, v text);
grant all on out to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000274002',true), set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000274002","role":"authenticated"}',true);
insert into out select 'ID: '||coalesce(auth.uid()::text,'null')||' rol '||coalesce(public.mi_rol()::text,'null'), '';
insert into out select 'venta: paquete_din visibles', count(*)::text from public.paquete_din;
insert into out select 'venta: hoteles del paquete (netas) visibles', count(*)::text from public.paquete_din_hoteles;
insert into out select 'venta autor: sus versiones', count(*)::text from public.cotizacion_versiones;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000274003',true), set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000274003","role":"authenticated"}',true);
insert into out select 'venta ajeno: versiones ajenas', count(*)::text from public.cotizacion_versiones;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000274001',true), set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000274001","role":"authenticated"}',true);
insert into out select 'superadmin: paquete_din', count(*)::text from public.paquete_din;
insert into out select 'superadmin: versiones', count(*)::text from public.cotizacion_versiones;
do $$ begin begin insert into public.cotizacion_versiones(cotizacion_id,tenant,version,motivo,precio_venta,moneda,documento,lineas) values (1,'mayorista',9,'x',1,'COP','{}','[]'); insert into out values ('authenticated escribe versiones','SÍ (mal)'); exception when others then insert into out values ('authenticated escribe versiones','bloqueado'); end; end $$;
do $$ begin begin perform public.crear_cotizacion_din('00000000-0000-0000-0000-000000274001','mayorista',9001,'{}','[]'); insert into out values ('authenticated ejecuta RPC','SÍ (mal)'); exception when others then insert into out values ('authenticated ejecuta RPC','bloqueado'); end; end $$;
reset role;
select c, v from out;
rollback;
