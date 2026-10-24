-- 232 · ROLLBACK. SOLO COMO DECISIÓN EXCEPCIONAL Y EXPLÍCITA DEL DUEÑO. NO es el paso siguiente a una FALLA.
--
-- Ante una FALLA de preflight/postcheck o un error al aplicar la 232: detenerse y diagnosticar; este script no
-- corrige nada, solo devuelve a `anon` INSERT, UPDATE, DELETE y TRUNCATE sobre cxp_pagos y retenciones_cxp
-- (el estado previo por DEFAULT PRIVILEGES de Supabase). Eso reabre el hueco de #109, incluido TRUNCATE, que
-- no pasa por RLS. La RLS sigue negando a `anon` las filas, pero deja de haber una segunda barrera.
-- Úsese únicamente si se confirma, con evidencia, que alguna ruta legítima escribía como anon (la auditoría de
-- #109 no encontró ninguna) y dejando constancia escrita de la decisión.
begin;
grant insert, update, delete, truncate on table public.cxp_pagos       to anon;
grant insert, update, delete, truncate on table public.retenciones_cxp to anon;
commit;
