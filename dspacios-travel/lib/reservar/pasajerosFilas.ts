// ─────────────────────────────────────────────────────────────────────────
// Operaciones PURAS sobre arreglos de pasajeros con vínculo de responsable
// (`responsableIndex`: posición 0-based, dentro del MISMO arreglo, del
// adulto que responde por un infante) — compartidas por los 4 formularios
// que capturan pasajeros (`ReservaForm.tsx`, `NuevoContratoForm.tsx`,
// `ProgramaReservaForm.tsx`, `EditarAsesorPasajeros.tsx`).
//
// Revisión de alto riesgo (B7/B8, ronda 3): antes de este módulo, cada
// formulario que quitaba/truncaba filas o recalculaba edades lo hacía con su
// propia lógica inline (o, en el caso de `NuevoContratoForm.tsx`, con NINGUNA
// lógica — un `filter()` plano que dejaba `responsableIndex` intacto,
// apuntando a la posición equivocada tras el corrimiento de índices, o
// directamente a otra persona). Y ningún formulario limpiaba el vínculo
// cuando un cambio de fecha (de nacimiento o de salida) hacía que un
// infante dejara de serlo, o que su responsable dejara de ser mayor de
// edad — el campo quedaba "vivo" en el estado/payload, invisible en la UI
// (el selector desaparece), y el servidor lo rechazaba sin que el usuario
// pudiera limpiarlo desde la pantalla.
//
// Estas funciones son la ÚNICA fuente de verdad para las tres operaciones
// que pueden dejar un `responsableIndex` apuntando a la fila equivocada, a
// nadie, o a alguien que el servidor va a rechazar:
//   - quitarPasajero:  eliminar UNA fila puntual (botón "Quitar").
//   - truncarPasajeros: recortar el arreglo a una longitud N (formularios
//     donde la cantidad de filas se deriva de otro campo — total de pax,
//     habitaciones — nunca de un botón "Quitar" puntual).
//   - recalcularVinculosPorEdad: releer TODAS las filas contra la fecha de
//     referencia vigente (fecha de salida) cada vez que cambia CUALQUIER
//     fecha relevante (la propia fecha de nacimiento de una fila, o la
//     fecha de salida del viaje) y corregir cualquier vínculo que el
//     servidor ya no aceptaría.
// ─────────────────────────────────────────────────────────────────────────
import { calcularEdad } from "../utils.ts";
import { esInfantePorEdad } from "./pasajeros.ts";

/** Edad mínima (años cumplidos) para poder ser responsable de un infante — mismo umbral que exige el trigger SQL (migración 167). */
export const EDAD_ADULTO_RESPONSABLE = 18;

export type FilaConResponsable = {
  responsableIndex?: number | null;
};

export type FilaConFechaYResponsable = FilaConResponsable & {
  fechaNacimiento: string;
};

/**
 * Elimina la fila en `index` (botón "Quitar" puntual). Cualquier OTRA fila
 * que apuntara exactamente a la fila quitada queda sin vínculo (`null`,
 * nunca se reasigna a otra persona en su lugar); las que apuntaban a una
 * posición posterior se decrementan en 1 para seguir señalando a la misma
 * persona tras el corrimiento de índices; las que apuntaban a una posición
 * anterior quedan intactas.
 */
export function quitarPasajero<T extends FilaConResponsable>(filas: readonly T[], index: number): T[] {
  return filas
    .filter((_, i) => i !== index)
    .map((f) => {
      const r = f.responsableIndex;
      if (r == null) return f;
      if (r === index) return { ...f, responsableIndex: null };
      if (r > index) return { ...f, responsableIndex: r - 1 };
      return f;
    });
}

/**
 * Recorta el arreglo a `nuevaLongitud` filas (siempre desde el final —
 * usado por los formularios donde la cantidad de pasajeros se deriva de
 * otro campo: total de pax, habitaciones). A diferencia de `quitarPasajero`,
 * las filas que SOBREVIVEN no se reindexan (sus posiciones 0..nuevaLongitud-1
 * no cambian) — solo se limpia el vínculo de cualquier fila sobreviviente
 * que apuntaba a una posición ahora fuera de rango (recortada).
 */
export function truncarPasajeros<T extends FilaConResponsable>(filas: readonly T[], nuevaLongitud: number): T[] {
  const n = Math.max(0, nuevaLongitud);
  return filas.slice(0, n).map((f) => {
    const r = f.responsableIndex;
    if (r == null || r < n) return f;
    return { ...f, responsableIndex: null };
  });
}

