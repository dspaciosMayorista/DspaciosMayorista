-- DESACTIVAR (reapertura). Como postgres. Atómico: restaura EXACTAMENTE pgrst.db_pre_request (nivel rol y base), reactiva SOLO los jobs que la
-- activación pausó, borra el hash y la lista de operadores. Repetirlo no cambia nada. Luego: verificar_mantenimiento.sql (debe dar «apagado»).
select mant_priv.desactivar();
