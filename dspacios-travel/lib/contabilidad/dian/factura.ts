// Documento DIAN (factura / nota crédito / nota débito) → objeto normalizado.
//
// Lee un XML de factura electrónica de la DIAN (UBL 2.1, con o sin prefijo de
// namespace) y devuelve el `DocumentoDian` con la aritmética declarada y los
// problemas que encontró. NO contabiliza, NO clasifica contra el PUC, NO escribe
// nada y NO decide nada tributario: solo copia lo que el emisor declaró.
//
// Dos decisiones de diseño que conviene tener presentes:
//
// 1. Cuando un campo puede estar en más de un lugar (el identificador de una
//    nota, por ejemplo), se devuelven TODOS los candidatos en `originales` y se
//    reporta `CAMPO_AMBIGUO`. No se elige uno "porque es el que se ve": la
//    bandeja necesita que una persona confirme, y el motivo va escrito.
//
// 2. La aritmética se devuelve DESCOMPUESTA (`aritmetica`) con lo declarado y lo
//    calculado por separado. Si difieren es un `aviso`: el documento no se
//    rechaza, pero la diferencia queda a la vista antes de clasificar.

import { buscar, hijo, hijoNoVacio, parseXml, primero, textoDe, textoNoVacio, textoPlano, type NodoXml } from "./xml.ts";
import { abrirAdjunto } from "./adjunto.ts";
import {
  problema,
tieneErrores,
  type DivisaExtranjera,
  type DocumentoDian,
  type FormaPagoDian,
  type IdentidadDocumento,
  type ImpuestoDian,
  type LineaDian,
  type ProblemaDian,
  type ResultadoDocumento,
  type RetencionDian,
  type TipoDocumento,
} from "./tipos.ts";
import {
  normalizarCufe,
  normalizarDv,
  normalizarFecha,
  normalizarMoneda,
  normalizarMonto,
  normalizarNit,
  pareceCufe,
  soloDigitos,
} from "./normalizar.ts";

// Tolerancia de un centavo: los documentos vienen con 2 decimales y el
// redondeo de la DIAN puede dejar una diferencia de 0.01 que NO es un error.
const TOL = 0.01;

/**
 * Fecha contra la que se valida "es futura". Se inyecta para que las pruebas no
// dependan del reloj del proceso.
 */
export type OpcionesParseo = { hoy?: string };

function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Monto obligatorio: si falta o no se puede leer, es un error y vale 0 para no cortar el resto del mapeo. */
function montoObligatorio(crudo: string | null, campo: string, problemas: ProblemaDian[]): number {
  if (crudo === null || crudo.trim() === "") {
    problemas.push(problema("CAMPO_AUSENTE", campo, `El documento no declara ${campo}.`));
    return 0;
  }
  const v = normalizarMonto(crudo);
  if (v === null) {
    problemas.push(problema("MONTO_INVALIDO", campo, `No se pudo leer "${crudo}" como número en ${campo}.`));
    return 0;
  }
  return v;
}

// ── Tipo de documento a partir de la raíz ────────────────────────────────────
function tipoPorRaiz(raiz: NodoXml): TipoDocumento | null {
  if (raiz.tag === "Invoice") return "factura";
  if (raiz.tag === "CreditNote") return "nota_credito";
  if (raiz.tag === "DebitNote") return "nota_debito";
  return null;
}

