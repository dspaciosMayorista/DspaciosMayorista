export const CRM_LEAD_CANALES = ["whatsapp", "instagram", "otro"] as const;
export type CrmLeadCanal = (typeof CRM_LEAD_CANALES)[number];

export const CRM_LEAD_ETAPAS = ["nuevo", "en_contacto", "calificado", "descartado", "archivado"] as const;
export type CrmLeadEtapa = (typeof CRM_LEAD_ETAPAS)[number];

export const CRM_LEAD_ACTIVIDAD_TIPOS = [
  "nota",
  "llamada",
  "whatsapp",
  "instagram",
  "email",
  "reunion",
  "cambio_etapa",
  "reasignacion",
  "cierre",
] as const;
export type CrmLeadActividadTipo = (typeof CRM_LEAD_ACTIVIDAD_TIPOS)[number];

export const CRM_LEAD_ROLES = ["superadmin", "gerencia", "administracion", "venta"] as const;
export const CRM_LEAD_RESPONSABLE_ROLES = ["gerencia", "administracion", "venta"] as const;

export const CRM_LEAD_ETAPA_LABEL: Record<CrmLeadEtapa, string> = {
  nuevo: "Nuevo",
  en_contacto: "En contacto",
  calificado: "Calificado",
  descartado: "Descartado",
  archivado: "Archivado",
};

export const CRM_LEAD_CANAL_LABEL: Record<CrmLeadCanal, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  otro: "Otro",
};

export function normalizarTelefonoLead(valor?: string | null): string | null {
  const digitos = (valor ?? "").replace(/[^0-9]/g, "");
  if (!digitos) return null;
  if (digitos.length === 10) return `57${digitos}`;
  if (digitos.length === 12 && digitos.startsWith("57")) return digitos;
  return digitos;
}

export function normalizarEmailLead(valor?: string | null): string | null {
  const email = (valor ?? "").trim().toLowerCase();
  return email || null;
}

