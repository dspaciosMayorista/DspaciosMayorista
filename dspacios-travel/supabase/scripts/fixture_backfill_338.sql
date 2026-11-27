-- FIXTURE for the 338 backfill / rollback proof (DISPOSABLE database at the state after 337, BEFORE applying 338).
-- Contracts: B1 one leg + air voucher · B2 outbound + return + air voucher · B3 three legs (ambiguous) + air voucher · B4 two outbounds (ambiguous) without voucher · B5 a hotel voucher only.
insert into public.ventas (numero_contrato, cliente, tenant, tipo_paquete, asesor, estado) values
  ('DTM-9601', 'Backfill uno', 'mayorista', 'dinamico', 'x', 'confirmado'), ('DTM-9602', 'Backfill ida/regreso', 'mayorista', 'dinamico', 'x', 'confirmado'),
  ('DTM-9603', 'Backfill ambiguo', 'mayorista', 'dinamico', 'x', 'confirmado'), ('DTM-9604', 'Backfill dos ida', 'mayorista', 'dinamico', 'x', 'confirmado'),
  ('DTM-9605', 'Solo hotel', 'mayorista', 'dinamico', 'x', 'confirmado');
insert into public.contrato_vuelos (numero_contrato, aerolinea, direccion, record, numero_vuelo, orden) values
  ('DTM-9601', 'AV', 'ida', 'AAA111', 'AV1', 0),
  ('DTM-9602', 'AV', 'ida', 'BBB222', 'AV2', 0), ('DTM-9602', 'AV', 'regreso', 'CCC333', 'AV3', 1),
  ('DTM-9603', 'AV', 'ida', 'DDD444', 'AV4', 0), ('DTM-9603', 'AV', 'regreso', 'DDD444', 'AV5', 1), ('DTM-9603', 'AV', 'ida', 'EEE555', 'AV6', 2),
  ('DTM-9604', 'AV', 'ida', null, 'AV7', 0), ('DTM-9604', 'AV', 'ida', null, 'AV8', 1);
insert into public.vouchers (numero_contrato, tipo, proveedor, contenido) values
  ('DTM-9601', 'vuelo', 'Servicio aéreo', '{"clase":"vuelo","n":1}'), ('DTM-9602', 'vuelo', 'Servicio aéreo', '{"clase":"vuelo","n":2}'), ('DTM-9603', 'vuelo', 'Servicio aéreo', '{"clase":"vuelo","n":3}'),
  ('DTM-9605', 'hotel', 'Hotel', '{"clase":"hotel"}');
