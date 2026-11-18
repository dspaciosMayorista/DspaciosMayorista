// #106 · Debounce mínimo y puro (sin React) para el buscador de texto de Gestión de contratos. Una llamada nueva REEMPLAZA a la pendiente
// (solo se ejecuta la última tras `ms` de calma); `cancelar()` descarta lo pendiente (desmontaje, Enter, cambio de otro filtro). Sin reintentos.
export type Debounce<A extends unknown[]> = { (...args: A): void; cancelar: () => void; pendiente: () => boolean };

export function crearDebounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounce<A> {
  let t: ReturnType<typeof setTimeout> | null = null;
  const d = ((...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  }) as Debounce<A>;
  d.cancelar = () => { if (t) clearTimeout(t); t = null; };
  d.pendiente = () => t !== null;
  return d;
}
