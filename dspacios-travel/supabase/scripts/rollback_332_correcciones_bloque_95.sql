-- ROLLBACK 332 (correcciones del bloque #95/#61/#41/#42/#51/#33). Solo la corre el dueño.
-- Borra las dos funciones del plan de cobro. La aplicación desplegada con la 332 deja de poder regenerar el plan hasta redesplegar el código anterior: revertir el CÓDIGO primero.
-- duplicar_paquete_armado: para volver a la versión de la 331 se re-ejecuta su bloque CREATE OR REPLACE de supabase/migrations/20260601000331_duplicar_paquete_armado.sql (con WHEN OTHERS). Los datos no se tocan.
drop function if exists public.reemplazar_plan_cobro(text, jsonb, jsonb);
drop function if exists public.plan_cobro_fuentes(text);
