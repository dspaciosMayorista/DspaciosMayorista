-- Fixture de la 298 (después de fixture_293/295/297 y de la 297; base local desechable).
-- Régimen FULL en el hotel 9301 (el suplemento que el dueño necesita distinto por grupo) y FULL en los
-- generales de su calculadora Dubai.
insert into public.planes_alimentacion (id, codigo, nombre) values (9303, 'FULL', 'FULL t298') on conflict do nothing;
insert into public.hotel_regimenes (hotel_id, plan_id) select 9301, id from public.planes_alimentacion where codigo = 'FULL';
update public.hotel_calculadora
   set params = jsonb_set(params, '{suplementos}', '[{"regimen":"PC","monto":45000},{"regimen":"FULL","monto":100000}]')
 where hotel_id = 9301;
