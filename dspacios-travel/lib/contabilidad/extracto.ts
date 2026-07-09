// Parser PURO del extracto bancario pegado (Bancolombia y similares).
// Toma el texto copiado del Excel: filas por salto de línea, columnas por tab o
// 2+ espacios. Detecta fecha, descripción, valor (con signo) y saldo, y deriva el
// periodo (YYYY-MM). El año puede no venir en cada fila (formato "2/03") → se usa
// el año indicado o el de la cabecera DESDE/HASTA si aparece en el texto.

export type LineaExtracto = {
  fecha: string;        // YYYY-MM-DD
  descripcion: string;
  valor: number;        // con signo (+ abono / − cargo)
  saldo: number | null;
  periodo: string;      // YYYY-MM
};

const num = (s: string): number | null => {
  // formato US del extracto: 2,300,000.00 → quitar comas, el . es decimal
  const u = s.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!/[0-9]/.test(u)) return null;
  const v = parseFloat(u);
  return Number.isFinite(v) ? v : null;
};

function anioDeCabecera(texto: string): number | null {
  const m = texto.match(/\b(20\d{2})[/-](\d{1,2})[/-](\d{1,2})\b/);
  return m ? Number(m[1]) : null;
}

function parseFecha(cel: string, anio: number): string | null {
  let m = cel.match(/^\s*(20\d{2})[/-](\d{1,2})[/-](\d{1,2})\s*$/); // 2026/03/02
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = cel.match(/^\s*(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\s*$/);  // 2/03 o 02/03/2026
  if (m) {
    const dd = m[1].padStart(2, "0"); const mm = m[2].padStart(2, "0");
    const yy = m[3] ? Number(m[3]) : anio;
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) return `${yy}-${mm}-${dd}`;
  }
  return null;
}

export function parseExtracto(texto: string, anioDefault?: number): { lineas: LineaExtracto[]; periodos: string[] } {
  const anioHdr = anioDeCabecera(texto) ?? anioDefault ?? new Date().getFullYear();
  const filas = texto.split(/\r?\n/);
  const lineas: LineaExtracto[] = [];

  for (const fila of filas) {
    if (!fila.trim()) continue;
    const celdas = fila.split(/\t|\s{2,}/).map((c) => c.trim()).filter((c) => c !== "");
    if (celdas.length < 2) continue;

    // fecha = primera celda que parsee como fecha
    let fecha: string | null = null, idxFecha = -1;
    for (let i = 0; i < celdas.length; i++) {
      const f = parseFecha(celdas[i], anioHdr);
      if (f) { fecha = f; idxFecha = i; break; }
    }
    if (!fecha) continue;

    // celdas numéricas (montos): las dos últimas suelen ser VALOR y SALDO.
    // Exige punto decimal (el banco siempre exporta montos con 2 decimales,
    // ej. "2,300,000.00") — así se descarta cualquier columna extra de puros
    // dígitos (número de cuenta, referencia, etc.) sin importar su posición:
    // esas nunca traen decimales, un monto siempre sí.
    const numericas: { i: number; v: number }[] = [];
    for (let i = idxFecha + 1; i < celdas.length; i++) {
      if (/^-?[\d,]*\.\d+$/.test(celdas[i])) {
        const v = num(celdas[i]);
        if (v != null) numericas.push({ i, v });
      }
    }
    if (numericas.length === 0) continue;
    let valor: number, saldo: number | null = null;
    if (numericas.length >= 2) { valor = numericas[numericas.length - 2].v; saldo = numericas[numericas.length - 1].v; }
    else { valor = numericas[0].v; }
    if (!valor) continue;

    // descripción = celdas de texto entre la fecha y el primer número
    const primerNum = numericas[0].i;
    const desc = celdas.slice(idxFecha + 1, primerNum).filter((c) => !/^-?[\d.,]+$/.test(c)).join(" ").trim()
      || celdas.filter((c, i) => i > idxFecha && !/^-?[\d.,]+$/.test(c)).join(" ").trim();

    lineas.push({ fecha, descripcion: desc, valor, saldo, periodo: fecha.slice(0, 7) });
  }

  const periodos = Array.from(new Set(lineas.map((l) => l.periodo))).sort();
  return { lineas, periodos };
}
