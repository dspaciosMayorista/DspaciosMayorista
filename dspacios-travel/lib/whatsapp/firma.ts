// Verificación del webhook de WhatsApp (Meta). Pura.
import { createHmac, timingSafeEqual } from "node:crypto";

/** `X-Hub-Signature-256: sha256=<hmac>` sobre el cuerpo CRUDO, con el app secret. */
export function firmaValida(cuerpoCrudo: string, cabecera: string | null, appSecret: string): boolean {
  if (!cabecera || !appSecret || !cabecera.startsWith("sha256=")) return false;
  const esperada = createHmac("sha256", appSecret).update(cuerpoCrudo, "utf8").digest();
  const recibida = Buffer.from(cabecera.slice(7), "hex");
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}

/** Handshake GET: devuelve el `hub.challenge` solo si modo y token coinciden. */
export function respuestaHandshake(q: URLSearchParams, verifyToken: string): string | null {
  const token = q.get("hub.verify_token") ?? "";
  const igual = token.length === verifyToken.length && timingSafeEqual(Buffer.from(token), Buffer.from(verifyToken));
  const challenge = q.get("hub.challenge");
  return q.get("hub.mode") === "subscribe" && igual && challenge ? challenge : null;
}
