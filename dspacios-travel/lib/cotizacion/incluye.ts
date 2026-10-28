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

// Orden fijo de la propuesta: tiquetes, hotel, traslados/tours, otros servicios, asistencia médica. Las categorías ausentes simplemente no salen.
const ORDEN_CATEGORIA: Record<string, number> = { aereo: 0, hotel: 1, traslado: 2, tour: 2, asistencia: 4 };
const ORDEN_OTROS = 3;

// Construye una lista (una línea por servicio) a partir de los servicios.
export function sugerirIncluye(servicios: ServicioIncluye[]): string {
  const lineas: { orden: number; texto: string }[] = [];
  for (const s of servicios) {
    const nombre = (s.nombre || "").trim();
    const orden = ORDEN_CATEGORIA[s.tipo] ?? ORDEN_OTROS;
    switch (s.tipo) {
      case "aereo":
        lineas.push({ orden, texto: `Tiquetes aéreos${nombre ? ` (${nombre})` : ""}` });
        break;
      case "hotel":
        lineas.push({ orden, texto: `Alojamiento${nombre ? ` en ${nombre}` : ""}` });
        break;
      case "traslado":
        lineas.push({ orden, texto: `Traslados${nombre ? ` (${nombre})` : ""}` });
        break;
      case "asistencia":
        lineas.push({ orden, texto: `Asistencia médica${nombre ? ` (${nombre})` : ""}` });
        break;
      default:
        if (nombre) lineas.push({ orden, texto: nombre });
    }
  }
  // Orden estable por categoría y sin duplicados (ignora mayúsculas y espacios sobrantes).
  const vistos = new Set<string>();
  return lineas
    .map((l, i) => ({ ...l, i }))
    .sort((a, b) => a.orden - b.orden || a.i - b.i)
    .filter((l) => { const k = l.texto.toLowerCase().replace(/\s+/g, " "); if (vistos.has(k)) return false; vistos.add(k); return true; })
    .map((l) => l.texto)
    .join("\n");
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
  const tipoServicio = (categoria: unknown) => (categoria === "asistencia" ? "asistencia" : categoria === "tour_traslado" ? "tour" : "otro");
  for (const s of [...lista(p.serviciosIncluidos), ...lista(p.tours)]) servicios.push({ tipo: tipoServicio(s.categoria), nombre: texto(s.nombre) });
  for (const m of lista(p.manuales)) servicios.push({ tipo: m.clase === "vuelo" ? "aereo" : "otro", nombre: texto(m.nombre) });
  return sugerirIncluye(servicios);
}

/** Propuesta que generaba la versión anterior (orden de inserción, tours de traslado como «otro»): solo sirve para reconocer un texto guardado sin edición. */
function incluyeAntiguoCarrito(payload: unknown): string {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const lineas: string[] = [];
  for (const it of lista(p.items)) {
    const plan = [texto(it.categoria), texto(it.regimen ?? it.alimentacion)].filter(Boolean).join(", plan ");
    const nombre = texto(it.hotelNombre);
    if (nombre) lineas.push(`Alojamiento en ${plan ? `${nombre} (${plan})` : nombre}`);
  }
  for (const s of [...lista(p.serviciosIncluidos), ...lista(p.tours)]) {
    const nombre = texto(s.nombre);
    if (s.categoria === "asistencia") lineas.push(`Asistencia médica${nombre ? ` (${nombre})` : ""}`);
    else if (nombre) lineas.push(nombre);
  }
  for (const m of lista(p.manuales)) {
    const nombre = texto(m.nombre);
    if (m.clase === "vuelo") lineas.push(`Tiquetes aéreos${nombre ? ` (${nombre})` : ""}`);
    else if (nombre) lineas.push(nombre);
  }
  return [...new Set(lineas)].join("\n");
}

const normalizarTexto = (t: string) => t.replace(/\r\n/g, "\n").trim();

/**
 * «Incluye» para MOSTRAR una opción ya guardada: si el texto guardado es EXACTAMENTE lo que generaba el sistema antes (la propuesta de su snapshot, sin que un asesor
 * lo tocara), se muestra con el orden vigente; cualquier otro texto (editado, o vacío) se devuelve intacto. No escribe nada en la base.
 */
export function incluyeParaMostrar<T extends string | null | undefined>(guardado: T, payload: unknown): T | string {
  if (typeof guardado !== "string" || !guardado.trim()) return guardado;
  const antiguo = incluyeAntiguoCarrito(payload);
  return antiguo && normalizarTexto(guardado) === normalizarTexto(antiguo) ? sugerirIncluyeCarrito(payload) : guardado;
}
