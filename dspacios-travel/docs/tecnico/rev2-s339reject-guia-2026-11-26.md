# S339-02 ampliado — pasos del dueño (rechazo y corrección de soportes)

La fuente ÚNICA de estos pasos es `supabase/scripts/revision_consolidada/pasos/35_soportes339.mjs` (S339-10 a S339-15): el ensayo los ejecuta con clics reales y `generar_guia.mjs` produce de ellos el texto del dueño (sección «Soportes de pago del aliado con cupo adicional»). Este archivo ya no duplica el texto para evitar divergencias.

Resumen: S339-10 el aliado sube 2 soportes reales a DTM-8310 · S339-11 gerencia rechaza con motivo obligatorio (archivo e historial se conservan; el asesor "venta" no puede rechazar) · S339-12 correo capturado en Mailpit (motivo + enlace, sin montos ni cliente) y recuadro rojo en el portal · S339-13 el aliado corrige (el mismo archivo rechazado no sirve) · S339-14 el equipo ve la corrección vigente y el rechazado con su historia · S339-15 cupo de DTM-8311: rechazar libera el cupo, la corrección no salta el tope y reemplazar siempre es la salida. Nada cambia pagos, saldos ni estado del contrato (cada paso lo comprueba).

Datos: `semillas/rev2/s339reject.sql` (DTM-8310 con 1 pago, DTM-8311 sin pagos, de la agencia aliada) y la migración 345 aplicadas en la base de ensayo/revisión.
No ensayado en navegador (solo por la prueba automática de base): el reintento del aviso cuando el correo no sale (requiere apagar la captura) y las 3 correcciones simultáneas.
