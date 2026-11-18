-- Tras crear los ejemplos: enlaza cada usuario aliado con su ficha del catálogo (B2B por documento, migración 143) y deja a «Rev Venta» como asesor de los contratos sembrados.
\set ON_ERROR_STOP 1
update public.usuarios set aliado_id = 9301 where email = 'aliado@revision.test';
update public.usuarios set aliado_id = 9302 where email = 'aliado2@revision.test';
update public.usuarios set aliado_id = 9801 where email = 'aliado3@revision.test';
update public.usuarios set aliado_id = 9802 where email = 'aliado4@revision.test';
-- La cotización USD de #53 se deja ABIERTA para que quien revisa elija COP y escriba la TRM: su vigencia por defecto (1 día) vencería antes de la revisión.
update public.cotizaciones set vigencia_hasta = current_date + 60 where estado = 'abierta' and vigencia_hasta is not null;
