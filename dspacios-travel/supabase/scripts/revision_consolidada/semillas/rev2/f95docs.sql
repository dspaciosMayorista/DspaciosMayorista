-- REV2 f95docs — no necesita semilla. Los pasos B95-02, B95-18, B95-19 y B95-20 CREAN sus datos con las pantallas (reserva, comparativa, elección de opción, pago previo, conversión): una fila
-- sembrada a mano taparía justo lo que se prueba (el documento del contrato convertido). Solo hace falta el paquete «B95 Porción terrestre — Hotel Mar» y el catálogo de la semilla 20_bloque95.sql
-- (hotel «Hotel Mar B95», «Hotel Duplicado B95», servicios «Asistencia médica B95» y «Traslado aeropuerto B95»), que ya están en la base de revisión. Idempotente y sin efectos: solo lectura.
select 1 as sin_semilla_requerida;
