-- Pruebas SQL de la validación estricta del resumen de precios (migración 304, #94). Se ejecuta con test_304_resumen_contrato.sh; imprime una línea PASS/FALLO por caso.
-- Resumen mínimo válido: una unidad, un grupo (2 adultos × 50.000.000 centavos), ajuste 0.
create temp table caso(nombre text, doc jsonb, esperado boolean);

insert into caso values
 ('válido', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":100000000,"unidades":[{"ref":"item-0","paquete":{"id":1,"nombre":"P"},"hotel":"H","categoria":"C","regimen":"PC","ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":["Tour"],"cupos":["a","b"]}]}]}', true),
 ('válido neto con ajuste', '{"version":1,"modalidad":"neto","moneda":"USD","totalCentavos":100000001,"unidades":[{"ref":"item-0","ajusteCentavos":1,"totalCentavos":100000001,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":[],"cupos":["a","b"]}]}]}', true),
 ('null', null, false),
 ('no es objeto', '[]', false),
 ('versión como texto', '{"version":"1","modalidad":"pvp","moneda":"COP","totalCentavos":1,"unidades":[]}', false),
 ('versión ausente', '{"modalidad":"pvp","moneda":"COP","totalCentavos":100000000,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":[],"cupos":[]}]}]}', false),
 ('modalidad inválida', '{"version":1,"modalidad":"otra","moneda":"COP","totalCentavos":100000000,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":[],"cupos":[]}]}]}', false),
 ('moneda nula', '{"version":1,"modalidad":"pvp","moneda":null,"totalCentavos":100000000,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":[],"cupos":[]}]}]}', false),
 ('moneda vacía', '{"version":1,"modalidad":"pvp","moneda":" ","totalCentavos":100000000,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":[],"cupos":[]}]}]}', false),
 ('total como texto', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":"100000000","unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":[],"cupos":[]}]}]}', false),
 ('total negativo', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":-1,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":-1,"grupos":[{"tipo":"adulto","cantidad":1,"tarifaCentavos":0,"subtotalCentavos":0,"incluye":[],"cupos":[]}]}]}', false),
 ('total decimal', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":100000000.5,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":[],"cupos":[]}]}]}', false),
 ('sin unidades', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":0,"unidades":[]}', false),
 ('unidades nulo', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":0,"unidades":null}', false),
 ('unidad sin ref', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":100000000,"unidades":[{"ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":[],"cupos":[]}]}]}', false),
 ('unidad ajuste nulo', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":100000000,"unidades":[{"ref":"item-0","ajusteCentavos":null,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":[],"cupos":[]}]}]}', false),
 ('unidad sin grupos', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":0,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":0,"grupos":[]}]}', false),
 ('grupo con tipo desconocido', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":100000000,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"mascota","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":[],"cupos":[]}]}]}', false),
 ('grupo cantidad 0', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":0,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":0,"grupos":[{"tipo":"adulto","cantidad":0,"tarifaCentavos":50000000,"subtotalCentavos":0,"incluye":[],"cupos":[]}]}]}', false),
 ('grupo sin tarifa', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":100000000,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"subtotalCentavos":100000000,"incluye":[],"cupos":[]}]}]}', false),
 ('subtotal ≠ cantidad × tarifa', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":99999999,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":99999999,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":99999999,"incluye":[],"cupos":[]}]}]}', false),
 ('total de unidad ≠ suma de grupos', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":100000001,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":100000001,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":[],"cupos":[]}]}]}', false),
 ('total del resumen ≠ suma de unidades', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":1,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":[],"cupos":[]}]}]}', false),
 ('incluye no es lista', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":100000000,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":"Tour","cupos":[]}]}]}', false),
 ('incluye con un nulo', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":100000000,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":[null],"cupos":[]}]}]}', false),
 ('cupos ausente', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":100000000,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":[]}]}]}', false),
 ('cupos con número', '{"version":1,"modalidad":"pvp","moneda":"COP","totalCentavos":100000000,"unidades":[{"ref":"item-0","ajusteCentavos":0,"totalCentavos":100000000,"grupos":[{"tipo":"adulto","cantidad":2,"tarifaCentavos":50000000,"subtotalCentavos":100000000,"incluye":[],"cupos":[1]}]}]}', false);

do $$
declare c record; v boolean; fallos int := 0; total int := 0;
begin
  for c in select * from caso loop
    total := total + 1;
    v := public.p94_resumen_valido(c.doc);
    if v is distinct from c.esperado then
      fallos := fallos + 1;
      raise notice 'FALLO validador: % (esperaba %, dio %)', c.nombre, c.esperado, v;
    else
      raise notice 'PASS  validador: %', c.nombre;
    end if;
  end loop;
  raise notice 'VALIDADOR_RESUMEN % casos, % fallos', total, fallos;
end $$;
