-- ROLLBACK de la 318 (#98). Las aceptaciones y firmas son EVIDENCIA: el script se NIEGA si existe alguna fila. Úsalo solo con el código de #98 retirado y sin datos.
-- El bucket aliado-firmas NO se borra aquí (Supabase exige vaciarlo por la API de Storage); si quedó vacío se puede eliminar desde el panel.
--
-- B7 — PROTEGIDO CONTRA ESCRITORES CONCURRENTES: (1) espera ACOTADA (5 s) por los candados; (2) candado ACCESS EXCLUSIVE sobre las DOS tablas, SIEMPRE en el mismo orden
-- (aliado_firmas, luego cuenta_cobro_aceptaciones), ANTES de contar: espera a las transacciones en curso y bloquea a las nuevas hasta el final; (3) solo entonces se cuenta y se borra.
-- Si no se obtienen los candados en 5 s el script falla sin cambiar nada. IMPACTO: mientras corre, firmar y aceptar cuentas de cobro esperan (milisegundos); después fallan por «no existe».
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regclass('public.aliado_firmas') is not null then lock table public.aliado_firmas in access exclusive mode; end if;
  if to_regclass('public.cuenta_cobro_aceptaciones') is not null then lock table public.cuenta_cobro_aceptaciones in access exclusive mode; end if;
end $$;
do $$ begin
  if (to_regclass('public.cuenta_cobro_aceptaciones') is not null and exists (select 1 from public.cuenta_cobro_aceptaciones))
     or (to_regclass('public.aliado_firmas') is not null and exists (select 1 from public.aliado_firmas)) then
    raise exception '318 rollback: hay firmas o aceptaciones registradas (evidencia). No se borran.';
  end if;
end $$;
drop function if exists public.aceptar_cuenta_cobro(text, bigint, jsonb, text, uuid);
drop function if exists public.registrar_firma_aliado(bigint, text, text, text, integer, uuid);
drop table if exists public.cuenta_cobro_aceptaciones;
drop table if exists public.aliado_firmas;
drop function if exists public.tg_cuenta_cobro_aceptaciones_inmutable();
drop function if exists public.tg_aliado_firmas_inmutable();
commit;
