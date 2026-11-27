-- NEGATIVE CONTROL for the 338 driver (RB1_SEMILLA): the LEG LOCK TRIGGER is removed (plain leg writers no longer take the contract advisory lock). The flight editor RPC still waits on the ventas row
-- lock held by the generation, so only the writers that do NOT lock ventas (the superadmin content editor: plain statements) are exposed: scenario V6 must FAIL (a stale «vigente» appears). DISPOSABLE database only.
drop trigger t_00_tramo_candado on public.contrato_vuelos;
