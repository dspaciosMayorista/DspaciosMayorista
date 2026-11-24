// MensajeBot → cuerpos de la Cloud API de WhatsApp. Pura.
// Límites oficiales (Meta, verificados oct/nov-2026): botones ≤3, título ≤20,
// cuerpo ≤1024; lista ≤10 filas, título de fila ≤24, descripción ≤72, botón de
// lista ≤20, cuerpo ≤4096; id de botón ≤256 y de fila ≤200. El límite del
// texto simple (4096) NO figura en la documentación consultada: se usa el
// valor conservador conocido.
import type { MensajeBot, Opcion } from "@/lib/salesbot/conversacion/contrato";

export type CuerpoWA = Record<string, unknown>;

const MAX = { botones: 3, filas: 10, tBoton: 20, tFila: 24, dFila: 72, cuerpoBoton: 1024, cuerpoLista: 4096, texto: 4096 };

const corto = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`);
const base = { messaging_product: "whatsapp", recipient_type: "individual" } as const;

function textoDe(m: MensajeBot, urlBase: string | null): string {
  const partes = [m.texto, ...(m.lineas ?? [])];
  // Solo rutas internas relativas y solo si hay dominio configurado.
  if (m.enlace && urlBase && m.enlace.href.startsWith("/") && !m.enlace.href.startsWith("//")) partes.push(`${m.enlace.etiqueta}: ${urlBase}${m.enlace.href}`);
  return partes.join("\n");
}

const caben = (o: Opcion[]) => o.length <= MAX.botones && o.every((x) => x.etiqueta.length <= MAX.tBoton) && new Set(o.map((x) => x.etiqueta)).size === o.length;

function interactivo(cuerpo: string, opciones: Opcion[]): CuerpoWA {
  if (caben(opciones))
    return { ...base, type: "interactive", interactive: { type: "button", body: { text: cuerpo }, action: { buttons: opciones.map((o) => ({ type: "reply", reply: { id: o.valor, title: o.etiqueta } })) } } };
  const filas = opciones.slice(0, MAX.filas).map((o) => ({
    id: o.valor,
    title: corto(o.etiqueta, MAX.tFila),
    // Si el título se recortó, el texto completo viaja en la descripción.
    ...(o.etiqueta.length > MAX.tFila ? { description: corto(o.etiqueta, MAX.dFila) } : {}),
  }));
  return { ...base, type: "interactive", interactive: { type: "list", body: { text: cuerpo }, action: { button: "Ver opciones", sections: [{ rows: filas }] } } };
}

export function aMensajesWhatsApp(mensajes: MensajeBot[], urlBase: string | null = null): CuerpoWA[] {
  const out: CuerpoWA[] = [];
  const texto = (body: string) => out.push({ ...base, type: "text", text: { body: corto(body, MAX.texto), preview_url: false } });
  for (const m of mensajes) {
    const cuerpo = textoDe(m, urlBase);
    const ops = m.opciones ?? [];
    if (!ops.length) {
      texto(cuerpo);
      continue;
    }
    const tope = caben(ops) ? MAX.cuerpoBoton : MAX.cuerpoLista;
    if (cuerpo.length > tope) {
      texto(cuerpo);
      out.push(interactivo("Elige una opción:", ops));
    } else out.push(interactivo(cuerpo, ops));
  }
  return out;
}

/**
 * Qué hacer con la respuesta HTTP de Meta al enviar. 429 y 5xx son transitorios (se reintenta). 401/403 también: es configuración
 * (token vencido/permisos) y se arregla sin que el cliente tenga que repetir. El resto de 4xx (número inválido, ventana de 24 h cerrada,
 * cuerpo rechazado) no mejora reintentando: se descarta ese cuerpo y se registra.
 */
export function clasificarHttp(status: number): "ok" | "permanente" | "transitorio" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 429 || status === 401 || status === 403 || status >= 500) return "transitorio";
  return "permanente";
}
