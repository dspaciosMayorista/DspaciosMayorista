// ─────────────────────────────────────────────────────────────────────────
// Qué cuentas por pagar FALTAN para un contrato, dados los costos ya
// registrados en `ventas` y las CxP que ya existen — decisión PURA, sin
// Supabase (el I/O vive en `asegurarCuentasPorPagar`, reservar/actions.ts).
//
// Defecto real corregido (revisión del PR #294): la regla anterior era
// "¿existe alguna CxP con este tipo_proveedor?" — una comparación por
// EXISTENCIA de etiqueta, no por DINERO. Los servicios de un contrato se
// reparten en TRES tipos de proveedor (`receptivo` para tour/traslado,
// `asistencia`, `otro`) según la categoría del catálogo, pero su costo se
// acumula ENTERO en una sola columna (`ventas.costo_receptivo`). Con la regla
// vieja bastaba que la categoría del servicio no fuera `tour_traslado` para
// que la CxP quedara etiquetada `asistencia`/`otro`, y entonces
// `!yaTiene.has("receptivo") && costo_receptivo > 0` volvía a crear una
// SEGUNDA cuenta por el MISMO dinero (y su segundo asiento contable) — se
// dispara solo, al confirmar la venta.
//
// Ahora la cobertura se mide en PESOS: las CxP de los tres tipos de servicio
// forman UNA bolsa que se descuenta contra las tres columnas de costo de
// servicio. Solo se crea fila por el FALTANTE real, nunca por el total ya
// cubierto. Hotel y aéreo conservan su regla de existencia (su costo y su
// tipo sí se corresponden 1:1, y cambiarlo alteraría contratos donde
// contabilidad editó el valor a mano).
//
// Import relativo (no `@/…`) a propósito: se importa DIRECTO desde
// `node --test` sin bundler, igual que `serviciosPaquete.ts`.
// ─────────────────────────────────────────────────────────────────────────

// Los tres tipos de proveedor que puede producir un SERVICIO del paquete
// (ver `tipoProveedorCxpServicio` en serviciosPaquete.ts). Comparten bolsa de
// cobertura porque comparten columnas de costo.
export const TIPOS_CXP_SERVICIO = ["receptivo", "asistencia", "otro"] as const;
export type TipoCxpServicio = (typeof TIPOS_CXP_SERVICIO)[number];
export type TipoCxp = "hotel" | "aereo" | TipoCxpServicio;

export type CxpExistente = { tipo_proveedor: string | null; valor_total: number | null };

export type CostosContrato = {
  costo_hotel: number;
  costo_aereo: number;
  costo_receptivo: number;
  costo_asistencia: number;
  otros_costos: number;
};

export type FaltanteCxP = { tipo: TipoCxp; valor: number };

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Devuelve qué CxP faltan por crear y por CUÁNTO.
 *
 * - `hotel`/`aereo`: por existencia (si ya hay una fila de ese tipo no se
 *   agrega nada, sin importar el monto — contabilidad puede haber ajustado
 *   el valor a mano y no debe aparecer un "complemento" fantasma).
 * - servicios (`receptivo`/`asistencia`/`otro`): por MONTO. Todo lo ya
 *   registrado en esos tres tipos se descuenta, en orden, de las tres
 *   columnas de costo de servicio; solo se emite fila por lo que quede
 *   descubierto. Con esto, un contrato creado por Reservar (donde cada
 *   servicio ya trae su propia CxP y su costo está sumado en
 *   `costo_receptivo`) queda con faltante 0 y NO se duplica.
 */
export function faltantesCxP(existentes: readonly CxpExistente[], costos: CostosContrato): FaltanteCxP[] {
  const out: FaltanteCxP[] = [];
  const tipos = new Set((existentes ?? []).map((r) => r.tipo_proveedor).filter(Boolean) as string[]);

  const costoHotel = num(costos.costo_hotel);
  const costoAereo = num(costos.costo_aereo);
  if (!tipos.has("hotel") && costoHotel > 0) out.push({ tipo: "hotel", valor: costoHotel });
  if (!tipos.has("aereo") && costoAereo > 0) out.push({ tipo: "aereo", valor: costoAereo });

  // Bolsa de servicios: suma en pesos de TODAS las CxP de los tres tipos.
  // Los valores negativos o no numéricos se ignoran (nunca "descubren" costo).
  let cubierto = 0;
  for (const r of existentes ?? []) {
    const t = r.tipo_proveedor;
    if (!t || !(TIPOS_CXP_SERVICIO as readonly string[]).includes(t)) continue;
    cubierto += Math.max(0, num(r.valor_total));
  }

  // Se consume la cobertura en un orden fijo y declarado (receptivo →
  // asistencia → otro). El orden importa solo para etiquetar el remanente
  // cuando la cobertura es parcial; el TOTAL emitido es el mismo en
  // cualquier orden (Σ costos − cobertura).
  const columnas: { tipo: TipoCxpServicio; costo: number }[] = [
    { tipo: "receptivo", costo: num(costos.costo_receptivo) },
    { tipo: "asistencia", costo: num(costos.costo_asistencia) },
    { tipo: "otro", costo: num(costos.otros_costos) },
  ];
  for (const c of columnas) {
    if (!(c.costo > 0)) continue;
    const falta = c.costo - cubierto;
    cubierto = Math.max(0, cubierto - c.costo);
    if (falta > 0) out.push({ tipo: c.tipo, valor: falta });
  }
  return out;
}

