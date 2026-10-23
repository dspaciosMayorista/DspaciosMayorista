// Filas del Excel de la DIAN → documentos normalizados.
//
// La DIAN publica el reporte de compras como tabla, y la forma de llegar a
// D'spacios es pegarla desde Excel (TSV), exportarla a CSV (separador `,` o `;`
// según el locale) o guardarla como HTML. Este módulo acepta las tres SIN
// ninguna dependencia: una hoja real (.xlsx) es un ZIP con XML dentro y abrirla
// necesita una librería, que sería una decisión del proyecto.
//
// Lo que el documento de diseño exige y este módulo cumple:
//
//   · NO asumir que las columnas son siempre las mismas. Se reconocen por
//     alias y se devuelve el mapa `columnas` que se usó, para que la bandeja
//     pueda mostrarlo.
//   · Si el encabezado no se reconoce, NO se inventa un mapeo: se devuelve
//     `ENCABEZADO_DESCONOCIDO` con las cabeceras que sí se leyeron.
//   · Una fila que no se puede convertir NO se descarta en silencio: va a
//     `rechazadas` con su número y el motivo.

import { claveTexto, normalizarCufe, normalizarFecha, normalizarMoneda, normalizarMonto, normalizarNit, pareceCufe, soloDigitos } from "./normalizar.ts";
import { problema, tieneErrores, type DocumentoDian, type FilaRechazada, type IdentidadDocumento, type ProblemaDian, type ResultadoLote, type TipoDocumento } from "./tipos.ts";

const TOL = 0.01;

type Alias = { campo: string; nombres: string[] };

// Alias por campo, con los nombres que usan los reportes REALES de la DIAN.
// No son inventados: salen de los dos reportes que descarga el usuario.
//
//  · Reporte de documentos electrónicos (ventas):
//    "Tipo de documento", "CUFE/CUDE", "Folio", "Prefijo", "Divisa",
//    "Forma de Pago", "Fecha Emisión", "NIT Emisor", "Nombre Emisor",
//    "IVA", "Rete IVA", "Total".
//  · Informe de facturas electrónicas ADQUIRIDAS (compras):
//    "Identificación Emisor Factura", "Nombre Emisor Factura", "Fecha Emisión",
//    "Valor Facturado", "Valor Notas Crédito", "Valor Notas Débito",
//    "Valor Factura / Afectada con Notas Débito - Crédito",
//    "Valor Susceptible Beneficio", "Medios De Pago", "Num_factura_venta",
//    "CUFE (Codigo único De Factura Electrónica)".
//
// `claveTexto` los deja comparables: sin tildes, en mayúsculas, y con la barra,
// el guion bajo o el "&" convertidos en espacio ("CUFE/CUDE" → "CUFE CUDE").
// El orden importa: gana el primer alias que coincide.
const ALIAS: Alias[] = [
  { campo: "cufe", nombres: ["CUFE CUDE", "CUFE CODIGO UNICO DE FACTURA ELECTRONICA", "CUFE", "CUDE", "UUID", "NUMERO CUFE", "ID DOCUMENTO DIAN"] },
  { campo: "nit", nombres: ["IDENTIFICACION EMISOR FACTURA", "NIT PROVEEDOR", "NIT EMISOR", "NIT ADQUIRENTE", "NIT TERCERO", "NIT", "NUMERO DE IDENTIFICACION", "IDENTIFICACION", "IDENTIFICACION TERCERO"] },
  { campo: "dv", nombres: ["DV", "D V", "DIGITO DE VERIFICACION", "DIGITO VERIFICACION"] },
  { campo: "fecha", nombres: ["FECHA DE EMISION", "FECHA EMISION", "FECHA FACTURA", "FECHA DOCUMENTO", "FECHA DE FACTURA", "FECHA"] },
  { campo: "numero", nombres: ["NUM FACTURA VENTA", "FOLIO", "NUMERO", "NO", "NUM", "NUMERO DE DOCUMENTO", "NUM DOCUMENTO", "NUMERO FACTURA", "NUM FACTURA"] },
  { campo: "prefijo", nombres: ["PREFIJO", "PREFIJO DOCUMENTO"] },
  { campo: "tipo", nombres: ["TIPO DE DOCUMENTO", "TIPO DOCUMENTO", "TIPO DOC", "DOCTIPO", "TIPO"] },
  { campo: "proveedor", nombres: ["NOMBRE EMISOR FACTURA", "NOMBRE PROVEEDOR", "NOMBRE EMISOR", "PROVEEDOR", "RAZON SOCIAL PROVEEDOR", "RAZON SOCIAL", "NOMBRE O RAZON SOCIAL", "TERCERO", "NOMBRE"] },
  { campo: "moneda", nombres: ["DIVISA", "MONEDA", "TIPO DE MONEDA"] },
  { campo: "trm", nombres: ["TRM", "TASA DE CAMBIO", "TRM APLICADA"] },
  { campo: "subtotal", nombres: ["VALOR SIN IMPUESTOS", "TOTAL PARCIAL", "SUBTOTAL", "VALOR BASE", "BASE", "BASE GRAVABLE"] },
  { campo: "descuento", nombres: ["DESCUENTO", "DESCUENTOS", "VALOR DESCUENTO"] },
  { campo: "impuesto", nombres: ["VALOR IVA", "VALOR IMPUESTO", "IMPUESTO", "IMPUESTOS", "IVA"] },
  { campo: "retencion", nombres: ["RETENCION", "RETEFUENTE", "VALOR RETENCION", "RETENCIONES", "RETE IVA"] },
  { campo: "total", nombres: ["VALOR TOTAL", "VALOR FACTURADO", "VALOR A PAGAR", "NETO A PAGAR", "TOTAL DOCUMENTO", "VALOR", "TOTAL"] },
  { campo: "formaPago", nombres: ["MEDIOS DE PAGO", "FORMA DE PAGO", "FORMA PAGO", "MEDIO DE PAGO", "CONDICION DE PAGO"] },
];

