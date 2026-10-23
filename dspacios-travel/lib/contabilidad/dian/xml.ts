// Lector de XML MÍNIMO y PURO, sin dependencias.
//
// Existe porque el XML de la DIAN (UBL 2.1) viene con prefijo de namespace en
// casi todas las etiquetas (`cbc:PayableAmount`, `cac:AccountingSupplierParty`,
// `ext:UBLExtensions`) y los prefijos cambian entre versiones y entre
// proveedores de software. Por eso el lector guarda el nombre LOCAL de la
// etiqueta y las búsquedas ignoran el namespace: así el resto del módulo no
// depende de con qué prefijo bautizó el emisor cada elemento.
//
// No valida contra el esquema de la DIAN (para eso no hay bibliografía real
// todavía) y no resuelve entidades externas ni DTD: solo lee lo que viene en el
// texto. Es un lector estructural, no un parser de XML completo — y a
// propósito: una dependencia de XML sería una decisión del proyecto, no de este
// módulo aislado.

import { problema, type ProblemaDian } from "./tipos.ts";

export type NodoXml = {
  /** Nombre local de la etiqueta, sin prefijo ni namespace ("PayableAmount"). */
  tag: string;
  /** Atributos indexados por nombre local ("SchemeID", "currencyID"). */
  attrs: Record<string, string>;
  children: NodoXml[];
  /** Texto que aparece directamente dentro de la etiqueta, sin los descendientes. */
  text: string;
};

export type ResultadoXml = { ok: true; raiz: NodoXml } | { ok: false; problemas: ProblemaDian[] };

/** "cbc:PayableAmount" → "PayableAmount". */
function nombreLocal(nombre: string): string {
  const i = nombre.lastIndexOf(":");
  return (i === -1 ? nombre : nombre.slice(i + 1)).trim();
}

function parseAtributos(cuerpo: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // name="value" | name='value' — el valor nunca lleva comillas dobles adentro
  // en los XML de la DIAN, pero se acepta la entidad &quot;.
  const re = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cuerpo)) !== null) {
    const valor = (m[3] !== undefined ? m[3] : m[4] ?? "").replace(/&quot;/g, '"');
    attrs[nombreLocal(m[1])] = valor;
  }
  return attrs;
}

/**
 * Lee el XML y devuelve la raíz. Ante cualquier desbalance de etiquetas,
 * comillas sin cerrar o contenido vacío devuelve el error con el detalle, en
 * lugar de devolver un árbol a medias que después produciría campos inventados.
 */
