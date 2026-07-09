// Parser PURO de las dos hojas históricas de la MINORISTA (D'spacios Travel S.A.S.):
//   1) "RELACIÓN DE UTILIDADES"  → ventas con costos (hotel/aéreo/traslados/asistencia/tours)
//   2) "RESUMEN DE PAGOS"        → titular/asesor/documento + abonos por cuota (hasta 13)
//
// El usuario PEGA el bloque copiado de Google Sheets: filas por salto de línea,
// columnas por TAB. También tolera el formato markdown "| a | b |" por si acaso.
// Cada función es pura (sin red ni DB) para poder probarla y mostrar vista previa.

export type FilaUtilidad = {
  numero: string;            // crudo, sin prefijo de tenant (00-0397)
  moneda: "COP" | "USD";
  precio_venta: number;
  fecha_venta: string | null; // YYYY-MM-DD
  fecha_salida: string | null;
  aerolinea: string | null;       // proveedor aéreo (columna 5)
  costo_aereo: number;
  hotel: string | null;           // no hay columna de "nombre del hotel" en esta hoja: se usa el proveedor del hotel también como nombre a mostrar
  hotelProveedor: string | null;  // proveedor/operador del hotel (columna 7)
  costo_hotel: number;
  receptivo: string | null;       // proveedor de traslados (columna 9)
  costo_receptivo: number;
  proveedorAsistencia: string | null; // columna 11
  costo_asistencia: number;
  proveedorTours: string | null;     // columna 13
  otros_costos: number;              // tours (columna 14)
};

export type AbonoImport = {
  fecha: string | null;
  valor: number;
  observacion: string | null;
};

export type FilaPago = {
  numero: string;             // crudo
  asesor: string | null;
  cliente: string | null;     // titular
  cliente_documento: string | null;
  fecha_venta: string | null;
  precio_venta: number | null;
  donde_ingreso: string | null;
  abonos: AbonoImport[];
};

export type ParseResult<T> = { filas: T[]; notas: string[] };

// ── utilidades de parseo ────────────────────────────────────────────────────

function dividirFilas(texto: string): string[] {
  return texto.split(/\r?\n/).filter((l) => l.trim() !== "");
}

// Divide una fila en celdas. Prioriza TAB (pegado de Sheets); si no hay tabs pero
// sí pipes "|", trata la fila como markdown (descarta el primer/último vacío).
function celdas(fila: string): string[] {
  if (fila.includes("\t")) return fila.split("\t").map((c) => c.trim());
  if (fila.includes("|")) {
    const partes = fila.split("|").map((c) => c.trim());
    if (partes.length && partes[0] === "") partes.shift();
    if (partes.length && partes[partes.length - 1] === "") partes.pop();
    return partes;
  }
  return [fila.trim()];
}

const MESES: Record<string, string> = {
  ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06",
  jul: "07", ago: "08", sep: "09", set: "09", oct: "10", nov: "11", dic: "12",
};

// Devuelve YYYY-MM-DD o null. Soporta dd/mm/yyyy, dd-mm-yy, "05 SEP 2023",
// "09 nov 2023" y yyyy-mm-dd. Rechaza lo que no sea una fecha plausible.
export function parseFechaEs(cel: string): string | null {
  const s = (cel ?? "").trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); // 2023-09-05
  if (m) {
    const mm = +m[2], dd = +m[3];
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }

  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/); // 05/09/2023 · 5-9-23
  if (m) {
    const dd = +m[1], mm = +m[2];
    let yy = +m[3];
    if (yy < 100) yy = yy < 50 ? 2000 + yy : 1900 + yy;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && yy >= 2015 && yy <= 2035)
      return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    return null;
  }

  m = s.match(/^(\d{1,2})\s+([A-Za-zÁ-úñÑ]{3,4})\.?\s+(\d{4})$/); // 05 SEP 2023
  if (m) {
    const mes = MESES[m[2].slice(0, 3).toLowerCase()];
    const dd = +m[1], yy = +m[3];
    if (mes && dd >= 1 && dd <= 31 && yy >= 2015 && yy <= 2035)
      return `${yy}-${mes}-${String(dd).padStart(2, "0")}`;
  }
  return null;
}

// Detecta la moneda de una celda de monto.
export function monedaDe(cel: string): "COP" | "USD" {
  return /usd|us\$/i.test(cel ?? "") ? "USD" : "COP";
}

// Monto en formato colombiano: "$ 3.197.000,00" / "COP 1.758.000" / "USD 6.566" /
// "-COP 1.749.000" / "1554000". Devuelve null si no hay número.
export function parseMontoCO(cel: string): number | null {
  let t = (cel ?? "").replace(/usd|us\$|cop|\$/gi, "").trim();
  // un "\-COP" del markdown deja un "\" → ya quitado por el char-class de abajo
  t = t.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(t)) return null;
  const neg = t.trim().startsWith("-");
  t = t.replace(/-/g, "");
  // colombiano: '.' miles, ',' decimales
  t = t.replace(/\./g, "").replace(",", ".");
  const v = parseFloat(t);
  if (!Number.isFinite(v)) return null;
  return neg ? -v : v;
}

const esSaltoOAnulado = (s: string) => /salto|anulad|correlativo/i.test(s);

