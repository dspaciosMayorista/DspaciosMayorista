// ─────────────────────────────────────────────────────────────────────────
// Qué salidas se guardan (§ "Salidas y precios", modo_precio = 'salida').
//
// `guardarSalidas` (actions.ts) filtraba filas con
//   s.etiqueta.trim() || s.fechaDesde || s.netoDoble != null
// — que solo mira TRES de los ~15 campos de una salida. Una fila con
// únicamente, por ejemplo, `tarifaSencilla` (§ tarifa comisionable,
// migración 151) o `netoTriple` se descartaba en silencio: el usuario la
// veía en pantalla, hacía clic en "Guardar", y desaparecía para siempre sin
// ningún error.
//
// `salidaTieneContenido` es la fuente única de verdad de "esta fila tiene
// algo que guardar": cualquier campo con contenido real la conserva: solo
// una fila TOTALMENTE vacía se descarta.
// ─────────────────────────────────────────────────────────────────────────

export type SalidaContenido = {
  etiqueta: string;
  fechaDesde: string;
  fechaHasta: string;
  noches: number | null;
  columna: string;
  netoSencilla: number | null;
  netoDoble: number | null;
  netoTriple: number | null;
  netoMultiple: number | null;
  netoNino: number | null;
  bajoSolicitud: boolean;
  tarifaSencilla: number | null;
  tarifaDoble: number | null;
  tarifaTriple: number | null;
  tarifaMultiple: number | null;
};

// Un campo de texto solo cuenta como contenido si tiene algo además de
// espacios — " " no es distinto de "" para efectos de guardar la fila.
const textoConContenido = (s: string) => s.trim() !== "";

// Un campo numérico cuenta como contenido si NO es null — 0 es un valor que
// el usuario escribió a propósito (ej. "Niño gratis"), no lo mismo que
// dejarlo en blanco. `num()`/`nOrNull()` en actions.ts ya convierten "" → null
// antes de llegar aquí, así que null es inequívocamente "no se tocó".
const numeroConContenido = (n: number | null) => n != null;

// ─────────────────────────────────────────────────────────────────────────
// Tarifas negativas — última barrera del lado app antes del CHECK de BD
// (`programa_salidas_tarifas_no_negativas_check`, migración 151). Se aplica
// sobre las filas YA convertidas a snake_case (después de `num()`), no sobre
// el payload crudo del navegador.
// ─────────────────────────────────────────────────────────────────────────

export type TarifasFilaDb = {
  tarifa_sencilla: number | null;
  tarifa_doble: number | null;
  tarifa_triple: number | null;
  tarifa_multiple: number | null;
};

export function tieneTarifaNegativa(filas: TarifasFilaDb[]): boolean {
  return filas.some((f) =>
    [f.tarifa_sencilla, f.tarifa_doble, f.tarifa_triple, f.tarifa_multiple].some((n) => n != null && n < 0)
  );
}

export function salidaTieneContenido(s: SalidaContenido): boolean {
  return (
    textoConContenido(s.etiqueta) ||
    textoConContenido(s.fechaDesde) ||
    textoConContenido(s.fechaHasta) ||
    textoConContenido(s.columna) ||
    numeroConContenido(s.noches) ||
    numeroConContenido(s.netoSencilla) ||
    numeroConContenido(s.netoDoble) ||
    numeroConContenido(s.netoTriple) ||
    numeroConContenido(s.netoMultiple) ||
    numeroConContenido(s.netoNino) ||
    numeroConContenido(s.tarifaSencilla) ||
    numeroConContenido(s.tarifaDoble) ||
    numeroConContenido(s.tarifaTriple) ||
    numeroConContenido(s.tarifaMultiple) ||
    // Un booleano en su valor por defecto (false) no es "contenido" — solo
    // marcarlo true (a solicitud, sin precio) lo es.
    s.bajoSolicitud === true
  );
}
