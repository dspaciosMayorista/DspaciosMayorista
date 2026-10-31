-- Continuación de test_258_cobertura_fixture.sql (misma transacción local, después del fixture): completa la evidencia que falta, tal como lo haría regenerar cada paquete,
-- para comprobar que la fila 12 converge a 0 faltantes y el resultado 2 pasa a APTO. Solo bases LOCALES desechables, dentro de begin ... rollback.
insert into public.tarifario_composicion_publicada (paquete_id, fecha_ida, generacion, regla, servicios_incluidos) values
 (9101, '2027-01-10', 3, 1, '[]'), (9101, '2027-01-17', 3, 1, '[]'),
 (9102, '2027-02-17', 5, 1, '[]');
update public.tarifario_composicion_publicada set generacion = 7 where paquete_id = 9104;
update public.tarifario_composicion_publicada set regla = 1 where paquete_id = 9105;
update public.tarifario_resultado set fecha_ida = '2027-06-10' where paquete_id = 9106;
insert into public.tarifario_composicion_publicada (paquete_id, fecha_ida, generacion, regla, servicios_incluidos) values (9106, '2027-06-10', 2, 1, '[]');
