-- ROLLBACK de la 313 (#126-A, F3). Quita el envoltorio atómico y el disparador de moneda. NO toca la columna (eso es el rollback de la 312) ni ningún abono.
-- ⚠️ Hágase SOLO tras retirar del despliegue el código que llama a registrar_abono_moneda: sin la función, registrar un abono desde la app falla.
-- Tras el rollback, los abonos ya clasificados conservan su moneda_pago (la columna sigue), pero esa columna deja de ser inmutable.
drop function if exists public.registrar_abono_moneda(text, text, uuid, numeric, numeric, text, text, date, boolean, uuid, text);
drop trigger if exists trg_f313_abonos_moneda on public.abonos;
drop function if exists public.f313_abonos_moneda();