// ── Identidad (NIT / cédula / razón social) ─────────────────────────────────
//
// Dónde está la identificación en los documentos reales:
//
//   · `cac:PartyIdentification/cbc:ID`            (con su `schemeID`)
//   · `cac:PartyTaxScheme/cbc:CompanyID`          (forma más común en la DIAN)
//   · `cac:PartyLegalEntity/cbc:CompanyID`        (a veces repetido aquí)
//
// NO se usa "el primer `ID` que aparezca": dentro de la misma `Party` hay un
// `cac:TaxScheme/cbc:ID` con el código del impuesto ("01" = IVA) que salía antes
// que la identificación y se colaba como NIT.
//
// Un NIT son 9 dígitos (o 10 = NIT + DV). Si no llega a 9, es una cédula, un CE
// o un pasaporte: NO es un documento inválido, es un proveedor sin NIT, y queda
// en `identificacion` con su `tipoIdentificacion` y `nit: null`. Error solo
// cuando no hay ninguna identificación legible.
function identidadDe(party: NodoXml | null, problemas: ProblemaDian[], campo: string, exigirIdentificacion: boolean): IdentidadDocumento {
  // En la DIAN la ficha cuelga de `cac:Party`, que es hija del envoltorio
  // `cac:AccountingSupplierParty` / `cac:AccountingCustomerParty`. Se mira dentro
  // de `Party` y, si no está, en el envoltorio mismo (otra forma válida).
  const nivel = hijo(party, "Party") ?? party;
  const idParty = hijo(hijo(nivel, "PartyIdentification"), "ID") ?? hijo(hijo(party, "PartyIdentification"), "ID");
  const idEsquema = hijo(hijo(nivel, "PartyTaxScheme"), "CompanyID");
  const idLegal = hijo(hijo(nivel, "PartyLegalEntity"), "CompanyID");

  const esquema = idParty?.attrs.IDSchemeID ?? idParty?.attrs.schemeID ?? idEsquema?.attrs.IDSchemeID ?? idEsquema?.attrs.schemeID ?? null;

  // NIT = 9 dígitos. Con 10, el último es el DV.
  //
  // El `schemeID` solo se usa para EXCLUIR: si el documento dice que la
  // identificación es una cédula, un CE o un pasaporte, no se arma un NIT
  // aunque el número tenga 9 o 10 dígitos. Los `schemeID` que traen los
  // documentos reales no son consistentes entre emisores ("0", "5", "6" para
  // NIT; "4" para cédula), así que no se puede mapear un valor a "es NIT": solo
  // se puede descartar cuando el valor dice claramente que NO es NIT.
  const esquemaNit = (esquema ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  const esquemaDescartaNit = ["CC", "CE", "PP", "PAS", "NITE", "CD"].includes(esquemaNit);

  const candidatos = [idParty, idEsquema, idLegal].filter((n): n is NodoXml => n !== null);
  let nit: string | null = null;
  let dv: string | null = null;
  let identificacion: string | null = null;

  for (const n of candidatos) {
    const digitos = soloDigitos(textoPlano(n));
    const parseado = normalizarNit(textoPlano(n));
    if (!esquemaDescartaNit && parseado && parseado.nit.length === 9) {
      nit = parseado.nit;
      dv = normalizarDv(parseado.dv);
      identificacion = nit;
      break;
    }
    if (!identificacion && digitos.length >= 5) identificacion = digitos;
  }

  const nombre =
    textoDe(hijo(nivel, "PartyName"), "Name") ??
    textoDe(hijo(nivel, "PartyTaxScheme"), "RegistrationName") ??
    textoDe(hijo(nivel, "PartyLegalEntity"), "RegistrationName");
  const pais = nivel ? textoDe(primero(nivel, "Country"), "IdentificationCode") : null;

  if (exigirIdentificacion && !identificacion) {
    problemas.push(problema("NIT_INVALIDO", `${campo}.ID`, `No se pudo leer una identificación válida en ${campo}.`));
  }

  return {
    nit,
    dv,
    identificacion,
    tipoIdentificacion: esquema,
    nombre,
    pais: pais ? soloDigitos(pais) || pais : null,
  };
}

// ── Impuestos ────────────────────────────────────────────────────────────────
//
// La FORMA REAL (verificada en 15 facturas electrónicas de la DIAN, UBL 2.1) es:
//
//   <cac:TaxTotal>
//     <cbc:TaxAmount>0.00</cbc:TaxAmount>          ← suma del bloque, NO un impuesto
//     <cac:TaxSubtotal>
//       <cbc:TaxableAmount>219784.90</cbc:TaxableAmount>   ← base del impuesto
//       <cbc:TaxAmount>41759.13</cbc:TaxAmount>            ← valor del impuesto
//       <cac:TaxCategory>
//         <cbc:Percent>19.00</cbc:Percent>          ← YA ES PORCENTAJE, no 0.19
//         <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
//
// El `TaxTotal` externo NO lleva `ID`, ni `TotalTaxAmount`, ni `PercentAmount`:
// leerlo como si fuera un impuesto da base = valor del impuesto, valor = 0 y una
// tasa de 1900. Por eso el desglose se lee de `TaxSubtotal`.
//
// Se admite también la forma plana (`TaxTotal` con ID/PercentAmount/TotalTaxAmount
// en el mismo nivel), que existe en otros emisores: si no hay `TaxSubtotal`, se
// cae al comportamiento anterior.
function impuestosDe(nodo: NodoXml | null): ImpuestoDian[] {
  if (!nodo) return [];
  const salida: ImpuestoDian[] = [];

  for (const tt of buscar(nodo, "TaxTotal")) {
    const subtotales = buscar(tt, "TaxSubtotal");

    if (subtotales.length) {
      for (const st of subtotales) {
        const esquema = primero(st, "TaxScheme");
        salida.push({
          codigo: textoDe(esquema, "ID")?.trim() ?? "",
          nombre: textoDe(esquema, "Name"),
          tasa: tasaDe(primero(st, "TaxCategory")),
          base: normalizarMonto(textoDe(st, "TaxableAmount")) ?? 0,
          valor: normalizarMonto(textoDe(st, "TaxAmount")) ?? 0,
        });
      }
      continue;
    }

    // Forma plana: `PercentAmount` viene como entero (19) y `Percent` como
    // fracción (0.19). Se acepta cualquiera de los dos, sin multiplicar dos
    // veces: la regla es "si el número ya es >= 1, es un porcentaje".
    const valor = normalizarMonto(textoDe(tt, "TotalTaxAmount")) ?? 0;
    if (valor === 0 && !textoDe(tt, "TotalTaxAmount")) continue;
    salida.push({
      codigo: textoDe(tt, "ID")?.trim() ?? "",
      nombre: textoDe(tt, "Name"),
      tasa: tasaDe(tt),
      base: normalizarMonto(textoDe(tt, "TaxAmount")) ?? 0,
      valor,
    });
  }
  return salida;
}

/**
 * Copia de la raíz SIN las ramas que no son cabecera: `UBLExtensions` (que
 * contiene la extensión de moneda extranjera, con sus propios `ID`, `TaxTotal` y
 * `LegalMonetaryTotal`) y `InvoiceLine`.
 *
 * Todo lo que es "de la factura" (totales, impuestos de cabecera, formas de
 * pago) se lee sobre esta copia. Las líneas se leen aparte, sobre el árbol
 * original, con `lineasDe`.
 */
function cabecera(raiz: NodoXml): NodoXml {
  return { ...raiz, children: raiz.children.filter((c) => c.tag !== "UBLExtensions" && c.tag !== "InvoiceLine") };
}

/**
 * Los `TaxTotal` de la CABECERA, sin entrar en las líneas.
 *
 * `buscar(raiz, "TaxTotal")` recorre todo el árbol y también encuentra el
 * `TaxTotal` de cada `InvoiceLine`: contarlos todos produce un impuesto
 * duplicado por línea y descuadra el total. Por eso aquí se poda la rama
 * `InvoiceLine`.
 */
function taxTotalesCabecera(raiz: NodoXml): NodoXml[] {
  const salida: NodoXml[] = [];
  const visitar = (n: NodoXml) => {
    for (const c of n.children) {
      if (c.tag === "InvoiceLine" || c.tag === "UBLExtensions") continue;
      if (c.tag === "TaxTotal") {
        salida.push(c);
        visitar(c);
        continue;
      }
      visitar(c);
    }
  };
  visitar(raiz);
  return salida;
}

/**
 * El `LegalMonetaryTotal` QUE IMPORTA: el que es hijo directo de la raíz.
 *
 * Una factura en moneda extranjera trae un SEGUNDO `LegalMonetaryTotal` dentro
 * de `ext:UBLExtension/…/ForeignCurrency`, con los mismos nombres de etiqueta
 * pero en la otra divisa (en un caso real: 11,76 / 13,99 USD frente a
 * 37.883,78 / 45.081,70 COP). Como `UBLExtensions` va al principio del documento,
 * el primero que se encuentra NO es el de la factura. Por eso se exige que sea
 * hijo directo de la raíz y, si no hay ninguno, se cae al primero.
 */
function legalMonetaryTotalDe(raiz: NodoXml): NodoXml | null {
  const directo = raiz.children.find((c) => c.tag === "LegalMonetaryTotal");
  if (directo) return directo;
  return primero(raiz, "LegalMonetaryTotal");
}

/**
 * Datos de la OperationRate del documento. Una factura en moneda extranjera
 * trae `cac:PaymentExchangeRate` con la moneda origen, la de destino y la tasa.
 * Los MONTOS del documento siguen en la moneda de `DocumentCurrencyCode`; esta
 * extensión solo informa el cambio. El bloque de totales en la otra divisa
 * vive en `ext:UBLExtensions` y aquí NO se usa para la aritmética.
 */
function monedaExtranjeraDe(nodo: NodoXml | null): DivisaExtranjera | null {
  const er = nodo ? primero(nodo, "PaymentExchangeRate") : null;
  if (!er) return null;
  return {
    origen: textoDe(er, "SourceCurrencyCode"),
    destino: textoDe(er, "TargetCurrencyCode"),
    fecha: normalizarFecha(textoDe(er, "Date")),
    tasa: normalizarMonto(textoDe(er, "CalculationRate")),
  };
}

/**
 * Tasa del impuesto, tal como la declara el documento. En los documentos reales
 * llega como porcentaje (19.00 para el 19 %) dentro de `TaxCategory/Percent`, y
 * en la forma plana puede llegar como `PercentAmount` (19) o `Percent` (0.19).
 */
function tasaDe(nodo: NodoXml | null): number | null {
  const entero = normalizarMonto(textoDe(nodo, "PercentAmount"));
  if (entero !== null && Math.abs(entero) >= 1) return entero;
  const p = normalizarMonto(textoDe(nodo, "Percent"));
  if (p === null) return null;
  return Math.abs(p) < 1 ? redondear2(p * 100) : p;
}

// ── Retenciones ─────────────────────────────────────────────────────────────
//
// Hay TRES formas distintas y se leen todas:
//
// 1. UBL: `Retain` dentro de un `TaxTotal`, y `LegalTotal` /
//    `WithholdingTaxTotal` con `TotalRetain` / `TotalTaxRetained`.
// 2. Bloque DIAN heredado (`TotalesCop`): `ReteFueCop`, `ReteIvaCop`,
//    `ReteIcaCop`. Confirmado en documentos reales, **siempre en 0 o vacío**.
// 3. Bloque de software (`<CustomField Name="…" Value="…"/>`): `Retencion`,
//    `ReteFuenteAmount`, `ReteIvaAmount`, `TotalRetenciones`, `TotalReteFuente`,
//    `TotalReteIva`, `TotalReteIca` y la base `BaseRetencion`. Confirmado en
//    documentos reales; la base sí trae valor (p. ej. 1.831.932,78) y los
//    importes en 0.
//
// Lo que NO se hace: decidir si un bloque es retención o impuesto. Que el
// documento lo llame "INC" o "Total Retencion" es del emisor; aquí se copia lo
// declarado con su nombre y el contador decide. Una retención declarada en 0 SÍ
// aparece en la lista (con su base): que el documento declare la línea, aunque sea
// en cero, es información; lo que se descarta son las líneas VACÍAS.
const RETENCIONES_DECLARADAS: { codigo: string; tags: string[] }[] = [
  { codigo: "ReteFueCop", tags: ["ReteFueCop"] },
  { codigo: "ReteIvaCop", tags: ["ReteIvaCop"] },
  { codigo: "ReteIcaCop", tags: ["ReteIcaCop"] },
];

const RETENCIONES_SOFTWARE: { codigo: string; tags: string[] }[] = [
  { codigo: "ReteFuente", tags: ["Retencion", "ReteFuenteAmount"] },
  { codigo: "ReteFuente (total)", tags: ["TotalReteFuente"] },
  { codigo: "ReteIva", tags: ["ReteIvaAmount"] },
  { codigo: "ReteIca", tags: ["TotalReteIca"] },
  { codigo: "TotalRetenciones", tags: ["TotalRetenciones"] },
];

/**
 * El bloque de software declara sus campos como ATRIBUTOS:
 * `<CustomField Name="ReteFuenteAmount" Value="0.00" />`. El nombre y el valor
 * NO son texto de elemento, así que buscar una etiqueta "ReteFuenteAmount" no
 * encuentra nada. Se recorre el bloque y se arma el mapa nombre → valor.
 */
function camposSoftware(nodo: NodoXml): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const cf of buscar(nodo, "CustomField")) {
    const nombre = cf.attrs.Name ?? cf.attrs.name;
    const valor = cf.attrs.Value ?? cf.attrs.value;
    if (nombre && valor !== undefined && !mapa.has(nombre)) mapa.set(nombre, valor);
  }
  return mapa;
}

