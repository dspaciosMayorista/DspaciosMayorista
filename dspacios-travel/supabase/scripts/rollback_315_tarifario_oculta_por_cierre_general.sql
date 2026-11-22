-- Rollback de la 315: quita los tres disparadores y sus funciones. NO toca datos, tarifarios publicados ni las filas ya ocultas (tarifario_fila_oculta se limpia sola al regenerar). Idempotente.
drop trigger if exists tarifario_trg_hotel_blackouts_ins on public.hotel_blackouts;
drop trigger if exists tarifario_trg_hotel_blackouts_upd on public.hotel_blackouts;
drop trigger if exists tarifario_trg_hotel_blackouts_del on public.hotel_blackouts;
drop function if exists public.tarifario_trg_cierre_ins();
drop function if exists public.tarifario_trg_cierre_upd();
drop function if exists public.tarifario_trg_cierre_del();
drop function if exists public.tarifario_cierre_general_aplicar(bigint[], boolean);
drop function if exists public.tarifario_fila_cerrada_general(bigint, text, text, text, date, date, integer, date);
drop function if exists public.tarifario_estadia_cerrada_general(bigint, text, text, date, integer);
notify pgrst, 'reload schema';