type Clave = (typeof ALIAS)[number]["campo"];

const CLAVES_RECONOCIDAS: Record<string, Clave> = (() => {
  const mapa: Record<string, Clave> = {};
  for (const a of ALIAS) for (const n of a.nombres) mapa[n] = a.campo;
  return mapa;
})();

/** Cuántos campos reconocidos tiene una fila de encabezados. Sirve para elegir la fila correcta. */
function puntuar(cabeceras: string[]): number {
  let n = 0;
  for (const c of cabeceras) if (CLAVES_RECONOCIDAS[claveTexto(c)]) n++;
  return n;
}

function mapaDeColumnas(cabeceras: string[]): Record<string, number> {
  const mapa: Record<string, number> = {};
  cabeceras.forEach((c, i) => {
    const clave = CLAVES_RECONOCIDAS[claveTexto(c)];
    if (!clave) return;
    // La primera columna gana: un encabezado repetido no debe reasignar el campo.
    if (mapa[clave] === undefined) mapa[clave] = i;
  });
  return mapa;
}

// ── Separación de filas/celdas ───────────────────────────────────────────────

/** ¿El texto viene de un Excel guardado como página web? */
function esHtml(texto: string): boolean {
  return /<table[\s>]/i.test(texto) && /<\/table>/i.test(texto);
}

/** Convierte una tabla HTML a filas de celdas, sin dependencias. */
function filasDeHtml(texto: string): string[][] {
  const filas: string[][] = [];
  const reFila = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let mFila: RegExpExecArray | null;
  while ((mFila = reFila.exec(texto)) !== null) {
    const celdas: string[] = [];
    const reCelda = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let mCelda: RegExpExecArray | null;
    while ((mCelda = reCelda.exec(mFila[1])) !== null) {
      celdas.push(
        mCelda[1]
          .replace(/<br\s*\/?>/gi, " ")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/&quot;/gi, '"')
          .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
          .replace(/\s+/g, " ")
          .trim()
      );
    }
    if (celdas.some((c) => c !== "")) filas.push(celdas);
  }
  return filas;
}

/** Divide una línea respecting comillas (CSV) o tabulaciones (TSV de Excel). */
function celdasDe(linea: string, separador: string | null): string[] {
  if (separador === null) return linea.split(/\t|\s{2,}/).map((c) => c.trim());

  const salida: string[] = [];
  let actual = "";
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (enComillas) {
      if (c === '"') {
        if (linea[i + 1] === '"') {
          actual += '"';
          i++;
        } else enComillas = false;
      } else actual += c;
      continue;
    }
    if (c === '"') {
      enComillas = true;
      continue;
    }
    if (c === separador) {
      salida.push(actual.trim());
      actual = "";
      continue;
    }
    actual += c;
  }
  salida.push(actual.trim());
  return salida;
}

