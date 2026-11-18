-- Ajustes de ENTORNO de la revisión consolidada (solo LOCAL, ficticios). Se aplican antes de crear los ejemplos con las acciones reales.
\set ON_ERROR_STOP 1
-- Identidad fiscal SINTÉTICA de Mayorista solo para poder IMPRIMIR el documento del contrato (la app se niega a generarlo sin RNT; en Producción el RNT real ya está cargado).
update public.agencias set rnt = 'RNT-REVISION-SINTETICO' where tenant = 'mayorista' and btrim(coalesce(rnt, '')) = '';
update public.agencias set rnt = 'RNT-REVISION-MIN-SINTETICO' where tenant = 'minorista' and btrim(coalesce(rnt, '')) = '';
-- Asesores que los ejemplos y el CRM usan como «asesor interno».
insert into public.asesores (nombre, email, rol, activo) values ('Rev Venta', 'venta@revision.test', 'venta', true), ('Rev Venta Dos', 'venta2@revision.test', 'venta', true) on conflict do nothing;
