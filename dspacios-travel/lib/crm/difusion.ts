// Difusión — catálogos y MOTOR DE ROTACIÓN (puro y testeable).
//
// Reglas de negocio del dueño:
//  - No repetir el mismo HOTEL/PRODUCTO antes de 21 días.
//  - No repetir el mismo MATERIAL exacto (flyer/video) antes de 30 días.
//  - 2+ envíos del producto en los últimos 30 días → "En pausa".
//  - Nunca enviado → "Prioridad de envío".
//  - ≥ 21 días desde el último envío → "Puede enviarse".

export type Opcion = { v: string; label: string };

export const TIPOS_MATERIAL: Opcion[] = [
  { v: "flyer", label: "Flyer" },
  { v: "video_hotel", label: "Video hotel" },
  { v: "reel", label: "Reel" },
  { v: "carrusel", label: "Carrusel" },
  { v: "estado_wpp", label: "Estado WhatsApp" },
  { v: "comparativo", label: "Comparativo" },
  { v: "oferta", label: "Oferta" },
  { v: "material_hotel", label: "Material del hotel" },
  { v: "material_propio", label: "Material propio" },
  { v: "otro", label: "Otro" },
];

export const ESTADOS_MATERIAL: Opcion[] = [
  { v: "pendiente", label: "Pendiente por enviar" },
  { v: "disponible", label: "Disponible" },
  { v: "enviado", label: "Enviado" },
  { v: "en_pausa", label: "En pausa" },
  { v: "actualizar", label: "Actualizar" },
  { v: "no_usar", label: "No usar por ahora" },
];

export const PRIORIDADES: Opcion[] = [
  { v: "alta", label: "Alta" },
  { v: "media", label: "Media" },
  { v: "baja", label: "Baja" },
];

export const CANALES: Opcion[] = [
  { v: "difusion_wpp", label: "Lista de difusión WhatsApp" },
  { v: "estado_wpp", label: "Estado WhatsApp" },
  { v: "instagram", label: "Instagram" },
  { v: "facebook", label: "Facebook" },
  { v: "tiktok", label: "TikTok" },
  { v: "email", label: "Email" },
  { v: "otro", label: "Otro" },
];

export const LISTAS: Opcion[] = [
  { v: "agencias", label: "Agencias" },
  { v: "freelance", label: "Freelance" },
  { v: "clientes", label: "Clientes directos" },
  { v: "base_general", label: "Base general" },
  { v: "estados_wpp", label: "Estados WhatsApp" },
  { v: "instagram", label: "Instagram" },
  { v: "facebook", label: "Facebook" },
  { v: "tiktok", label: "TikTok" },
  { v: "otro", label: "Otro" },
];

export const OBJETIVOS: Opcion[] = [
  { v: "venta_directa", label: "Venta directa" },
  { v: "recordacion", label: "Recordación de marca" },
  { v: "reactivar", label: "Reactivar producto" },
  { v: "impulsar_destino", label: "Impulsar destino" },
  { v: "ultimos_cupos", label: "Últimos cupos" },
  { v: "promocion", label: "Promoción especial" },
  { v: "comparativo", label: "Comparativo" },
  { v: "info_general", label: "Información general" },
];

export const RESULTADOS: Opcion[] = [
  { v: "sin_medir", label: "Sin medir" },
  { v: "buena", label: "Buena respuesta" },
  { v: "media", label: "Respuesta media" },
  { v: "baja", label: "Baja respuesta" },
  { v: "cotizaciones", label: "Generó cotizaciones" },
  { v: "ventas", label: "Generó ventas" },
  { v: "no_funciono", label: "No funcionó" },
];

export const ESTADOS_PLAN: Opcion[] = [
  { v: "pendiente", label: "Pendiente" },
  { v: "programado", label: "Programado" },
  { v: "enviado", label: "Enviado" },
  { v: "reprogramar", label: "Reprogramar" },
  { v: "cancelado", label: "Cancelado" },
];

// Destinos "extra" de difusión que no son un destino del catálogo del tarifario.
export const DESTINOS_EXTRA = ["Nacional", "Internacional", "Otro"];

export const label = (ops: Opcion[], v: string | null | undefined): string =>
  ops.find((o) => o.v === v)?.label ?? (v ?? "—");

// ── Motor de rotación ───────────────────────────────────────────────────────

export type RotacionEstado = "prioridad" | "puede" | "no_repetir" | "en_pausa";

export const ROTACION_LABEL: Record<RotacionEstado, string> = {
  prioridad: "Prioridad de envío",
  puede: "Puede enviarse",
  no_repetir: "No repetir todavía",
  en_pausa: "En pausa",
};

export type EnvioMin = { material_id: number | null; hotel_producto: string | null; fecha_envio: string };

export type Rotacion = {
  estado: RotacionEstado;
  ultimaFecha: string | null;   // YYYY-MM-DD del último envío del producto
  diasDesde: number | null;
  veces30: number;              // envíos del producto en los últimos 30 días
  vecesMaterial30: number;      // envíos de ESTE material exacto en 30 días
  proximaFecha: string | null;  // última + 21 días
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const MS_DIA = 86_400_000;
const diasEntre = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / MS_DIA);
const sumarDias = (f: string, n: number) => {
  const d = new Date(`${f}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Calcula la rotación de un material dado TODO el histórico de envíos.
 * Producto = mismo `hotel_producto` (o mismo material_id). Material = mismo id.
 */
export function rotacionDe(
  material: { id: number; hotel_producto: string },
  envios: EnvioMin[],
  hoy: string
): Rotacion {
  const nombre = norm(material.hotel_producto);
  const delProducto = envios.filter(
    (e) => e.material_id === material.id || norm(e.hotel_producto) === nombre
  );
  const delMaterial = envios.filter((e) => e.material_id === material.id);

  if (!delProducto.length)
    return { estado: "prioridad", ultimaFecha: null, diasDesde: null, veces30: 0, vecesMaterial30: 0, proximaFecha: null };

  const ultimaFecha = delProducto.reduce((max, e) => (e.fecha_envio > max ? e.fecha_envio : max), delProducto[0].fecha_envio);
  const diasDesde = diasEntre(ultimaFecha, hoy);
  const veces30 = delProducto.filter((e) => diasEntre(e.fecha_envio, hoy) <= 30).length;
  const vecesMaterial30 = delMaterial.filter((e) => diasEntre(e.fecha_envio, hoy) <= 30).length;
  const proximaFecha = sumarDias(ultimaFecha, 21);

  // El mismo MATERIAL exacto no se repite antes de 30 días.
  const ultimaMaterial = delMaterial.length
    ? delMaterial.reduce((max, e) => (e.fecha_envio > max ? e.fecha_envio : max), delMaterial[0].fecha_envio)
    : null;
  const materialReciente = ultimaMaterial != null && diasEntre(ultimaMaterial, hoy) < 30;

  let estado: RotacionEstado;
  if (veces30 >= 2) estado = "en_pausa";
  else if (diasDesde < 21 || materialReciente) estado = "no_repetir";
  else estado = "puede";

  return { estado, ultimaFecha, diasDesde, veces30, vecesMaterial30, proximaFecha };
}

/** ¿Este material es candidato para enviar YA? (prioridad o puede enviarse). */
export const puedeEnviar = (r: Rotacion) => r.estado === "prioridad" || r.estado === "puede";
