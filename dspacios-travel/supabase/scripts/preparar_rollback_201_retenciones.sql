-- ───────────────────────────────────────────────────────────────────────────
-- PREPARAR un rollback TOTAL de la 201: retenciones en plazo SIN contrato.
-- Solo lectura. No corrige nada: cada fila la decide una persona, con el
-- código NUEVO todavía desplegado.
--
-- Antes que nada: ¿hace falta un rollback TOTAL? Para un problema del código
-- basta con volver a desplegar el código anterior sin tocar la base; con la
-- 201 puesta, el código anterior sí gestiona estas retenciones (asignar
-- contrato, editar el plazo, Borrar). El rollback total solo aplica si la
-- lógica de base de la 201 falla y no se puede corregir hacia adelante.
--
-- Por qué hay que resolverlas antes del rollback total: sin la 201 una
-- retención no recibe contrato, no cambia de estado ni la libera el cron; la
-- única salida sería "Borrar", perdiendo los datos del pasajero.
--
-- Vías REALES de resolución (lo que pasaría igual en la operación normal):
--   · VENTA REAL → "+ Contrato manual" con el número de esa venta. NUNCA una
--     referencia inventada para poder revertir: eso crearía un contrato ficticio.
--     Si el plazo venció, antes "Editar" y poner el plazo real acordado.
--   · LA PERSONA DESISTE o el plazo VENCIÓ sin venta → "Liberar" (vencida) o
--     "Borrar" (vigente). Los datos quedan en la auditoría y en este listado.
--   · VIGENTE SIN DECISIÓN TODAVÍA → no hay vía real: el rollback total espera
--     a que se decida o venza (o el dueño elige otra alternativa del informe).
-- Guardar el resultado ANTES de resolverlas. Después del rollback: debe dar 0.
-- ───────────────────────────────────────────────────────────────────────────
begin read only;

-- Resumen.
select count(*) as retenciones_sin_contrato,
       count(*) filter (where s.plazo < public.fecha_negocio(now())) as vencidas,
       count(*) filter (where s.plazo >= public.fecha_negocio(now())) as vigentes_por_decidir,
       count(*) filter (where s.plazo is null) as sin_plazo_inconsistentes,
       public.fecha_negocio(now()) as hoy_bogota
  from public.sillas s
 where s.estado = 'en_plazo' and s.numero_contrato is null and s.contrato_manual is null;

-- Detalle (lo que hay que decidir y conservar).
select b.record, b.ruta, b.fecha_ida, s.numero_silla, s.id as silla_id,
       s.pasajero_nombres, s.pasajero_apellidos, s.tipo_doc, s.numero_doc, s.nacimiento,
       s.asesor, s.agencia, s.hotel, s.acomodacion, s.plazo,
       case when s.plazo is null then 'INCONSISTENTE (sin plazo): revisar con quien la capturó'
            when s.plazo < public.fecha_negocio(now()) then 'VENCIDA: si hay venta real → Editar plazo + contrato real; si no → Liberar'
            else 'VIGENTE: si ya hay venta real → contrato real; si desiste → Borrar; si no se ha decidido → BLOQUEA el rollback total' end as como_resolver,
       s.updated_at
  from public.sillas s
  join public.bloqueos_vuelo b on b.id = s.bloqueo_id
 where s.estado = 'en_plazo' and s.numero_contrato is null and s.contrato_manual is null
 order by b.fecha_ida, b.record, s.numero_silla;

rollback;
