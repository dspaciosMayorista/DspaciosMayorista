-- Tras crear los usuarios de la revisión (GoTrue): enlaza cada aliado con su ficha del catálogo y deja a «Local Venta» como asesor de los contratos sembrados.
\set ON_ERROR_STOP 1
update public.usuarios set aliado_id = 9301 where email = 'aliado@local53.test';
update public.usuarios set aliado_id = 9302 where email = 'aliado2@local53.test';
