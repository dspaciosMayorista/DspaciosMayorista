-- Ajuste de ENTORNO de la revisión local del #53 (solo LOCAL, ficticio).
-- Los contratos de ejemplo completos (COP, manual con acuerdo) y la cotización USD NO se siembran aquí: se crean con las ACCIONES REALES de la aplicación
-- mediante `ejemplos_local53.ts` (ver docs/tecnico/confirmacion-vencimiento-voucher-307.md). Un intento anterior de sembrar DTM-5304/DTM-5305 con INSERT directo
-- dejó contratos incompletos (sin ítems ni hotel; el documento imprimía USD 0) y se RETIRÓ.
\set ON_ERROR_STOP 1

-- Identidad fiscal SINTÉTICA de Mayorista solo para poder IMPRIMIR el documento del contrato en el entorno local: la base local trae la fila sin RNT y la app se NIEGA a generar el documento sin él
-- (a propósito: no imprime la identidad de otra agencia). Este valor es ficticio y vive solo en la base local; en Producción el RNT real ya está cargado en «Datos de la agencia».
update public.agencias set rnt = 'RNT-LOCAL-53-SINTETICO' where tenant = 'mayorista' and btrim(coalesce(rnt, '')) = '';