export function parseXml(texto: string): ResultadoXml {
  if (typeof texto !== "string" || !texto.trim()) {
    return { ok: false, problemas: [problema("XML_VACIO", "xml", "El texto recibido está vacío.")] };
  }
  // Un sobre SOAP con solo el contenido es válido para este lector: nos
  // interesa el documento, no el sobre. Pero si no hay ninguna etiqueta se
  // reporta igual.
  if (!/<[A-Za-z_]/.test(texto)) {
    return { ok: false, problemas: [problema("XML_VACIO", "xml", "El texto no contiene ninguna etiqueta XML.")] };
  }

  const problemas: ProblemaDian[] = [];
  const pila: NodoXml[] = [];
  let raiz: NodoXml | null = null;
  let textoAcumulado = "";
  let i = 0;

  const cerrarTexto = () => {
    if (pila.length) pila[pila.length - 1].text += textoAcumulado;
    textoAcumulado = "";
  };

  while (i < texto.length) {
    const abre = texto.indexOf("<", i);

    if (abre === -1) {
      textoAcumulado += texto.slice(i);
      break;
    }
    if (abre > i) textoAcumulado += texto.slice(i, abre);
    i = abre;

    // ── Comentario ──
    if (texto.startsWith("<!--", i)) {
      const fin = texto.indexOf("-->", i + 4);
      if (fin === -1) return { ok: false, problemas: [...problemas, problema("XML_MAL_FORMADO", "xml", "Comentario sin cerrar.")] };
      i = fin + 3;
      continue;
    }

    // ── CDATA ──
    if (texto.startsWith("<![CDATA[", i)) {
      const fin = texto.indexOf("]]>", i + 9);
      if (fin === -1) return { ok: false, problemas: [...problemas, problema("XML_MAL_FORMADO", "xml", "CDATA sin cerrar.")] };
      textoAcumulado += texto.slice(i + 9, fin);
      i = fin + 3;
      continue;
    }

    // ── Declaración (<?xml …?>) o DOCTYPE ──
    if (texto.startsWith("<?", i)) {
      const fin = texto.indexOf("?>", i + 2);
      if (fin === -1) return { ok: false, problemas: [...problemas, problema("XML_MAL_FORMADO", "xml", "Declaración sin cerrar.")] };
      i = fin + 2;
      continue;
    }
    if (texto.startsWith("<!", i)) {
      const fin = texto.indexOf(">", i + 2);
      if (fin === -1) return { ok: false, problemas: [...problemas, problema("XML_MAL_FORMADO", "xml", "Declaración especial sin cerrar.")] };
      i = fin + 1;
      continue;
    }

    // ── Cierre de etiqueta ──
    if (texto.startsWith("</", i)) {
      const fin = texto.indexOf(">", i + 2);
      if (fin === -1) return { ok: false, problemas: [...problemas, problema("XML_MAL_FORMADO", "xml", `Cierre de etiqueta sin ">": ${texto.slice(i, i + 30)}`)] };
      const nombre = nombreLocal(texto.slice(i + 2, fin));
      cerrarTexto();
      const abierto = pila.pop();
      if (!abierto) {
        return { ok: false, problemas: [...problemas, problema("XML_MAL_FORMADO", "xml", `Cierre </${nombre}> sin etiqueta abierta.`)] };
      }
      if (abierto.tag !== nombre) {
        return {
          ok: false,
          problemas: [...problemas, problema("XML_MAL_FORMADO", "xml", `Se esperaba </${abierto.tag}> y llegó </${nombre}>.`)],
        };
      }
      if (!pila.length) raiz = abierto;
      i = fin + 1;
      continue;
    }

    // ── Apertura de etiqueta ──
    const fin = texto.indexOf(">", i + 1);
    if (fin === -1) return { ok: false, problemas: [...problemas, problema("XML_MAL_FORMADO", "xml", `Etiqueta sin ">": ${texto.slice(i, i + 30)}`)] };
    const cuerpo = texto.slice(i + 1, fin).trim();
    const autoCierra = cuerpo.endsWith("/");
    const sinCierre = autoCierra ? cuerpo.slice(0, -1).trim() : cuerpo;
    // El nombre de la etiqueta termina en el primer espacio: lo que sigue son
    // atributos (`xmlns:cbc="…"`), y no parte del nombre.
    const mNombre = sinCierre.match(/^([^\s/>]+)/);
    const crudo = mNombre ? mNombre[1] : "";
    const nombre = nombreLocal(crudo);
    if (!nombre || !/^[A-Za-z_][\w.-]*$/.test(nombre)) {
      return { ok: false, problemas: [...problemas, problema("XML_MAL_FORMADO", "xml", `Nombre de etiqueta inválido: "${sinCierre.slice(0, 30)}"`)] };
    }

    cerrarTexto();
    const nodo: NodoXml = { tag: nombre, attrs: parseAtributos(sinCierre.slice(crudo.length)), children: [], text: "" };
    if (pila.length) pila[pila.length - 1].children.push(nodo);
    if (!autoCierra) pila.push(nodo);
    i = fin + 1;
  }

  if (pila.length) {
    return {
      ok: false,
      problemas: [...problemas, problema("XML_MAL_FORMADO", "xml", `Quedaron ${pila.length} etiqueta(s) sin cerrar: <${pila[pila.length - 1].tag}>`)],
    };
  }
  if (!raiz) {
    return { ok: false, problemas: [...problemas, problema("XML_MAL_FORMADO", "xml", "El documento no tiene etiqueta raíz.")] };
  }
  return { ok: true, raiz };
}

