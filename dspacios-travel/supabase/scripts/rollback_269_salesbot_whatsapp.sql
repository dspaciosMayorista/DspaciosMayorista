-- Rollback de la 269: borra las tres tablas del canal WhatsApp de SalesBot (datos de sesiones y traspasos incluidos).
drop table if exists public.salesbot_wa_traspasos;
drop table if exists public.salesbot_wa_sesiones;
drop table if exists public.salesbot_wa_mensajes;