function detectarSeparador(linea: string): string | null {
  const comas = (linea.match(/,/g) ?? []).length;
  const puntos = (linea.match(/;/g) ?? []).length;
  const tabs = (linea.match(/\t/g) ?? []).length;
  if (tabs > 0) return "\t";
  if (puntos > comas) return ";";
  if (comas > 0) return ",";
  return null;
}

function filasDeTexto(texto: string): string[][] {
  if (esHtml(texto)) return filasDeHtml(texto);
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lineas.length) return [];
  const separador = detectarSeparador(lineas[0]);
  return lineas.map((l) => celdasDe(l, separador));
}

// ── Fila → documento ─────────────────────────────────────────────────────────

function celda(celdas: string[], mapa: Record<string, number>, campo: Clave): string | null {
  const i = mapa[campo];
  if (i === undefined) return null;
  const v = celdas[i];
  if (v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function tipoDesdeTexto(valor: string | null): TipoDocumento | null {
  if (!valor) return null;
  const k = claveTexto(valor);
  if (/(FACTURA|FE|FACTURA DE VENTA|VENTA)/.test(k)) return "factura";
  if (/(NOTA\s*CREDITO|NC|CREDITO)/.test(k)) return "nota_credito";
  if (/(NOTA\s*DEBITO|ND|DEBITO)/.test(k)) return "nota_debito";
  return null;
}

function documentoDeFila(celdas: string[], mapa: Record<string, number>): { documento: DocumentoDian | null; problemas: ProblemaDian[] } {
  const problemas: ProblemaDian[] = [];

  // ── Proveedor ──
  const nitCrudo = celda(celdas, mapa, "nit");
  const dvCrudo = celda(celdas, mapa, "dv");
  const nitParseado = normalizarNit(nitCrudo);
  const nit = nitParseado?.nit ?? null;
  const dv = dvParseo(nitCrudo, dvCrudo);
  if (!nit) {
    problemas.push(problema("NIT_INVALIDO", "nit", `No se pudo leer un NIT válido (celda "${nitCrudo ?? "vacía"}").`));
  }

  const nombreProveedor = celda(celdas, mapa, "proveedor");
  const proveedor: IdentidadDocumento = {
    nit,
    dv,
    identificacion: nit,
    tipoIdentificacion: "NIT",
    nombre: nombreProveedor,
    pais: null,
  };

  // ── Fecha ──
  const fechaCruda = celda(celdas, mapa, "fecha");
  const fecha = normalizarFecha(fechaCruda);
  if (!fecha) {
    problemas.push(problema("FECHA_INVALIDA", "fecha", `No se pudo leer la fecha (celda "${fechaCruda ?? "vacía"}").`));
  }

  // ── Identificador ──
  const cufeCrudo = celda(celdas, mapa, "cufe");
  const tipoTexto = celda(celdas, mapa, "tipo");
  const tipo = tipoDesdeTexto(tipoTexto) ?? "factura";
  const esNota = tipo !== "factura";

  const idNormalizado = normalizarCufe(cufeCrudo);
  const hayCufe = idNormalizado !== null && pareceCufe(idNormalizado);
  if (!hayCufe && cufeCrudo) {
    problemas.push(
      problema("CUFE_INVALIDO", "cufe", `El identificador "${cufeCrudo}" no parece un CUFE/CUDE (largo ${idNormalizado?.length ?? 0}).`, "aviso")
    );
  }

  // ── Número ──
  const numeroCelda = celda(celdas, mapa, "numero");
  const prefijoCelda = celda(celdas, mapa, "prefijo");
  const numero = numeroCelda ? `${prefijoCelda ? `${prefijoCelda}-` : ""}${numeroCelda}` : null;
  if (!numero && !hayCufe) {
    problemas.push(problema("NUMERO_INVALIDO", "numero", "La fila no trae número de documento ni un CUFE utilizable.", "aviso"));
  }

  // ── Montos ──
  const totalCrudo = celda(celdas, mapa, "total");
  const total = normalizarMonto(totalCrudo);
  if (total === null) {
    problemas.push(problema("MONTO_INVALIDO", "total", `No se pudo leer el valor total (celda "${totalCrudo ?? "vacía"}").`));
  }

  const subtotal = normalizarMonto(celda(celdas, mapa, "subtotal"));
  const descuentos = normalizarMonto(celda(celdas, mapa, "descuento")) ?? 0;
  const impuesto = normalizarMonto(celda(celdas, mapa, "impuesto")) ?? 0;
  const retencion = normalizarMonto(celda(celdas, mapa, "retencion")) ?? 0;
  const cargos = 0;

  // Si el total vino y sí hay desglose, se compara; si no hay desglose (el Excel
  //DIAN a veces solo trae el total), no se inventa aritmética ni se avisa.
  const totalDeclarado = total ?? 0;
  const totalCalculado = Math.round((subtotal !== null ? subtotal - descuentos + cargos + impuesto - retencion : totalDeclarado) * 100) / 100;
  const diferencia = Math.round((totalDeclarado - totalCalculado) * 100) / 100;
  if (subtotal !== null && Math.abs(diferencia) > TOL) {
    problemas.push(
      problema(
        "TOTAL_NO_CUADRA",
        "total",
        `La fila declara ${totalDeclarado} pero sus desgloses suman ${totalCalculado} (diferencia ${diferencia}).`,
        "aviso"
      )
    );
  }

  // ── Moneda ──
  const monedaCruda = celda(celdas, mapa, "moneda");
  const moneda = normalizarMoneda(monedaCruda) ?? "COP";
  if (monedaCruda && !normalizarMoneda(monedaCruda)) {
    problemas.push(problema("MONEDA_INVALIDA", "moneda", `Moneda no reconocida ("${monedaCruda}"); se asume COP.`, "aviso"));
  }

  const documento: DocumentoDian = {
    cufe: hayCufe && !esNota ? idNormalizado : null,
    cude: hayCufe && esNota ? idNormalizado : null,
    tipoDocumento: tipo,
    numero,
    fecha: fecha ?? "",
    proveedor,
    // El Excel de compras no trae a quién se le compró: es D'spacios. Queda
    // explícito en vez de asumir el nombre del emisor.
    sujeto: { nit: null, dv: null, identificacion: null, tipoIdentificacion: null, nombre: null, pais: null },
    moneda,
    trm: moneda === "COP" ? null : normalizarMonto(celda(celdas, mapa, "trm")),
    // El Excel de la DIAN no trae la tasa de cambio: solo la columna TRM, que ya
    // se leyó arriba. Aquí no hay bloque de cambio del documento.
    divisa: null,
    aritmetica: {
      subtotal: subtotal ?? totalDeclarado,
      // El Excel de la DIAN no distingue la base gravable del total de líneas,
      // ni trae anticipos ni redondeo: se dejan en null / 0 para no inventar un
      // desglose que el documento no declara.
      baseGravable: subtotal,
      descuentos,
      cargos,
      anticipos: 0,
      redondeo: 0,
      impuestos: impuesto,
      retenciones: retencion,
      totalCalculado,
      totalDeclarado,
      diferencia,
    },
    impuestos: impuesto > 0 ? [{ codigo: "", nombre: null, tasa: null, base: subtotal ?? 0, valor: impuesto }] : [],
    retenciones: retencion > 0 ? [{ codigo: "", nombre: null, base: subtotal ?? 0, valor: retencion }] : [],
    formasPago: celda(celdas, mapa, "formaPago") ? [{ codigo: celda(celdas, mapa, "formaPago") ?? "", fecha: null, monto: null }] : [],
    lineas: [],
    software: null,
    xml: "",
    originales: {
      id: numero,
      uuid: cufeCrudo,
      referenciaInterna: null,
      otrosIdentificadores: [soloDigitos(nitCrudo)].filter(Boolean),
    },
  };

  return { documento, problemas };
}

/** El DV: primero la columna propia; si no está, el que venía pegado al NIT. */
function dvParseo(nitCrudo: string | null, dvCrudo: string | null): string | null {
  const deColumna = dvCrudo ? soloDigitos(dvCrudo) : "";
  if (deColumna.length === 1) return deColumna;
  const pegado = normalizarNit(nitCrudo)?.dv ?? null;
  return pegado;
}

// ── Entrada principal ────────────────────────────────────────────────────────

/**
 * Convierte el texto copiado del Excel de la DIAN en documentos normalizados.
 *
 * Devuelve SIEMPRE las tres listas: `documentos` (los que se pudieron leer sin
 * error), `rechazadas` (los que no, con su motivo) y `problemas` (los de la
 * cabecera/estructura). Nada se descarta en silencio.
 */
export function parseExcelDian(texto: string): ResultadoLote {
  const problemas: ProblemaDian[] = [];
  const filas = filasDeTexto(typeof texto === "string" ? texto : "");

  if (!filas.length) {
    return {
      columnas: null,
      cabecerasOriginales: [],
      documentos: [],
      rechazadas: [],
      problemas: [problema("FILA_SIN_COLUMNAS", "excel", "El texto no tiene ninguna fila con datos.")],
    };
  }

  // El encabezado puede estar LEJOS de la primera fila. El informe de facturas
  // adquiridas de la DIAN trae 13 filas de metadatos ("Año Gravable", "Doc
  // Identificacion Adq.", tres párrafos de advertencia, un link) antes de la
  // tabla. Mirar solo las primeras 6 filas lo pasaba por alto y devolvía
  // ENCABEZADO_DESCONOCIDO; se recorre el texto entero y gana la fila con más
  // columnas conocidas.
  let idxCabecera = -1;
  let mejorPuntaje = 0;
  filas.forEach((f, i) => {
    const p = puntuar(f);
    if (p > mejorPuntaje) {
      mejorPuntaje = p;
      idxCabecera = i;
    }
  });

  // Si ninguna fila lanzó un encabezado conocido, se reporta la PRIMERA fila
  // como los encabezados leídos: es lo que el usuario ve en su Excel y lo que
  // necesita para corregir la importación.
  const cabecerasOriginales = idxCabecera >= 0 ? filas[idxCabecera] : filas[0];
  const columnas = mapaDeColumnas(cabecerasOriginales);

  // OJO: el índice de columna 0 es FALSY. Comparar `!columnas.nit` rechazaba
  // justo los Excel donde el NIT es la primera columna, que es lo más común.
  if (!columnas || mejorPuntaje < 3 || columnas.nit === undefined || columnas.fecha === undefined) {
    problemas.push(
      problema(
        "ENCABEZADO_DESCONOCIDO",
        "excel",
        `No se reconoció el encabezado: la mejor fila tuvo ${mejorPuntaje} columna(s) conocida(s). Se necesita al menos NIT y FECHA. Encabezados leídos: ${JSON.stringify(cabecerasOriginales)}.`,
        "aviso"
      )
    );
    return { columnas, cabecerasOriginales, documentos: [], rechazadas: [], problemas };
  }

  const documentos: DocumentoDian[] = [];
  const rechazadas: FilaRechazada[] = [];

  for (let i = idxCabecera + 1; i < filas.length; i++) {
    const celdas = filas[i];
    const conValor = celdas.filter((c) => c !== "");
    // Fila totalmente vacía: nada que leer.
    if (conValor.length === 0) continue;
    // Fila de totales de Excel.
    if (/^(total|totales|suma)\b/i.test(celdas[0] ?? "")) continue;
    // Pies de los reportes de la DIAN: una sola celda con texto y sin datos
    // ("104 Facturas procesadas disponibles tomadas desde el Sistema de
    // Facturación DIAN"). Una fila con menos de dos celdas con contenido no
    // puede ser un documento: sin NIT y fecha no hay nada que leer, y contarla
    // como "rechazada" sería inventar un problema donde no lo hay.
    if (conValor.length < 2) continue;

    const { documento, problemas: pFila } = documentoDeFila(celdas, columnas);
    if (documento && !tieneErrores(pFila)) {
      documentos.push(documento);
      problemas.push(...pFila.filter((p) => p.severidad === "aviso").map((p) => ({ ...p, campo: `fila ${i - idxCabecera}.${p.campo}` })));
    } else {
      rechazadas.push({ indice: i - idxCabecera, celdas, problemas: pFila });
    }
  }

  return { columnas, cabecerasOriginales, documentos, rechazadas, problemas };
}
