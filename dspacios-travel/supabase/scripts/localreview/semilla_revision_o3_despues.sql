-- O3 (revisión consolidada): tras publicar el tarifario de «CARTAGENA O3» con la acción real, estos hoteles quedan como hoteles «heredados» sin la configuración de edades obligatoria
-- (un hotel nuevo ya no puede guardarse así: la app y la migración 311 lo impiden). Solo LOCAL, datos sintéticos.
\set ON_ERROR_STOP 1
update public.hoteles set edad_infante_min = null, edad_infante_max = null, edad_nino_min = null, edad_nino_max = null where id in (10302, 10305);
update public.hoteles set edad_infante_min = 0, edad_infante_max = 5, edad_nino_min = 6, edad_nino_max = 3 where id = 10304;
