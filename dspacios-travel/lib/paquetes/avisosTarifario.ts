// Presentación de los avisos de «Generar tarifario» (diagnóstico persistido + aviso recién generado): el texto crudo llega
// como una sola cadena de frases (ver `diagnosticoDisponibilidad` y `generarTarifario`); aquí se parte en secciones legibles
// para el operador. Solo presentación: no decide qué se publica ni cómo se calcula.

export type BloqueAviso = { resumen: string; items: string[] };
export type SeccionAviso = { id: SeccionId; titulo: string; bloques: BloqueAviso[] };
type SeccionId = "omitidos" | "infante" | "incluye" | "opcionales" | "otros";

const TITULOS: Record<SeccionId, string> = {
  omitidos: "Servicios y salidas omitidos",
  infante: "Precio de infante por configurar",
  incluye: "Texto «Incluye» por revisar",
  opcionales: "Opcionales",
  otros: "Otros avisos",
};
const ORDEN: SeccionId[] = ["omitidos", "infante", "incluye", "opcionales", "otros"];

// Inicio de cada frase conocida → sección. Se buscan fuera de «…» (el texto libre del «Incluye» puede imitarlas).
const INICIOS: { re: RegExp; id: SeccionId }[] = [
  { re: /\d+ de \d+ salida(?:\(s\)|s)? no se publican/g, id: "omitidos" },
  { re: /Sin oferta vendible/g, id: "omitidos" },
  { re: /Servicios incluidos omitidos/g, id: "omitidos" },
  { re: /El texto «Incluye» del paquete se conserva/g, id: "incluye" },
  { re: /ATENCIÓN operador:/g, id: "incluye" },
  { re: /Opcionales no ofrecidos/g, id: "opcionales" },
  { re: /Opcionales con disponibilidad parcial/g, id: "opcionales" },
  { re: /Atención: (?:el servicio|los servicios) /g, id: "infante" },
  { re: /ATENCIÓN: no se pudo registrar/g, id: "otros" },
  { re: /\(No se pudo guardar este diagnóstico/g, id: "otros" },
  { re: /Además,/g, id: "otros" },
];

/** Quita marcadores de formato (##, **, __, `) que vienen de líneas libres del «Incluye» y normaliza espacios. */
export function limpiarMarcado(texto: string): string {
  return texto.replace(/#{2,}\s*/g, "").replace(/(\*\*|__|`)/g, "").replace(/\s+/g, " ").trim();
}

// Marca, por posición, qué caracteres caen dentro de «…» o de (…).
function profundidades(t: string): { comillas: boolean[]; parentesis: number[] } {
  const comillas: boolean[] = []; const parentesis: number[] = [];
  let q = 0; let p = 0;
  for (const c of t) {
    if (c === "«") q++;
    if (c === "(") p++;
    comillas.push(q > 0); parentesis.push(p);
    if (c === "»" && q > 0) q--;
    if (c === ")" && p > 0) p--;
  }
  return { comillas, parentesis };
}

function partir(t: string, sep: string, d: ReturnType<typeof profundidades>): string[] {
  const out: string[] = []; let ini = 0;
  for (let i = t.indexOf(sep); i >= 0; i = t.indexOf(sep, i + 1)) {
    if (d.comillas[i] || d.parentesis[i] > 0) continue;
    out.push(t.slice(ini, i)); ini = i + sep.length;
  }
  out.push(t.slice(ini));
  return out.map((s) => s.trim()).filter(Boolean);
}

function bloque(seg: string, id: SeccionId): BloqueAviso {
  let t = seg.trim().replace(/^ATENCIÓN operador:\s*/, "").replace(/\.? Estructura el texto o edítalo\.?$/, "").replace(/\.$/, "").replace(/…$/, "");
  if (id === "infante") {
    const m = /^Atención: (?:el servicio|los servicios) (.+?) (?:no tiene|no tienen) precio de infante/.exec(t);
    if (m) return { resumen: "Sin precio de infante: los menores de 2 años pagarán como adulto. Configúralo en Producto → Servicios.", items: [m[1]] };
  }
  const d = profundidades(t);
  const i = t.indexOf(": ");
  if (i < 0 || d.comillas[i] || d.parentesis[i] > 0) return { resumen: t, items: [] };
  return { resumen: t.slice(0, i), items: partir(t.slice(i + 2), "; ", profundidades(t.slice(i + 2))) };
}

/** Parte el aviso en secciones. La frase «N tarifas persona publicadas…» se descarta (el conteo se muestra aparte). */
export function separarAvisos(crudo: string | null | undefined): SeccionAviso[] {
  const t = limpiarMarcado(crudo ?? "").replace(/^\d[\d.,]* tarifas? persona publicadas?(?: en el tarifario)?\.?\s*/i, "");
  if (!t) return [];
  const { comillas } = profundidades(t);
  const cortes: { pos: number; id: SeccionId }[] = [];
  for (const { re, id } of INICIOS) {
    re.lastIndex = 0;
    for (let m = re.exec(t); m; m = re.exec(t)) if (!comillas[m.index]) cortes.push({ pos: m.index, id });
  }
  cortes.sort((a, b) => a.pos - b.pos);
  // «ATENCIÓN operador:» y «El texto…» caen en la misma sección y pueden coincidir en inicio: quedarse con el primero por posición.
  const unicos = cortes.filter((c, i) => i === 0 || c.pos !== cortes[i - 1].pos);
  const segmentos: { id: SeccionId; texto: string }[] = [];
  if (unicos.length === 0 || unicos[0].pos > 0) segmentos.push({ id: "otros", texto: t.slice(0, unicos[0]?.pos ?? t.length) });
  unicos.forEach((c, i) => segmentos.push({ id: c.id, texto: t.slice(c.pos, unicos[i + 1]?.pos ?? t.length) }));

  const porId = new Map<SeccionId, BloqueAviso[]>();
  for (const s of segmentos) {
    if (!s.texto.trim()) continue;
    porId.set(s.id, [...(porId.get(s.id) ?? []), bloque(s.texto, s.id)]);
  }
  return ORDEN.filter((id) => porId.has(id)).map((id) => ({ id, titulo: TITULOS[id], bloques: porId.get(id)! }));
}
