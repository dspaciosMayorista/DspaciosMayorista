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
 * Igual que `recalcularVinculosPorEdad`, pero con una fecha de referencia
 * DISTINTA por fila — revisión de B10 bajo el modelo de B13 (ronda 5):
 * `ConvertirCarritoBtn.tsx` ya no puede usar una única fecha conservadora
 * para todo el carrito (`fechaMasTemprana`), porque desde B13 cada pasajero
 * solo termina de verdad en el/los contrato(s) de los ítems a los que está
 * asignado — la fecha correcta para clasificarlo es la más temprana ENTRE
 * ESOS ítems (`fechaReferenciaPorPasajero` en `carritoAsignaciones.ts`), no
 * la del carrito completo (que podía bloquear un vínculo válido por un ítem
 * en el que la persona ni siquiera viaja). El responsable de un infante se
 * evalúa con SU PROPIA fecha de referencia — en la práctica coincide con la
 * del infante (ambos deben compartir grupo, ver `comparteGrupo`), pero se
 * usa la suya por si difiere momentáneamente mientras la asignación por
 * ítem todavía se está editando.
 */
export function recalcularVinculosPorEdadPorFila<T extends FilaConFechaYResponsable>(
  filas: readonly T[],
  fechasReferenciaPorFila: readonly (string | null)[]
): T[] {
  const esInfanteArr = filas.map((f, i) => esInfantePorEdad(f.fechaNacimiento, fechasReferenciaPorFila[i] ?? null));
  return filas.map((f, i) => {
    const actual = f.responsableIndex ?? null;
    let siguiente = actual;
    if (!esInfanteArr[i]) {
      siguiente = null;
    } else if (actual != null) {
      const filaResp = filas[actual] as T | undefined;
      const edadResp = filaResp ? calcularEdad(filaResp.fechaNacimiento, fechasReferenciaPorFila[actual] ?? null) : null;
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

/** Motivo por el que un vínculo INF→responsable de un contrato es inválido — mismo criterio que el trigger `fn_validar_responsable_infante` (migración 167). */
export type MotivoResponsableInvalido =
  | "infante_sin_responsable"   // es_infante true, responsable_id null (y no exento)
  | "indice_fuera_de_rango"     // el responsable señalado no existe en el contrato
  | "autorreferencia"           // responsable_id = id (un pasajero no es su propio responsable)
  | "responsable_es_infante"    // el responsable es, a su vez, un infante
  | "responsable_no_adulto";    // el responsable no es mayor de edad (≥18) a la fecha de salida (un CHD no puede responder)

export type ResultadoValidacionResponsables =
  | { ok: true }
  | { ok: false; posicionLocal: number; responsableLocal: number | null; motivo: MotivoResponsableInvalido };

/**
 * Valida los vínculos INF→adulto responsable de UN contrato — B20 (ronda 8),
 * réplica EXACTA (del lado servidor/aplicación) del trigger SQL
 * `fn_validar_responsable_infante` (migración 167), que sigue siendo la
 * AUTORIDAD real. Se usa como PRE-validación de TODOS los grupos antes de
 * generar el primer número o escribir cualquier fila, para que un error
 * PREVISIBLE de responsable (llamada directa, estado obsoleto, payload
 * manipulado — NO se depende de la UI) se rechace antes de crear nada, en vez
 * de tumbar el segundo contrato cuando el primero ya quedó escrito.
 *
 * `filas` son los pasajeros LOCALES de un contrato (ya reindexados a este
 * grupo: `responsableIndex` 0-based dentro de este mismo arreglo, o null).
 * `fechaContrato` es `ventas.fecha_salida` de ese contrato — la MISMA
 * referencia contra la que el RPC recalcula `es_infante` del registro y contra
 * la que el trigger mide la mayoría de edad del responsable (con respaldo a
 * "hoy" cuando el contrato no tiene fecha, igual que `coalesce(fecha_salida,
 * current_date)` en el trigger). Devuelve el PRIMER problema encontrado o
 * `{ ok: true }`.
 *
 * Reglas (todas las que el trigger impone dentro de un mismo contrato):
 *   - todo infante REAL a `fechaContrato` debe traer responsable;
 *   - el índice debe ser entero, existir en el contrato y no ser el propio pasajero;
 *   - el responsable no puede ser, a su vez, infante;
 *   - el responsable debe ser mayor de edad (≥18) a `fechaContrato` (un CHD no sirve).
 * La pertenencia del responsable AL MISMO contrato la resuelve el reindexado
 * previo (`reindexarGrupoLocal`): un responsable de otro contrato llega aquí
 * ya como `null` y se reporta como `infante_sin_responsable` — su caso
 * específico (cross-contrato) lo detecta el reindexado antes de llamar a esta
 * función.
 */
export function validarResponsablesContrato<T extends FilaConFechaYResponsable>(
  filas: readonly T[],
  fechaContrato: string | null
): ResultadoValidacionResponsables {
  // Referencia de edad del RESPONSABLE: la fecha del contrato, o "hoy" si no
  // hay (idéntico a `coalesce(v.fecha_salida, current_date)` del trigger). Solo
  // es alcanzable cuando hay un infante, lo que ya exige una fecha válida.
  const refAdulto = fechaContrato ?? new Date().toISOString().slice(0, 10);
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    // La condición de infante se mide contra `fechaContrato` tal cual (sin el
    // respaldo a hoy): con `fechaContrato` null, `esInfantePorEdad` es false —
    // igual que `es_infante` recalculado por el RPC sobre una fecha nula.
    if (!esInfantePorEdad(f.fechaNacimiento, fechaContrato)) continue;
    const r = f.responsableIndex ?? null;
    if (r == null) return { ok: false, posicionLocal: i, responsableLocal: null, motivo: "infante_sin_responsable" };
    if (!Number.isInteger(r) || r < 0 || r >= filas.length) {
      return { ok: false, posicionLocal: i, responsableLocal: null, motivo: "indice_fuera_de_rango" };
    }
    if (r === i) return { ok: false, posicionLocal: i, responsableLocal: r, motivo: "autorreferencia" };
    const resp = filas[r];
    if (esInfantePorEdad(resp.fechaNacimiento, fechaContrato)) {
      return { ok: false, posicionLocal: i, responsableLocal: r, motivo: "responsable_es_infante" };
    }
    const edadResp = calcularEdad(resp.fechaNacimiento, refAdulto);
    if (edadResp == null || edadResp < EDAD_ADULTO_RESPONSABLE) {
      return { ok: false, posicionLocal: i, responsableLocal: r, motivo: "responsable_no_adulto" };
    }
  }
  return { ok: true };
}
