// Sugerencias de "Incluye / No incluye" para la cotización dinámica.
// Función PURA: la usa el formulario (cliente) y la acción (servidor) para
// proponer un texto editable a partir de los servicios elegidos.

export type ServicioIncluye = { tipo: string; nombre?: string | null };

// Texto por defecto de "No incluye" (editable por el asesor).
export const NO_INCLUYE_DEFAULT = [
  "Gastos no especificados en el plan",
  "Alimentación y bebidas no descritas",
  "Tours y actividades opcionales",
  "Propinas y gastos personales",
].join("\n");

// Construye una lista (una línea por servicio) a partir de los servicios.
export function sugerirIncluye(servicios: ServicioIncluye[]): string {
  const lineas: string[] = [];
  for (const s of servicios) {
    const nombre = (s.nombre || "").trim();
    switch (s.tipo) {
      case "aereo":
        lineas.push(`Tiquetes aéreos${nombre ? ` (${nombre})` : ""}`);
        break;
      case "hotel":
        lineas.push(`Alojamiento${nombre ? ` en ${nombre}` : ""}`);
        break;
      case "traslado":
        lineas.push(`Traslados${nombre ? ` (${nombre})` : ""}`);
        break;
      case "asistencia":
        lineas.push(`Asistencia médica${nombre ? ` (${nombre})` : ""}`);
        break;
      default:
        if (nombre) lineas.push(nombre);
    }
  }
  // Quita duplicados conservando el orden.
  return [...new Set(lineas)].join("\n");
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const lista = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : []);

/**
 * Propuesta de «Incluye» para UNA opción de carrito, SOLO con lo que su snapshot cotizó (`payload`): el hotel con su categoría y plan, los servicios
 * incluidos del paquete, los servicios adicionales y los vuelos/servicios manuales. Nada que el payload no traiga. El asesor la edita antes de generar.
 */
export function sugerirIncluyeCarrito(payload: unknown): string {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const servicios: ServicioIncluye[] = [];
  for (const it of lista(p.items)) {
    const plan = [texto(it.categoria), texto(it.regimen ?? it.alimentacion)].filter(Boolean).join(", plan ");
    const nombre = texto(it.hotelNombre);
    if (nombre) servicios.push({ tipo: "hotel", nombre: plan ? `${nombre} (${plan})` : nombre });
  }
  const tipoServicio = (categoria: unknown) => (categoria === "asistencia" ? "asistencia" : "otro");
  for (const s of [...lista(p.serviciosIncluidos), ...lista(p.tours)]) servicios.push({ tipo: tipoServicio(s.categoria), nombre: texto(s.nombre) });
  for (const m of lista(p.manuales)) servicios.push({ tipo: m.clase === "vuelo" ? "aereo" : "otro", nombre: texto(m.nombre) });
  return sugerirIncluye(servicios);
}