// ── 1) RELACIÓN DE UTILIDADES → ventas ──────────────────────────────────────
// Orden de columnas (las que importan) — hoja 2026, un PROVEEDOR + COSTO por
// categoría:
// 0 MES · 1 N° RESERVA · 2 FECHA RESERVA · 3 FECHA VIAJE · 4 VALOR VENTA ·
// 5 PROVEEDOR AEREO · 6 COSTO TIQUETES · 7 PROVEEDOR HOTEL · 8 COSTO HOTEL ·
// 9 PROVEEDOR TRASLADOS · 10 COSTO TRASLADOS · 11 PROVEEDOR ASISTENCIA ·
// 12 COSTO ASISTENCIA · 13 PROVEEDOR TOURS · 14 COSTO TOURS ...
export function parseUtilidades(texto: string): ParseResult<FilaUtilidad> {
  const filas: FilaUtilidad[] = [];
  const notas: string[] = [];
  const reNum = /^\d{1,3}-\d{2,5}$/;

  for (const linea of dividirFilas(texto)) {
    const c = celdas(linea);
    if (c.length < 5) continue;
    const numero = c[1]?.trim();
    if (!numero || !reNum.test(numero)) {
      if (/n[°º]?\s*reserva/i.test(linea) || /relacion de utilidades/i.test(linea)) continue; // cabecera
      continue;
    }
    const restoTxt = c.slice(2).join(" ");
    if (esSaltoOAnulado(restoTxt) && !parseMontoCO(c[4] ?? "")) {
      notas.push(`${numero}: omitido (saltado/anulado).`);
      continue;
    }
    const precio = parseMontoCO(c[4] ?? "");
    if (precio == null || precio <= 0) {
      notas.push(`${numero}: sin valor de venta, omitido.`);
      continue;
    }
    const proveedorHotel = (c[7] ?? "").trim() || null;
    filas.push({
      numero,
      moneda: monedaDe(c[4] ?? ""),
      precio_venta: precio,
      fecha_venta: parseFechaEs(c[2] ?? ""),
      fecha_salida: parseFechaEs(c[3] ?? ""),
      aerolinea: (c[5] ?? "").trim() || null,
      costo_aereo: parseMontoCO(c[6] ?? "") ?? 0,
      hotel: proveedorHotel, // no hay columna de nombre del hotel en esta hoja
      hotelProveedor: proveedorHotel,
      costo_hotel: parseMontoCO(c[8] ?? "") ?? 0,
      receptivo: (c[9] ?? "").trim() || null,
      costo_receptivo: parseMontoCO(c[10] ?? "") ?? 0,
      proveedorAsistencia: (c[11] ?? "").trim() || null,
      costo_asistencia: parseMontoCO(c[12] ?? "") ?? 0,
      proveedorTours: (c[13] ?? "").trim() || null,
      otros_costos: parseMontoCO(c[14] ?? "") ?? 0,
    });
  }
  return { filas, notas };
}

// ── 2) RESUMEN DE PAGOS → cliente/asesor + abonos ───────────────────────────
// 0 N° RESERVA · 1 VENDEDOR · 2 TITULAR · 3 DOCUMENTO · 4 FECHA VENTA ·
// 5 VALOR RESERVA · luego pares (FECHA, VALOR) por cuota (hasta 13) ·
// penúltima = SALDO RESTANTE · última = DONDE INGRESÓ EL DINERO.
export function parsePagos(texto: string): ParseResult<FilaPago> {
  const filas: FilaPago[] = [];
  const notas: string[] = [];
  const reNum = /^\d{1,3}-\d{2,5}$/;

  for (const linea of dividirFilas(texto)) {
    const c = celdas(linea);
    if (c.length < 6) continue;
    const numero = c[0]?.trim();
    if (!numero || !reNum.test(numero)) continue; // salta cabeceras

    const titular = (c[2] ?? "").trim();
    if (esSaltoOAnulado(titular) || (!titular && esSaltoOAnulado(linea))) {
      notas.push(`${numero}: omitido (saltado/anulado).`);
      continue;
    }

    // La última celda suele ser "DONDE INGRESÓ" (texto). Si lo es, los pares de
    // cuotas terminan 2 celdas antes (la previa es el SALDO RESTANTE).
    const ultima = (c[c.length - 1] ?? "").trim();
    const ultimaEsTexto = ultima !== "" && parseMontoCO(ultima) == null && !parseFechaEs(ultima);
    const donde = ultimaEsTexto ? ultima : null;
    const finPares = ultimaEsTexto ? c.length - 2 : c.length;

    const abonos: AbonoImport[] = [];
    for (let i = 6; i + 1 < finPares; i += 2) {
      const celFecha = (c[i] ?? "").trim();
      const celValor = (c[i + 1] ?? "").trim();
      if (!celFecha && !celValor) continue;
      // valor que en realidad es una fecha (error de captura) → no es un abono.
      // Un monto nunca lleva "/", así que cualquier celda con "/" se descarta.
      if (celValor && (celValor.includes("/") || parseFechaEs(celValor))) {
        notas.push(`${numero}: cuota con valor inválido "${celValor}", omitida.`);
        continue;
      }
      const val = parseMontoCO(celValor);
      if (val == null || val === 0) continue;
      if (val < 0) {
        notas.push(`${numero}: abono negativo ${celValor} (reembolso/ajuste), omitido.`);
        continue;
      }
      const fecha = parseFechaEs(celFecha);
      // si la celda de fecha es una anotación de texto, se guarda como observación
      const obs = !fecha && celFecha ? celFecha : null;
      abonos.push({ fecha, valor: val, observacion: obs });
    }

    filas.push({
      numero,
      asesor: (c[1] ?? "").trim() || null,
      cliente: titular || null,
      cliente_documento: (c[3] ?? "").trim() || null,
      fecha_venta: parseFechaEs(c[4] ?? ""),
      precio_venta: parseMontoCO(c[5] ?? ""),
      donde_ingreso: donde,
      abonos,
    });
  }
  return { filas, notas };
}
