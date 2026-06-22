import { formatCOP } from "@/lib/utils";

// Genera un BRIEF de texto (en español) a partir de un producto del tarifario,
// para pegarlo en una IA generadora de imágenes/diseño y producir un flyer.
// No llama a ninguna API: solo arma el texto con los valores reales.

const ACOM_LBL: Record<string, string> = {
  sencilla: "Acomodación sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple",
  nino: "Niño 1", nino2: "Niño 2",
};
const ORDEN = ["sencilla", "doble", "triple", "multiple", "nino", "nino2"];

export type BriefFlyerInput = {
  destino?: string | null;
  hotel?: string | null;
  categoria?: string | null;
  regimen?: string | null;
  noches?: number | null;
  precios: Record<string, number>;     // PVP por acomodación
  edadNino?: string | null;            // ej. "Niño 1 y 2: 5 a 11 años"
  empresa?: string;                    // marca (default D'spacios Travel)
  whatsapp?: string | null;
  moneda?: string;                     // COP por defecto
};

export function briefFlyer(i: BriefFlyerInput): string {
  const empresa = i.empresa || "D'spacios Travel";
  const moneda = i.moneda || "COP";
  const fmt = (n: number) => (moneda === "COP" ? formatCOP(n) : `${moneda} ${n.toLocaleString("es-CO")}`);

  const rooms = ["sencilla", "doble", "triple", "multiple"].filter((a) => i.precios[a] != null && i.precios[a] > 0);
  const desde = rooms.length ? Math.min(...rooms.map((a) => i.precios[a])) : null;

  const lineasPrecio = ORDEN
    .filter((a) => i.precios[a] != null && (a === "nino" || a === "nino2" || i.precios[a] > 0))
    .map((a) => `- ${ACOM_LBL[a]}: ${fmt(i.precios[a])} por persona`);

  const lineas: string[] = [];
  lineas.push(`BRIEF PARA FLYER PUBLICITARIO — ${empresa}`);
  lineas.push("");
  lineas.push("OBJETIVO: Genera un flyer/post promocional VERTICAL (1080 x 1350 px, formato Instagram/WhatsApp) para este plan de viaje. Usa los valores tal cual; NO inventes ni cambies precios.");
  lineas.push("");
  lineas.push("DATOS DEL PLAN:");
  if (i.destino) lineas.push(`- Destino: ${i.destino}`);
  if (i.hotel) lineas.push(`- Alojamiento: ${i.hotel}`);
  if (i.categoria) lineas.push(`- Categoría de habitación: ${i.categoria}`);
  if (i.regimen) lineas.push(`- Alimentación / régimen: ${i.regimen}`);
  if (i.noches) lineas.push(`- Duración: ${i.noches} noche(s)`);
  if (i.edadNino) lineas.push(`- ${i.edadNino}`);
  lineas.push("");
  lineas.push(`PRECIOS (${moneda}):`);
  lineas.push(...(lineasPrecio.length ? lineasPrecio : ["- (sin precios cargados)"]));
  if (desde != null) { lineas.push(""); lineas.push(`PRECIO ANCLA (destacar grande): "DESDE ${fmt(desde)} por persona".`); }
  lineas.push("");
  lineas.push("COMPLETAR (pídelo o déjalo si no aplica):");
  lineas.push("- Vigencia / fechas de salida.");
  lineas.push("- Qué incluye (alojamiento, alimentación, traslados, tours, asistencia…).");
  lineas.push("- Qué NO incluye / condiciones.");
  lineas.push("");
  lineas.push("ESTILO VISUAL (marca):");
  lineas.push(`- Marca: ${empresa}. Coloca el LOGO arriba (o esquina superior).`);
  lineas.push("- Paleta: azul #1D7C9A (primario), turquesa #26BBD9 (acento), verde #66B596, lima #AEF44A (realce puntual).");
  lineas.push("- Tono: aspiracional, limpio y profesional. Fotografía REAL y atractiva del destino de fondo, con degradado para legibilidad.");
  lineas.push("- Tipografía geométrica tipo Century Gothic / Jost (sans serif limpia).");
  lineas.push("- Jerarquía: destino grande arriba → precio 'DESDE' muy destacado → lista corta de beneficios → CTA abajo.");
  lineas.push("");
  lineas.push("TEXTOS SUGERIDOS:");
  lineas.push(`- Título: "${i.destino || i.hotel || "Tu próximo viaje"}"`);
  lineas.push(`- Gancho: "Vive ${i.destino || "este destino"} con ${empresa}"`);
  if (desde != null) lineas.push(`- Precio: "DESDE ${fmt(desde)} por persona"`);
  lineas.push(`- CTA: "Cotiza con nosotros${i.whatsapp ? ` · WhatsApp ${i.whatsapp}` : ""}"`);
  lineas.push("");
  lineas.push("FORMATO DE SALIDA: una imagen vertical lista para publicar. Mantén los precios legibles y exactos.");
  return lineas.join("\n");
}
