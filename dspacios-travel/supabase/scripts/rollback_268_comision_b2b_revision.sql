-- Rollback de la 268: borra la tabla de retención. NO toca aliados_b2b ni comision_b2b_pagos.
-- ⚠️ Si #415 ya está desplegado, quitar la tabla lo deja FALLANDO CERRADO (sin comisión en el portal): revertir primero el código, o recrear la tabla vacía.
-- ⚠️ Quitarla (o vaciarla) VUELVE A EXPONER las diez filas con su ficha actual, que es la incorrecta.
drop table if exists public.comision_b2b_revision;
