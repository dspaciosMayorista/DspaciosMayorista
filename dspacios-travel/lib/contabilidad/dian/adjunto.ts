// Apertura de `<AttachedDocument>`: el XML real de la factura viaja dentro del
// sobre, comprimido y en base64. Este módulo es el ÚNICO que usa `node:zlib`
// (el resto del parser es puro de strings), y está aparte para que las pruebas
// puedan ejercitar el resto del parser sin depender de compresión.
//
// La DIAN usa esta forma:
//
//   <AttachedDocument>
//     <cac:Attachment>
//       <cac:ExternalReference>
//         <cac:AttachmentBinaryData>  ← base64, a veces partido de línea
//         <cac:MimeCode>application/xml</cac:MimeCode>
//       </cac:ExternalReference>
//     </cac:Attachment>
//   </AttachedDocument>
//
// Dos formas de contenido, y solo dos:
//
//   1. base64 de un XML plano.
//   2. base64 de un XML comprimido con gzip.
//
// NO se acepta el XML en texto plano dentro de la etiqueta: el lector de XML
// trata `<Invoice>` como marcado, no como texto, así que "abrirlo en crudo" no
// es un caso que este lector pueda faithfully devolver. Quien tenga ese
// formato debe pasarle el XML directo a `parseFacturaXml`.
//
// Nunca se escribe nada: esto solo devuelve texto.

import { gunzipSync, inflateSync } from "node:zlib";
import { buscar, primero, textoPlano, type NodoXml } from "./xml.ts";
import { problema, type ProblemaDian } from "./tipos.ts";

export type FormaAdjunto = "base64" | "base64_gzip";

export type ResultadoAdjunto =
  | { ok: true; xml: string; forma: FormaAdjunto }
  | { ok: false; problemas: ProblemaDian[] };

/**
 * Abre el adjunto a partir del nodo `<AttachedDocument>` (o de cualquier
 * ancestro que lo contenga: la búsqueda es en todo el subárbol). Si no hay
 * adjunto, o el adjunto no es un XML de factura, devuelve el motivo exacto
 * para que la bandeja lo muestre en vez de tragarse el archivo.
 */
export function abrirAdjunto(raiz: NodoXml | null): ResultadoAdjunto {
  if (!raiz) {
    return { ok: false, problemas: [problema("ADJUNTO_AUSENTE", "AttachedDocument", "El documento no trae <AttachedDocument>.")] };
  }

  // El nodo recibido puede ser el propio <AttachedDocument> o cualquier
  // ancestro que lo contenga (el sobre completo, por ejemplo).
  const adjunto = raiz.tag === "AttachedDocument" ? raiz : primero(raiz, "AttachedDocument");
  if (!adjunto) {
    return { ok: false, problemas: [problema("ADJUNTO_AUSENTE", "AttachedDocument", "El documento no trae <AttachedDocument>.")] };
  }

  const nodos = buscar(adjunto, "AttachmentBinaryData");
  if (!nodos.length) {
    return {
      ok: false,
      problemas: [problema("ADJUNTO_VACIO", "AttachedDocument.AttachmentBinaryData", "El <AttachedDocument> no trae <AttachmentBinaryData>.")],
    };
  }

  // El base64 a veces viene partido en varios nodos (interlineado de la firma).
  // Concatenarlos es lo correcto; por eso se lee como texto y no como un solo
  // valor atómico.
  const bruto = nodos.map((n) => textoPlano(n)).join("").trim();
  if (!bruto) {
    return {
      ok: false,
      problemas: [problema("ADJUNTO_VACIO", "AttachedDocument.AttachmentBinaryData", "<AttachmentBinaryData> llegó vacío.")],
    };
  }

  // ── base64 ──
  const base64 = bruto.replace(/\s+/g, "");
  if (bruto.startsWith("<")) {
    return {
      ok: false,
      problemas: [
        problema(
          "ADJUNTO_INVALIDO",
          "AttachedDocument.AttachmentBinaryData",
          "El adjunto trae XML en crudo. La DIAN lo envía en base64: pásale el XML directo a parseFacturaXml."
        ),
      ],
    };
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    return {
      ok: false,
      problemas: [problema("ADJUNTO_INVALIDO", "AttachedDocument.AttachmentBinaryData", `El adjunto no es base64 válido (largo ${base64.length}).`)],
    };
  }

  let binario: Buffer;
  try {
    binario = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, problemas: [problema("ADJUNTO_INVALIDO", "AttachedDocument.AttachmentBinaryData", "No se pudo decodificar el base64.")] };
  }
  if (!binario.length) {
    return { ok: false, problemas: [problema("ADJUNTO_VACIO", "AttachedDocument.AttachmentBinaryData", "El base64 decodifica a cero bytes.")] };
  }

  // 0x1f 0x8b = gzip. 0x50 0x4b = "PK" = ZIP con estructura real.
  const esGzip = binario[0] === 0x1f && binario[1] === 0x8b;
  const esZip = binario[0] === 0x50 && binario[1] === 0x4b;

  if (esGzip) {
    let texto: string;
    try {
      texto = gunzipSync(binario).toString("utf8");
    } catch (e) {
      return {
        ok: false,
        problemas: [problema("ADJUNTO_INVALIDO", "AttachedDocument.AttachmentBinaryData", `El adjunto gzip no se pudo descomprimir: ${(e as Error).message}`)],
      };
    }
    const chequeo = pareceXmlFactura(texto);
    return chequeo.ok ? { ok: true, xml: texto, forma: "base64_gzip" } : { ok: false, problemas: chequeo.problemas };
  }

  if (esZip) {
    // ZIP con estructura ("PK\x03\x04", nombres de archivo dentro) no se puede
    // abrir sin una dependencia de descompresión, y esa es una decisión del
    // proyecto, no de este módulo. Se intenta primero deflate crudo por si
    // algún exportador lo Guarda sin cabecera.
    const texto = intentarInflate(binario);
    if (texto !== null) {
      const chequeo = pareceXmlFactura(texto);
      if (chequeo.ok) return { ok: true, xml: texto, forma: "base64_gzip" };
    }
    return {
      ok: false,
      problemas: [
        problema(
          "ADJUNTO_INVALIDO",
          "AttachedDocument.AttachmentBinaryData",
          "El adjunto parece un archivo ZIP. Abrirlo requiere una dependencia de descompresión que este módulo no usa: guárdalo aparte y pásalo ya descomprimido."
        ),
      ],
    };
  }

  // ── base64 de XML plano ──
  const texto = binario.toString("utf8");
  const chequeo = pareceXmlFactura(texto);
  return chequeo.ok
    ? { ok: true, xml: texto, forma: "base64" }
    : { ok: false, problemas: [problema("ADJUNTO_NO_ES_XML", "AttachedDocument.AttachmentBinaryData", "El adjunto decodificado no es un XML de factura.")] };
}

/** ¿El texto tiene una raíz de factura electrónica de la DIAN? */
export function pareceXmlFactura(texto: string): { ok: true } | { ok: false; problemas: ProblemaDian[] } {
  if (!/<\s*(?:\w+:)?(?:Invoice|CreditNote|DebitNote)\b/.test(texto)) {
    return {
      ok: false,
      problemas: [problema("ADJUNTO_NO_ES_XML", "AttachedDocument", "El texto no contiene una raíz Invoice / CreditNote / DebitNote.")],
    };
  }
  return { ok: true };
}

function intentarInflate(binario: Buffer): string | null {
  try {
    const texto = inflateSync(binario).toString("utf8");
    return pareceXmlFactura(texto).ok ? texto : null;
  } catch {
    return null;
  }
}
