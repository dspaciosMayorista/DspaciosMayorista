// Pago adicional: si lo abonado ya cubre el total a cobrar, un abono más es un excedente que solo se registra tras una
// confirmación explícita. La decisión la toma la BASE bajo el bloqueo de la venta (RPC `registrar_abono`, migración
// 248), no la pantalla ni la Server Action: así dos solicitudes simultáneas no se saltan la confirmación. Este módulo
// solo da forma al aviso que se le muestra a quien registra.

export type DatosExcedente = { contrato: string; total: number; pagado: number; nuevo: number; moneda: "COP" | "USD" };

export const mensajeExcedente = (d: DatosExcedente) =>
  `El contrato ${d.contrato} ya está pagado: total ${d.total} ${d.moneda}, pagado ${d.pagado} ${d.moneda}. ` +
  `Confirma si el nuevo abono de ${d.nuevo} ${d.moneda} es un pago adicional intencional.`;