function retencionesDe(nodo: NodoXml | null): RetencionDian[] {
  if (!nodo) return [];
  const salida: RetencionDian[] = [];

  const push = (codigo: string, nombre: string | null, baseCrudo: string | null, valorCrudo: string | null) => {
    if (valorCrudo === null || valorCrudo.trim() === "") return;
    salida.push({ codigo, nombre, base: normalizarMonto(baseCrudo) ?? 0, valor: normalizarMonto(valorCrudo) ?? 0 });
  };

  // 1) UBL
  for (const tt of buscar(nodo, "TaxTotal")) {
    for (const ret of buscar(tt, "Retain")) {
      push(textoDe(ret, "ID") ?? "", textoDe(ret, "Name"), textoDe(ret, "TaxAmount"), textoDe(ret, "RetainAmount"));
    }
  }
  for (const tag of ["LegalTotal", "WithholdingTaxTotal"]) {
    for (const leg of buscar(nodo, tag)) {
      push(textoDe(leg, "ID") ?? "", textoDe(leg, "Name"), textoDe(leg, "TaxAmount"), textoDe(leg, "TotalRetain") ?? textoDe(leg, "TotalTaxRetained"));
      for (const wtt of buscar(leg, "TaxTotal")) {
        push(textoDe(wtt, "ID") ?? "", textoDe(wtt, "Name"), textoDe(wtt, "TaxAmount"), textoDe(wtt, "TotalTaxRetained"));
      }
    }
  }

  // 2) Bloque DIAN heredado (elementos con texto) y 3) bloque de software
  // (atributos). La base sale del primer campo que exista, que es como los
  // emisores la declaran.
  const software = camposSoftware(nodo);
  const base = textoNoVacio(nodo, "BaseRetencion") ?? software.get("BaseRetencion") ?? null;

  for (const def of RETENCIONES_DECLARADAS) {
    for (const tag of def.tags) {
      const valor = textoNoVacio(nodo, tag);
      if (valor !== null) push(def.codigo, tag, base, valor);
    }
  }

  for (const def of RETENCIONES_SOFTWARE) {
    for (const tag of def.tags) {
      const valor = software.get(tag) ?? textoNoVacio(nodo, tag);
      if (valor !== null) {
        push(def.codigo, tag, base, valor);
        break;
      }
    }
  }
  return salida;
}