/** Todos los descendientes (en profundidad, orden de aparición) con esa etiqueta local. */
export function buscar(nodo: NodoXml | null, tag: string): NodoXml[] {
  if (!nodo) return [];
  const salida: NodoXml[] = [];
  const visitar = (n: NodoXml) => {
    for (const c of n.children) {
      if (c.tag === tag) salida.push(c);
      visitar(c);
    }
  };
  visitar(nodo);
  return salida;
}

/** El primer descendiente con esa etiqueta local, o `null`. */
export function primero(nodo: NodoXml | null, tag: string): NodoXml | null {
  return buscar(nodo, tag)[0] ?? null;
}

/** El primer descendiente que además cumple el filtro sobre sus atributos. */
export function primeroConAttr(nodo: NodoXml | null, tag: string, attr: string, valor: (v: string) => boolean): NodoXml | null {
  return buscar(nodo, tag).find((n) => n.attrs[attr] !== undefined && valor(n.attrs[attr])) ?? null;
}

/** Texto de un descendiente inmediato, sin incluir los nietos. */
export function textoDirecto(nodo: NodoXml | null): string {
  return (nodo?.text ?? "").trim();
}

/**
 * Texto de un descendiente con descendientes incluidos. Los documentos de la
 * DIAN a veces envuelven el dato (por ejemplo el nombre del proveedor llega en
 * varios nodos), y para un identificador o un monto da igual quedarse con el
 * primer pedazo legible.
 *
 * Los fragmentos se unen con un ESPACIO: concatenar sin separador pegaría
 * texts y produciría un valor que no existe en el documento ("un" + "dos").
 */
export function textoPlano(nodo: NodoXml | null): string {
  if (!nodo) return "";
  const partes: string[] = [];
  const visitar = (n: NodoXml) => {
    const t = n.text.trim();
    if (t) partes.push(t);
    for (const c of n.children) visitar(c);
  };
  visitar(nodo);
  return partes.join(" ").replace(/\s+/g, " ").trim();
}

/** Texto del primer descendiente con esa etiqueta, o `null` si no existe o está vacío. */
export function textoDe(nodo: NodoXml | null, tag: string): string | null {
  const t = textoPlano(primero(nodo, tag));
  return t === "" ? null : t;
}

/**
 * Texto del primer descendiente con esa etiqueta **que tenga contenido**.
 *
 * Hace falta porque un documento real trae `<cbc:ID/>` vacío antes del `ID` que
 * sí trae el número de documento: con `textoDe` el número salía `null` porque el
 * primer `<cbc:ID>` estaba vacío.
 */
export function textoNoVacio(nodo: NodoXml | null, tag: string): string | null {
  for (const n of buscar(nodo, tag)) {
    const t = textoPlano(n);
    if (t !== "") return t;
  }
  return null;
}

/**
 * Primer HIJO DIRECTO con esa etiqueta.
 *
 * En UBL 2.1 los datos de cabecera (`ID`, `UUID`, `IssueDate`,
 * `DocumentCurrencyCode`, `AccountingSupplierParty`…) son hijos directos de la
 * raíz. Buscar en todo el árbol es incorrecto: una factura en moneda extranjera
 * mete un bloque `ext:UBLExtensions/…/ForeignCurrency` con sus propios `ID`
 * ("0"), `TaxTotal` y `LegalMonetaryTotal`, y como `UBLExtensions` va primero,
 * una búsqueda global devuelve los valores de la OTRA divisa.
 */
export function hijo(nodo: NodoXml | null, tag: string): NodoXml | null {
  if (!nodo) return null;
  return nodo.children.find((c) => c.tag === tag) ?? null;
}

/** Texto del primer hijo directo con esa etiqueta, o `null` si está vacía. */
export function hijoNoVacio(nodo: NodoXml | null, tag: string): string | null {
  for (const c of nodo?.children ?? []) {
    if (c.tag !== tag) continue;
    const t = textoPlano(c);
    if (t !== "") return t;
  }
  return null;
}