// ── Reconciliación de CxP de SERVICIOS al editar un contrato ───────────────
//
// Cuando se cambia la selección de servicios de un contrato pendiente
// (`actualizarServiciosContrato`), el contrato y sus obligaciones contables
// tienen que quedar diciendo lo mismo. La llave del emparejamiento es
// `cuentas_por_pagar.servicio_id` (migración 170) — NUNCA el nombre (dos
// servicios pueden llamarse igual y el texto se edita) ni `tipo_proveedor`
// (tres categorías comparten tres etiquetas y hotel/aéreo viven en la misma
// tabla).
//
// Una CxP con `servicio_id = null` (hotel, aéreo, cargada a mano, o anterior
// a la 170) NUNCA se toca: no hay forma de saber si pertenece a un servicio y
// adivinarlo sería exactamente el emparejamiento frágil que se eliminó.

export type CxpServicioExistente = {
  id: number;
  servicio_id: number | null;
  valor_total: number | null;
  /** La CxP ya tiene pagos o retenciones practicadas → no se puede eliminar. */
  tieneMovimientos: boolean;
};

export type ServicioObjetivo = {
  servicioId: number;
  nombre: string;
  costoNeto: number;
  tipoProveedor: string;
  proveedor: string | null;
  aplicaRetencion: boolean;
  pctRetencion: number;
};

export type PlanCxpServicios = {
  insertar: ServicioObjetivo[];
  actualizar: { id: number; servicioId: number; valor: number; nombre: string; tipoProveedor: string; proveedor: string | null }[];
  eliminar: { id: number; servicioId: number }[];
  /** Servicios quitados cuya CxP YA tiene dinero movido: la edición debe
   *  rechazarse completa (nunca se borra una obligación ya pagada, ni se deja
   *  el contrato sin el servicio pero con la cuenta viva). */
  bloqueados: { id: number; servicioId: number }[];
};

export function planReconciliacionCxpServicios(
  existentes: readonly CxpServicioExistente[],
  objetivo: readonly ServicioObjetivo[]
): PlanCxpServicios {
  const plan: PlanCxpServicios = { insertar: [], actualizar: [], eliminar: [], bloqueados: [] };

  // Solo participan las filas que SÍ declaran de qué servicio vienen.
  const porServicio = new Map<number, CxpServicioExistente>();
  for (const e of existentes ?? []) {
    if (e.servicio_id == null) continue;
    // Si por alguna razón hubiera dos filas del mismo servicio, gana la
    // primera y la otra se trata como sobrante a eliminar (o bloquear).
    const previa = porServicio.get(e.servicio_id);
    if (!previa) porServicio.set(e.servicio_id, e);
    else if (e.tieneMovimientos) plan.bloqueados.push({ id: e.id, servicioId: e.servicio_id });
    else plan.eliminar.push({ id: e.id, servicioId: e.servicio_id });
  }

  const objetivoIds = new Set<number>();
  for (const o of objetivo ?? []) {
    objetivoIds.add(o.servicioId);
    const actual = porServicio.get(o.servicioId);
    if (!actual) {
      // Solo se crea CxP por un costo real (> 0): una cuenta en $0 no es una
      // obligación, es ruido en cartera de proveedores.
      if (o.costoNeto > 0) plan.insertar.push(o);
      continue;
    }
    const valorActual = Number(actual.valor_total) || 0;
    if (o.costoNeto > 0 && valorActual !== o.costoNeto) {
      plan.actualizar.push({
        id: actual.id, servicioId: o.servicioId, valor: o.costoNeto,
        nombre: o.nombre, tipoProveedor: o.tipoProveedor, proveedor: o.proveedor,
      });
    } else if (!(o.costoNeto > 0)) {
      // El servicio sigue seleccionado pero ya no tiene costo: la cuenta
      // sobra. Mismo candado que un servicio quitado.
      if (actual.tieneMovimientos) plan.bloqueados.push({ id: actual.id, servicioId: o.servicioId });
      else plan.eliminar.push({ id: actual.id, servicioId: o.servicioId });
    }
  }

  for (const [servicioId, e] of porServicio) {
    if (objetivoIds.has(servicioId)) continue;
    if (e.tieneMovimientos) plan.bloqueados.push({ id: e.id, servicioId });
    else plan.eliminar.push({ id: e.id, servicioId });
  }
  return plan;
}