// ── Líneas ───────────────────────────────────────────────────────────────────
function lineasDe(nodo: NodoXml | null): LineaDian[] {
  if (!nodo) return [];
  const salida: LineaDian[] = [];
  let i = 0;
  for (const linea of buscar(nodo, "InvoiceLine")) {
    i++;
    const cantidad = normalizarMonto(
      textoDe(linea, "InvoicedQuantity") ?? textoDe(linea, "CreditedQuantity") ?? textoDe(linea, "DebitedQuantity")
    );
    // La cuenta contable que declara el EMISOR (no el PUC de D'spacios) llega
    // como `cac:AccountingAccount/cbc:ID`.
    const cuentaCruda = textoDe(primero(linea, "AccountingAccount"), "ID") ?? textoDe(linea, "AccountingAccountID");
    salida.push({
      numero: normalizarMonto(textoDe(linea, "ID")) ?? i,
      descripcion: textoDe(linea, "Description"),
      cantidad,
      precioUnitario: normalizarMonto(textoDe(linea, "PriceAmount")),
      base: normalizarMonto(textoDe(linea, "LineExtensionAmount")) ?? 0,
      descuento: normalizarMonto(textoDe(linea, "AllowanceChargeAmount")),
      impuestos: impuestosDe(linea),
      cuentaContable: cuentaCruda ? cuentaCruda.trim() : null,
    });
  }
  return salida;
}

