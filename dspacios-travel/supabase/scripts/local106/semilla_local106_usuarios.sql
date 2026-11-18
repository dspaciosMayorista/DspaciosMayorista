-- Tras crear los usuarios de la revisión (GoTrue): enlaza al aliado de prueba con su ficha del catálogo.
\set ON_ERROR_STOP 1
update public.usuarios set aliado_id = 9601 where email = 'aliado@local106.test';
