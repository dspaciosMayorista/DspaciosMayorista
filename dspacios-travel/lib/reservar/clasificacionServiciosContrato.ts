// #51 (B95-2, R2-2) — qué obligaciones de servicio de un contrato PENDIENTE son editables (opcionales elegidos) y cuáles se conservan (incluidas del paquete).
// Módulo PURO. La clasificación NO se infiere solo del catálogo vivo (`armado_servicios.incluido`), que se puede editar después de reservar: un servicio incluido que el
// paquete luego reclasifica como opcional, o que se quita del paquete, dejaría de verse como «incluido» y su obligación y su costo se borrarían en la siguiente edición.
// La prueba de que un servicio fue un OPCIONAL elegido está en el propio contrato: su línea «Servicio · {nombre}» en `contrato_items`. Sin esa línea la obligación se CONSERVA:
// nunca se borra dinero previsto por una suposición.
//
// R2-2: la NUEVA selección jamás vuelve editable una obligación histórica (antes `objetivoIds.has(sid)` lo hacía: elegir como opcional un servicio que el paquete había
// reclasificado reescribía 40.000 → 10.000). Si el servicio elegido ya tiene una obligación conservada, es un solapamiento ambiguo y se devuelve en `conflictos` para
// que la edición se rechace completa. Además la línea del contrato no guarda el id del servicio, solo el nombre: un nombre solo libera una obligación si identifica sin
// ambigüedad (una línea por obligación y ningún otro servicio del paquete con ese nombre); si no, se conserva.

import { leerLineaServicio } from "../contrato/serviciosDocumento.ts";

export type ObligacionServicio = {
  id: number;
  servicio_id: number | null;
  valor_total: number | null;
  tieneMovimientos: boolean;
  /** Nombre y tipo de proveedor tal como quedaron guardados en la obligación (CxP o prevista). */
  servicio: string | null;
  tipo_proveedor: string | null;
};

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Cuántas líneas «Servicio · …» del contrato llevan cada nombre normalizado (la línea no guarda el id del servicio: solo el nombre). */
export function nombresOpcionalesDelContrato(descripcionesItems: readonly (string | null | undefined)[]): Map<string, number> {
  const out = new Map<string, number>();
  const sumar = (n: string) => out.set(n, (out.get(n) ?? 0) + 1);
  for (const d of descripcionesItems) {
    const l = typeof d === "string" ? leerLineaServicio(d) : null;
    if (!l?.nombre) continue;
    const completo = norm(l.nombre);
    sumar(completo);
    // Los traslados por alcance llevan el alcance pegado al nombre: «Nombre (Aeropuerto - Hotel)».
    const base = norm(l.nombre.replace(/\s*\([^)]*\)\s*$/, ""));
    if (base !== completo) sumar(base);
  }
  return out;
}

export type ClasificacionServicios = {
  /** Participan del plan de reconciliación (se pueden actualizar o eliminar). */
  editables: ObligacionServicio[];
  /** Se conservan intactas (su costo sigue sumando en las columnas de costo). */
  conservadas: ObligacionServicio[];
  /**
   * Servicios de la NUEVA selección que ya tienen una obligación conservada (incluida, o sin prueba de haber sido opcional). Agregarlos como opcionales duplicaría esa obligación
   * y su cobro: la edición completa debe rechazarse. Nunca se resuelve en silencio.
   */
  conflictos: ObligacionServicio[];
};

export function clasificarObligacionesServicio(args: {
  existentes: readonly ObligacionServicio[];
  /** IDs de servicio que el catálogo marca hoy como incluidos (solo refuerza: nunca vuelve editable lo que el contrato no muestra como opcional). */
  incluidosCatalogo: ReadonlySet<number>;
  /** IDs de la nueva selección de opcionales. NO vuelve editable ninguna obligación: solo sirve para detectar el solapamiento (`conflictos`). */
  objetivoIds: ReadonlySet<number>;
  descripcionesItems: readonly (string | null | undefined)[];
  /** id → nombre de TODOS los servicios del paquete hoy (incluidos u opcionales). Un nombre repetido entre ids distintos no prueba identidad: la obligación se conserva. */
  catalogoNombres?: ReadonlyMap<number, string | null>;
}): ClasificacionServicios {
  const opcionales = nombresOpcionalesDelContrato(args.descripcionesItems);
  // Cuántas obligaciones del contrato llevan el mismo nombre: más obligaciones que líneas = el nombre no dice cuál fue el opcional.
  const obligacionesPorNombre = new Map<string, number>();
  for (const e of args.existentes) if (e.servicio_id != null) { const n = norm(e.servicio); obligacionesPorNombre.set(n, (obligacionesPorNombre.get(n) ?? 0) + 1); }
  const nombreEnOtroServicio = (sid: number, nombre: string) => {
    for (const [id, n] of args.catalogoNombres ?? []) if (id !== sid && norm(n) === nombre) return true;
    return false;
  };
  const editables: ObligacionServicio[] = [];
  const conservadas: ObligacionServicio[] = [];
  for (const e of args.existentes) {
    if (e.servicio_id == null) { editables.push(e); continue; } // sin servicio_id el plan ya no la toca (mismo comportamiento de siempre)
    const sid = Number(e.servicio_id);
    if (args.incluidosCatalogo.has(sid)) { conservadas.push(e); continue; }
    const nombre = norm(e.servicio);
    const lineas = opcionales.get(nombre) ?? 0;
    // Solo se libera por nombre cuando el nombre identifica sin ambigüedad.
    const eraOpcional = lineas > 0 && (obligacionesPorNombre.get(nombre) ?? 0) <= lineas && !nombreEnOtroServicio(sid, nombre);
    if (eraOpcional) editables.push(e);
    else conservadas.push(e);
  }
  const conflictos = conservadas.filter((e) => e.servicio_id != null && args.objetivoIds.has(Number(e.servicio_id)));
  return { editables, conservadas, conflictos };
}

/** Categoría para el resumen del contrato a partir del tipo de proveedor guardado en la obligación. */
export function categoriaDesdeTipoProveedor(tipo: string | null | undefined): "asistencia" | "tour_traslado" | "otro" {
  if (tipo === "asistencia") return "asistencia";
  if (tipo === "receptivo") return "tour_traslado";
  return "otro";
}
