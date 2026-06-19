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