/**
 * Releer TODAS las filas contra `fechaReferencia` (fecha de salida) y
 * corregir cualquier vínculo que el servidor ya no aceptaría — se llama
 * cada vez que cambia una fecha de nacimiento o la propia fecha de
 * referencia:
 *   - Si la fila DEJA de ser infante (por su propia fecha de nacimiento),
 *     ya no debe pedir/tener responsable → se limpia su `responsableIndex`.
 *   - Si la fila sigue siendo infante pero el pasajero al que apuntaba como
 *     responsable YA NO es mayor de edad real (≥18) a la fecha de
 *     referencia — o esa posición ya no existe — el vínculo se invalida
 *     (`null`), nunca se deja apuntando a alguien que el trigger rechazaría.
 *   - Un vínculo que sigue siendo válido (la fila sigue infante Y su
 *     responsable sigue siendo adulto) se conserva tal cual.
 * Pura: no muta `filas`, devuelve un arreglo nuevo (con las mismas
 * referencias de objeto para las filas que no cambiaron).
 */
export function recalcularVinculosPorEdad<T extends FilaConFechaYResponsable>(
  filas: readonly T[],
  fechaReferencia: string | null
): T[] {
  const edades = filas.map((f) => calcularEdad(f.fechaNacimiento, fechaReferencia));
  const esInfanteArr = filas.map((f) => esInfantePorEdad(f.fechaNacimiento, fechaReferencia));
  return filas.map((f, i) => {
    const actual = f.responsableIndex ?? null;
    let siguiente = actual;
    if (!esInfanteArr[i]) {
      siguiente = null;
    } else if (actual != null) {
      const edadResp = edades[actual];
      if (actual === i || edadResp == null || edadResp < EDAD_ADULTO_RESPONSABLE) siguiente = null;
    }
    return siguiente === actual ? f : { ...f, responsableIndex: siguiente };
  });
}

/**
 * Normaliza `responsableIndex` contra la fecha REAL de UN grupo/contrato
 * específico — revisión de alto riesgo, ronda 3 (B10): a diferencia de
 * `recalcularVinculosPorEdad` (pensada para la UI, reactiva a cambios del
 * formulario), esta función es la que corre en el SERVIDOR, justo antes de
 * enviar el payload de cada grupo al RPC, en flujos donde la UI no puede
 * conocer de antemano la fecha real de cada contrato (`convertirCotizacion
 * Carrito`: un carrito puede agrupar destinos/fechas distintas, y la UI solo
 * puede mostrar una tabla ÚNICA de pasajeros usando una fecha de referencia
 * conservadora — ver `fechaMasTemprana` en ConvertirCarritoBtn.tsx).
 *
 * Como la edad de un pasajero solo AVANZA con una fecha de referencia mayor
 * (nunca retrocede), un pasajero que la UI marcó como infante contra una
 * fecha temprana puede haber dejado de serlo para la fecha real, MÁS
 * TARDÍA, de un grupo en particular — nunca al revés (si la UI ya lo
 * consideró NO infante contra la fecha más temprana posible, tampoco lo será
 * contra ninguna fecha real posterior). Por eso esta función solo tiene una
 * dirección posible: LIMPIAR un `responsableIndex` que dejó de tener sentido
 * para este grupo — nunca necesita agregar uno nuevo (si el pasajero SIGUE
 * siendo infante para este grupo y no trae vínculo, el RPC lo rechaza con su
 * propio mensaje claro, igual que rechazaría la falta de vínculo en
 * cualquier otro flujo de creación).
 *
 * Por el mismo motivo — la edad de un RESPONSABLE (validado como ≥18 contra
 * la fecha más temprana posible) nunca puede retroceder por debajo de 18
 * contra una fecha real posterior — un vínculo cuyo responsable ya calificó
 * en la UI sigue calificando para cualquier grupo real; no hace falta
 * volver a validar esa mitad aquí.
 */
export function normalizarResponsablesPorGrupo<T extends FilaConFechaYResponsable>(
  filas: readonly T[],
  fechaReferenciaGrupo: string | null
): T[] {
  return filas.map((f) => {
    if (f.responsableIndex == null) return f;
    return esInfantePorEdad(f.fechaNacimiento, fechaReferenciaGrupo) ? f : { ...f, responsableIndex: null };
  });
}
