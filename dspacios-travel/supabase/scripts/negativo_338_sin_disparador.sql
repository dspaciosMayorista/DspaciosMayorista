-- NEGATIVE CONTROL for the 338 driver (RB1_SEMILLA): the trigger that flags an air voucher when the legs of its service change / disappear is REMOVED.
-- The transition scenarios (A3, B3, C1, D1-D5, E1, E3) must FAIL: the issued URL would keep serving the old itinerary as current. DISPOSABLE database only.
drop trigger t_tramo_marca_vouchers on public.contrato_vuelos;