export function normalizarDocumentoLead(valor?: string | null): string | null {
  const documento = (valor ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return documento || null;
}

// Tipos de documento admitidos. Es el MISMO catálogo que el CHECK
// `crm_leads_tipo_doc_catalogo` de la migración 202 (lo vigila
// pruebas/crmLeads.wiring.test.ts). La identidad documental de un lead es la
// pareja tipo + número: el número solo no identifica a nadie.
export const CRM_LEAD_TIPOS_DOC = ["CC", "CE", "TI", "RC", "PAS", "PPT", "NIT"] as const;
export type CrmLeadTipoDoc = (typeof CRM_LEAD_TIPOS_DOC)[number];

export const CRM_LEAD_TIPO_DOC_LABEL: Record<CrmLeadTipoDoc, string> = {
  CC: "Cédula de ciudadanía",
  CE: "Cédula de extranjería",
  TI: "Tarjeta de identidad",
  RC: "Registro civil",
  PAS: "Pasaporte",
  PPT: "Permiso por protección temporal",
  NIT: "NIT",
};

// Única variante de puntuación admitida: siglas con punto ("c.c.", "C.C",
// "p.a.s."): letras separadas por UN punto, con punto final opcional.
const TIPO_DOC_CON_PUNTOS = /^[A-Za-z]+(\.[A-Za-z]+)*\.?$/;

/**
 * Mismo criterio que `crm_lead_normalizar_tipo_doc`: recorta espacios (como
 * `btrim`), y si el valor es una sigla con o sin puntos la reduce a letras en
 * mayúscula (" c.c. " -> "CC"). Cualquier otra forma ("CC2", "C-C", "C C",
 * "..CC") se devuelve SIN limpiar, solo en mayúscula, para que quede fuera del
 * catálogo y se rechace: quitarle los sobrantes la convertiría en otro tipo en
 * silencio. No traduce sinónimos.
 */
export function normalizarTipoDocLead(valor?: string | null): string | null {
  const v = (valor ?? "").replace(/^ +| +$/g, "");
  if (!v) return null;
  return TIPO_DOC_CON_PUNTOS.test(v) ? v.replace(/\./g, "").toUpperCase() : v.toUpperCase();
}

export function esTipoDocLead(valor: string): valor is CrmLeadTipoDoc {
  return (CRM_LEAD_TIPOS_DOC as readonly string[]).includes(valor);
}

export type DocumentoLeadValidado =
  | { ok: true; tipoDoc: CrmLeadTipoDoc | null; documento: string | null }
  | { ok: false; error: string };

/**
 * Valida la pareja documental antes de mandarla a la RPC, con los mismos
 * mensajes que `crm_lead_tipo_doc_validado` (la base vuelve a validarla: esta
 * es solo para no gastar un viaje). Sin tipo ni número el lead es válido.
 */
export function validarDocumentoLead(tipoDoc?: string | null, documento?: string | null): DocumentoLeadValidado {
  const tipo = normalizarTipoDocLead(tipoDoc);
  const numero = (documento ?? "").trim() || null;
  if (!tipo && !numero) return { ok: true, tipoDoc: null, documento: null };
  if (!numero) return { ok: false, error: "Escribe el numero de documento o quita el tipo." };
  if (!normalizarDocumentoLead(numero)) return { ok: false, error: "El numero de documento debe tener letras o digitos." };
  if (!tipo) return { ok: false, error: "Indica el tipo de documento: el numero solo no identifica a la persona." };
  if (!esTipoDocLead(tipo)) return { ok: false, error: "Tipo de documento invalido." };
  return { ok: true, tipoDoc: tipo, documento: numero };
}

// Campos que acepta una Server Action de alta/edición. Una Server Action se
// puede invocar con cualquier payload desde el navegador: lo que no esté aquí,
// o no sea texto, se rechaza en vez de llegar a la RPC.
export const CRM_LEAD_CAMPOS_ENTRADA = [
  "nombre",
  "canal",
  "telefono",
  "email",
  "tipoDoc",
  "documento",
  "interes",
  "origenDetalle",
  "notas",
  "responsableId",
  "proximaAccionAt",
] as const;
type CampoEntradaLead = (typeof CRM_LEAD_CAMPOS_ENTRADA)[number];
type CampoOpcionalLead = Exclude<CampoEntradaLead, "nombre" | "canal">;

/**
 * Entrada de ALTA: nombre y canal obligatorios; el resto se puede omitir y se
 * completa como vacío (un lead nuevo no tiene datos previos que borrar).
 */
export type LeadCrearInput = { nombre: string; canal: string } & Partial<Record<CampoOpcionalLead, string | null>>;

/**
 * Entrada de EDICIÓN: el formulario completo, con las once claves PRESENTES.
 * Un campo vacío (`""` o `null`) significa "borrarlo"; una clave ausente no
 * significa nada y se rechaza. El tipo no basta (una Server Action recibe lo que
 * mande el navegador): `validarEntradaLead(..., "editar")` lo comprueba en runtime.
 */
export type LeadFormularioCompleto = { nombre: string; canal: string } & Record<CampoOpcionalLead, string | null>;

/** Entrada ya validada: todos los campos presentes, como texto ("" = vacío). */
export type EntradaLeadValidada = Record<CampoEntradaLead, string> & { canal: CrmLeadCanal };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida la entrada de `crearLead` (modo "crear") o `actualizarLead` (modo
 * "editar") y devuelve los once campos como texto.
 *
 * - "crear": los campos opcionales que falten se completan como vacíos.
 * - "editar": las once claves tienen que venir; una ausente (o `undefined`) es
 *   un error y NO se rellena con "". Si se rellenara, `actualizarLead(id,
 *   { nombre, canal })` llegaría a la RPC como un formulario completo con
 *   teléfono, correo y documento vacíos, y los borraría. Un campo presente y
 *   deliberadamente vacío (`""` o `null`) sí limpia el dato.
 *
 * En los dos modos rechaza un valor que no sea texto, una clave desconocida, un
 * canal o un documento inválidos, un responsable que no sea uuid y una fecha
 * que no se pueda leer.
 */
export function validarEntradaLead(
  input: unknown,
  modo: "crear" | "editar",
): { ok: true; datos: EntradaLeadValidada } | { ok: false; error: string } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Datos del lead invalidos." };
  }
  const crudo = input as Record<string, unknown>;
  const desconocidas = Object.keys(crudo).filter((k) => !(CRM_LEAD_CAMPOS_ENTRADA as readonly string[]).includes(k));
  if (desconocidas.length > 0) return { ok: false, error: `Campos no admitidos: ${desconocidas.sort().join(", ")}.` };
  if (modo === "editar") {
    const faltan = CRM_LEAD_CAMPOS_ENTRADA.filter(
      (campo) => !Object.prototype.hasOwnProperty.call(crudo, campo) || crudo[campo] === undefined,
    );
    if (faltan.length > 0) {
      return { ok: false, error: `Faltan campos del formulario del lead: ${faltan.join(", ")}. No se modifico nada.` };
    }
  }

  const datos = {} as Record<CampoEntradaLead, string>;
  for (const campo of CRM_LEAD_CAMPOS_ENTRADA) {
    const v = crudo[campo];
    if (v === undefined || v === null) datos[campo] = "";
    else if (typeof v === "string") datos[campo] = v;
    else return { ok: false, error: `El campo ${campo} debe ser texto.` };
  }

  datos.nombre = datos.nombre.trim();
  if (!datos.nombre) return { ok: false, error: "El nombre es obligatorio; usa 'Desconocido' si aun no lo tienes." };
  if (!esCanalLead(datos.canal)) return { ok: false, error: "Canal invalido." };
  const doc = validarDocumentoLead(datos.tipoDoc, datos.documento);
  if (!doc.ok) return { ok: false, error: doc.error };
  const responsable = datos.responsableId.trim();
  if (responsable && !UUID.test(responsable)) return { ok: false, error: "Responsable invalido." };
  datos.responsableId = responsable;
  const proxima = datos.proximaAccionAt.trim();
  if (proxima && Number.isNaN(Date.parse(proxima))) return { ok: false, error: "Fecha de proxima accion invalida." };
  datos.proximaAccionAt = proxima;
  return { ok: true, datos: datos as EntradaLeadValidada };
}