// ── Formas de pago ───────────────────────────────────────────────────────────
// En los documentos reales `cbc:ID` es un consecutivo (1, 2, 3…) y el código de
// la forma de pago real está en `cbc:PaymentMeansCode` (45 = contado, 30 =
// transferencia, 48 = tarjeta). Se lee el que trae el significado.
function formasPagoDe(nodo: NodoXml | null): FormaPagoDian[] {
  if (!nodo) return [];
  const salida: FormaPagoDian[] = [];
  for (const pm of buscar(nodo, "PaymentMeans")) {
    const codigo = textoDe(pm, "PaymentMeansCode") ?? textoDe(pm, "ID") ?? "";
    const fecha = normalizarFecha(textoDe(pm, "PaymentDueDate") ?? textoDe(pm, "PaymentDate"));
    const monto = normalizarMonto(textoDe(pm, "PaidAmount"));
    if (codigo || fecha || monto !== null) salida.push({ codigo, fecha, monto });
  }
  return salida;
}

// ── Identificadores del documento (CUFE / CUDE / número) ─────────────────────
type Identificadores = {
  cufe: string | null;
  cude: string | null;
  numero: string | null;
  originales: DocumentoDian["originales"];
  avisos: ProblemaDian[];
};

function identificadoresDe(raiz: NodoXml, tipo: TipoDocumento): Identificadores {
  const avisos: ProblemaDian[] = [];
  // `textoNoVacio`, no `textoDe`: hay documentos reales que abren con un
  // `<cbc:ID/>` vacío (dentro de `UBLExtensions`) antes del `cbc:ID` que sí
  // trae el número, y con `textoDe` el número salía null.
  const idRaiz = hijoNoVacio(raiz, "ID");
  const uuidRaiz = hijoNoVacio(raiz, "UUID");
  const refInterna = hijoNoVacio(raiz, "ReferenceID");

  // Candidatos: el `UUID`/`ID` de la raíz y cada `AdditionalDocumentReference`
  // que se declare como CUFE o CUDE.
  const refs = buscar(raiz, "AdditionalDocumentReference").map((n) => ({
    valor: textoDe(n, "ID") ?? "",
    esquema: (n.attrs.SchemeID ?? textoDe(n, "SchemeID") ?? "").toUpperCase().replace(/[^A-Z]/g, ""),
  }));

  const agregar = (destino: string[], valor: string | null) => {
    const v = normalizarCufe(valor);
    if (v && pareceCufe(v) && !destino.includes(v)) destino.push(v);
  };

  const candidatosCufe: string[] = [];
  const candidatosCude: string[] = [];
  agregar(candidatosCufe, uuidRaiz);
  agregar(candidatosCude, idRaiz);
  for (const r of refs) {
    if (r.esquema.includes("CUFE")) agregar(candidatosCufe, r.valor);
    if (r.esquema.includes("CUDE")) agregar(candidatosCude, r.valor);
  }

  let cufe: string | null = null;
  let cude: string | null = null;
  let numero: string | null = null;

  if (tipo === "factura") {
    // En una factura el CUFE es el UUID de la raíz y el número va aparte.
    cufe = candidatosCufe[0] ?? null;
    if (candidatosCufe.length > 1) {
      avisos.push(problema("CAMPO_AMBIGUO", "Invoice.UUID", `Hay más de un CUFE candidato: ${candidatosCufe.join(" / ")}.`, "aviso"));
    }
    if (!cufe && uuidRaiz && !pareceCufe(uuidRaiz)) {
      avisos.push(problema("CUFE_INVALIDO", "Invoice.UUID", `El UUID presente es demasiado corto para ser un CUFE (${uuidRaiz.length} caracteres).`, "aviso"));
    }
    numero = idRaiz ? idRaiz.replace(/\s+/g, "") : null;
  } else {
    // En una nota, el CUDE es el identificador propio; el CUFE de la factura
    // referida puede venir como referencia. Si no hay CUDE reconocible, la
    // bandeja lo muestra como pendiente en vez de inventarlo.
    cude = candidatosCude[0] ?? null;
    cufe = candidatosCufe[0] ?? null;
    if (candidatosCude.length > 1) {
      avisos.push(problema("CAMPO_AMBIGUO", `${raiz.tag}.ID`, `Hay más de un CUDE candidato: ${candidatosCude.join(" / ")}.`, "aviso"));
    }
    if (!cude) {
      avisos.push(problema("CAMPO_AUSENTE", `${raiz.tag}.ID`, "La nota no trae un CUDE reconocible (solo el CUFE de la factura referida, si vino).", "aviso"));
    }
    numero = refInterna ? refInterna.replace(/\s+/g, "") : idRaiz ? idRaiz.replace(/\s+/g, "") : null;
  }

  const otros = [uuidRaiz, refInterna, ...refs.map((r) => r.valor)]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .filter((v) => v !== uuidRaiz && v !== idRaiz);

  return {
    cufe,
    cude,
    numero,
    avisos,
    originales: { id: idRaiz, uuid: uuidRaiz, referenciaInterna: refInterna, otrosIdentificadores: [...new Set(otros)] },
  };
}

