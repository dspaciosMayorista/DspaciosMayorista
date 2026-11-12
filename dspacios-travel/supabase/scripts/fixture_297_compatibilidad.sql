-- Fixture de COMPATIBILIDAD de la 297 (se carga ANTES de la 297; base local desechable, después de fixture_293/295).
-- Tres calculadoras ya existentes, una de cada tipo, con todas sus opciones, tal como las guarda hoy la app.
insert into public.hoteles (id, destino_id, nombre, modelo_tarifario) values (9304, 9301, 'T297 CORPORATIVA', 'persona')
on conflict (id) do nothing;
insert into public.hotel_calculadora (hotel_id, tipo, params, updated_at) values
  (9301, 'dubai', '{"regimen_base":"PAM","modificadores":{"sencilla_pct":50,"pax3_pct":-20,"pax4_pct":-25,"nino_pct":-50,"nino2_pct":-30,"infante_pct":-100},
    "suplementos":[{"regimen":"PC","monto":45000}],
    "bases":[{"categoria":"Estándar","temporada":"ALTA","precio":100000,"usarEdadesPropias":true,"edadesPropias":{"infanteMin":0,"infanteMax":1,"ninoMin":2,"ninoMax":11},
              "usarSuplementosPropios":true,"suplementosPropios":[{"regimen":"PC","monto":50000}],"condicionesPropias":"Temporada alta"},
             {"categoria":"Superior","temporada":"BAJA","precio":150000}],
    "promos":[{"temporadaBase":"ALTA","temporadaPromo":"NUEVA","regimen":"PAM","descuentoPct":10,"usarEdadesPropias":true,
               "edadesPropias":{"infanteMin":0,"infanteMax":2,"ninoMin":3,"ninoMax":12},"usarSuplementoPropio":true,"suplementoPropioMonto":0,"condicionesPropias":"No reembolsable"}],
    "infante_nota":"Comparte cama"}', '2026-10-01T10:00:00Z'),
  (9303, 'mixta', '{"regimen":"PAM","iva_pct":19,"acom":{"sencilla":{"modo":"pax","iva":true},"doble":{"modo":"hab","iva":false},"triple":{"modo":"pax","iva":false},"multiple":{"modo":"pax","iva":false}},
    "nino":{"iva":true},"pax":{"sencilla":1,"doble":2,"triple":3,"multiple":4},
    "bases":[{"categoria":"Estándar","temporada":"ALTA","sencilla":200000,"doble":300000,"triple":0,"multiple":0,"nino":50000,"nino2":null,"infante":0}],
    "bases_por_regimen":{"PAM":[{"categoria":"Estándar","temporada":"ALTA","sencilla":200000,"doble":300000,"triple":0,"multiple":0,"nino":50000,"nino2":null,"infante":0}],
                         "PC":[{"categoria":"Estándar","temporada":"ALTA","sencilla":250000,"doble":360000,"triple":140000,"multiple":0,"nino":60000,"nino2":40000,"infante":null}]},
    "infante_nota":"Cuna"}', '2026-10-02T10:00:00Z'),
  (9304, 'corporativa', '{"regimen_base":"PAM","persona_adicional":90000,"nino_adicional":40000,"impuesto_pct":0,"descuento_pct":10,
    "suplementos_regimen":[{"regimen":"PC","adulto":30000,"nino":15000}],
    "bases":[{"categoria":"Estándar","temporada":"ALTA","precio":400000}],"infante_nota":"Infante cortesía"}', '2026-10-03T10:00:00Z');