/** "CC 1020304" para mostrar; sin número no hay documento que mostrar. */
export function textoDocumentoLead(tipoDoc?: string | null, documento?: string | null): string | null {
  const numero = (documento ?? "").trim();
  if (!numero) return null;
  return tipoDoc ? `${tipoDoc} ${numero}` : numero;
}

export type CoincidenciaLead = { id: number; por: Array<"telefono" | "email" | "numero_documento"> };

const MOTIVO_COINCIDENCIA: Record<CoincidenciaLead["por"][number], string> = {
  telefono: "teléfono",
  email: "correo",
  numero_documento: "número de documento con otro tipo",
};

/**
 * Aviso para las coincidencias que devuelve la RPC (teléfono, correo o mismo
 * número con otro tipo). No bloquea nada: varias personas pueden compartir esos
 * datos, así que solo invita a revisar. Sin coincidencias, `null`.
 */
export function avisoCoincidenciasLead(coincidencias?: CoincidenciaLead[] | null): string | null {
  const lista = (coincidencias ?? []).filter((c) => Number.isFinite(c.id) && c.por.length > 0);
  if (lista.length === 0) return null;
  const partes = lista.map((c) => `#${c.id} (${c.por.map((p) => MOTIVO_COINCIDENCIA[p] ?? p).join(", ")})`);
  return `Comparte datos con ${partes.join("; ")}. Revisa si es la misma persona; no se fusionó nada.`;
}

export function esCanalLead(valor: string): valor is CrmLeadCanal {
  return (CRM_LEAD_CANALES as readonly string[]).includes(valor);
}

export function esEtapaLead(valor: string): valor is CrmLeadEtapa {
  return (CRM_LEAD_ETAPAS as readonly string[]).includes(valor);
}