// ── Parseo principal ─────────────────────────────────────────────────────────

/** Parsea un XML que YA es el documento (no el sobre). Para el sobre, use `parseFacturaDeTexto`. */
export function parseFacturaXml(xml: string, opciones: OpcionesParseo = {}): ResultadoDocumento {
  const problemas: ProblemaDian[] = [];

  const leido = parseXml(xml);
  if (!leido.ok) {
    problemas.push(...leido.problemas);
    return { ok: false, documento: null, problemas };
  }
  const raiz = leido.raiz;

  const tipoDoc = tipoPorRaiz(raiz);
  if (!tipoDoc) {
    problemas.push(problema("XML_RAIZ_NO_RECONOCIDA", "raiz", `La raíz <${raiz.tag}> no es Invoice, CreditNote ni DebitNote.`));
    return { ok: false, documento: null, problemas };
  }

  // ── Fecha ──
  const fechaCruda = hijoNoVacio(raiz, "IssueDate");
  const fecha = normalizarFecha(fechaCruda);
  if (!fecha) {
    problemas.push(problema("FECHA_INVALIDA", `${raiz.tag}.IssueDate`, `No se pudo leer la fecha de emisión ("${fechaCruda ?? "ausente"}").`));
  } else if (opciones.hoy && fecha > opciones.hoy) {
    problemas.push(problema("FECHA_FUTURA", `${raiz.tag}.IssueDate`, `La fecha ${fecha} es posterior a hoy (${opciones.hoy}).`, "aviso"));
  }

  // ── Identificadores ──
  const ids = identificadoresDe(raiz, tipoDoc);
  problemas.push(...ids.avisos);

  // ── Parties ──
  const proveedor = identidadDe(hijo(raiz, "AccountingSupplierParty"), problemas, "AccountingSupplierParty.Party", true);
  const sujeto = identidadDe(hijo(raiz, "AccountingCustomerParty"), [], "AccountingCustomerParty.Party", false);

  // ── Moneda ──
  const monedaCruda = hijoNoVacio(raiz, "DocumentCurrencyCode");
  const moneda = normalizarMoneda(monedaCruda);
  if (!moneda) {
    problemas.push(problema("MONEDA_INVALIDA", `${raiz.tag}.DocumentCurrencyCode`, `Moneda no reconocida ("${monedaCruda ?? "ausente"}").`));
  }
  const trm = moneda && moneda !== "COP" ? normalizarMonto(hijoNoVacio(raiz, "ExchangeRate")) : null;

// ── Aritmética declarada ──
//
// Fórmula verificada factura por factura contra 15 documentos reales de la DIAN
// (todas cuadraron con `diferencia = 0`):
//
//   PayableAmount = LineExtensionAmount − AllowanceTotalAmount
//                 + ChargeTotalAmount + Σ TaxSubtotal.TaxAmount
//                 − PrepaidAmount + PayableRoundingAmount
//
// Dos cosas que los documentos reales desmintieron:
//
// 1. La base es `LineExtensionAmount`, NO `TaxExclusiveAmount`. Hay facturas
//    donde LineExtensionAmount es 1.181.120 y TaxExclusiveAmount es 31.000
//    (líneas exentas o fuera de la base): con TaxExclusiveAmount el total no
//    cuadra. `TaxExclusiveAmount` es información aparte (base gravable) y queda
//    en `baseGravable`.
//
// 2. Hay VARIOS `cac:TaxTotal` en la cabecera y todos suman al total: el
//    segundo suele ser un bloque de retención dethirdos (ej. "INC" 8 %) que el
//    documento también suma al payable. Por eso se suman todos y no solo el
//    primero.
const cab = cabecera(raiz);
  const totales = legalMonetaryTotalDe(cab);
  const subtotal = montoObligatorio(textoNoVacio(totales, "LineExtensionAmount"), "LegalMonetaryTotal.LineExtensionAmount", problemas);
  const baseGravable = textoNoVacio(totales, "TaxExclusiveAmount") === null ? null : (normalizarMonto(textoNoVacio(totales, "TaxExclusiveAmount")) ?? null);
  const descuentos = normalizarMonto(textoNoVacio(totales, "AllowanceTotalAmount")) ?? 0;
  const cargos = normalizarMonto(textoNoVacio(totales, "ChargeTotalAmount")) ?? 0;
  const anticipos = normalizarMonto(textoNoVacio(totales, "PrepaidAmount")) ?? normalizarMonto(textoDe(primero(raiz, "PrepaidPayment"), "PaidAmount")) ?? 0;
  const redondeo = normalizarMonto(textoNoVacio(totales, "PayableRoundingAmount")) ?? 0;

  const impuestos = impuestosDe({ ...cab, children: taxTotalesCabecera(cab) });
  const retenciones = retencionesDe(raiz);
  const sumaImpuestos = redondear2(impuestos.reduce((s, i) => s + i.valor, 0));
  const sumaRetenciones = redondear2(retenciones.reduce((s, r) => s + r.valor, 0));

  // El total declarado manda: `PayableAmount`; si no está, `TaxInclusiveAmount`;
  // si tampoco, se deriva de los desgloses.
  //
  // Las retenciones se INFORMAN pero NO se restan de `totalCalculado`, y es
  // deliberado: en los 17 documentos reales todas las retenciones vinieron en
  // 0, así que el signo no está verificado. Peor: el único bloque "de
  // retención" con valor (INC al 8 %) lo SUMABA al payable, no lo restaba.
  // Restarlas sin evidencia produciría un `TOTAL_NO_CUADRA` falso en el primer
  // documento que traiga una retención real. Se deja el término fuera hasta que
  // haya un caso real, y el número queda a la vista en `aritmetica.retenciones`.
  const payableCrudo = textoNoVacio(totales, "PayableAmount");
  const inclusiveCrudo = textoNoVacio(totales, "TaxInclusiveAmount");
  let totalDeclarado: number;
  if (payableCrudo !== null) totalDeclarado = montoObligatorio(payableCrudo, "LegalMonetaryTotal.PayableAmount", problemas);
  else if (inclusiveCrudo !== null) totalDeclarado = montoObligatorio(inclusiveCrudo, "LegalMonetaryTotal.TaxInclusiveAmount", problemas);
  else totalDeclarado = redondear2(subtotal - descuentos + cargos + sumaImpuestos - anticipos + redondeo);

  const totalCalculado = redondear2(subtotal - descuentos + cargos + sumaImpuestos - anticipos + redondeo);
  const diferencia = redondear2(totalDeclarado - totalCalculado);
  if (Math.abs(diferencia) > TOL) {
    problemas.push(
      problema(
        "TOTAL_NO_CUADRA",
        "LegalMonetaryTotal",
        `El documento declara ${totalDeclarado} pero sus desgloses suman ${totalCalculado} (diferencia ${diferencia}). Revisar antes de clasificar.`,
        "aviso"
      )
    );
  }

  const documento: DocumentoDian = {
    cufe: ids.cufe,
    cude: ids.cude,
    tipoDocumento: tipoDoc,
    numero: ids.numero,
    fecha: fecha ?? "",
proveedor: {
      nit: proveedor.nit,
      dv: proveedor.dv,
      identificacion: proveedor.identificacion,
      tipoIdentificacion: proveedor.tipoIdentificacion,
      nombre: proveedor.nombre,
      pais: proveedor.pais,
    },
    sujeto: {
      nit: sujeto.nit,
      dv: sujeto.dv,
      identificacion: sujeto.identificacion,
      tipoIdentificacion: sujeto.tipoIdentificacion,
      nombre: sujeto.nombre,
      pais: sujeto.pais,
    },
    moneda: moneda ?? "",
    trm,
aritmetica: {
      subtotal,
      baseGravable,
      descuentos,
      cargos,
      anticipos,
      redondeo,
      impuestos: sumaImpuestos,
      retenciones: sumaRetenciones,
      totalCalculado,
      totalDeclarado,
      diferencia,
    },
    divisa: monedaExtranjeraDe(raiz),
    impuestos,
    retenciones,
    formasPago: formasPagoDe(cab),
    lineas: lineasDe(raiz),
    software: textoDe(raiz, "SoftwareName"),
    xml,
    originales: ids.originales,
  };

  return tieneErrores(problemas) ? { ok: false, documento, problemas } : { ok: true, documento, problemas };
}

/**
 * Saca el XML de la factura de un `cbc:Description`.
 *
 * Los documentos reales de la DIAN llegan así: el sobre
 * `<AttachedDocument>` (CustomizationID "Documentos adjuntos") trae la factura
 * completa **dentro de un CDATA** en
 * `cac:Attachment/cac:ExternalReference/cbc:Description`, es decir como texto y
 * no en base64. El lector de XML trata el CDATA como texto, así que el XML
 * completo queda disponible en `nodo.text`.
 */
function xmlEnDescripcion(nodo: NodoXml): string | null {
  for (const d of buscar(nodo, "Description")) {
    const texto = d.text.trim();
    if (!texto) continue;
    if (!/<(Invoice|CreditNote|DebitNote)[\s>]/.test(texto)) continue;
    // El CDATA empieza con la declaración `<?xml …?>`; se recorta desde ahí para
    // no arrastrar espacios ni texto previo del emisor.
    const i = texto.search(/<\?xml|<(Invoice|CreditNote|DebitNote)[\s>]/);
    return i >= 0 ? texto.slice(i) : texto;
  }
  return null;
}

/**
 * Punto de entrada desde TEXTO, sin saber si lo que llegó es la factura, el
 * sobre de la DIAN o un adjunto en base64.
 *
 * Es la función que la bandeja debería llamar. Orden de intento:
 *
 *   1. Ya es `Invoice` / `CreditNote` / `DebitNote` → se parsea tal cual.
 *   2. Trae `AttachmentBinaryData` (base64) → se abre el adjunto.
 *   3. Trae `cbc:Description` con el XML embebido (CDATA) → se parsea ese.
 *
* El paso 3 es el que usan los documentos reales: en 14 de las 15 facturas del
 * usuario la factura viaja dentro de un sobre `AttachedDocument` y
 * el XML va como texto en un CDATA, NO en base64. El paso 2 se conserva porque
 * la respuesta de la DIAN (`ApplicationResponse`) lo usa, pero no se ha visto en
 * ninguna factura real: queda anotado en la hoja técnica.
 */
export function parseFacturaDeTexto(texto: string, opciones: OpcionesParseo = {}): ResultadoDocumento {
  const problemas: ProblemaDian[] = [];

  const leido = parseXml(texto);
  if (!leido.ok) {
    problemas.push(...leido.problemas);
    return { ok: false, documento: null, problemas };
  }
  const raiz = leido.raiz;

  // 1) El documento ya es una factura.
  if (tipoPorRaiz(raiz)) return parseFacturaXml(texto, opciones);

  // 2) Adjunto en base64 (respuesta de la DIAN).
  const adjunto = raiz.tag === "AttachedDocument" ? raiz : primero(raiz, "AttachedDocument");
  if (adjunto && buscar(adjunto, "AttachmentBinaryData").length) {
    const abierto = abrirAdjunto(adjunto);
    if (!abierto.ok) {
      problemas.push(...abierto.problemas);
      return { ok: false, documento: null, problemas };
    }
    return parseFacturaXml(abierto.xml, opciones);
  }

  // 3) XML embebido en un `cbc:Description` (forma de los documentos reales).
  const embebido = xmlEnDescripcion(raiz);
  if (embebido) return parseFacturaXml(embebido, opciones);

  problemas.push(
    problema(
      "XML_RAIZ_NO_RECONOCIDA",
      "raiz",
      `La raíz <${raiz.tag}> no es una factura, no trae <AttachmentBinaryData> y tampoco trae el XML en un <cbc:Description>.`
    )
  );
  return { ok: false, documento: null, problemas };
}
