// Utilidades de SERVIDOR de las comparativas (#35): usan node:crypto y no deben
// importarse desde componentes de cliente.
import { createHmac } from "node:crypto";

/**
 * Huella de una IP para limitar la tasa de solicitudes públicas. HMAC-SHA256 con
 * una llave derivada del secreto de servicio: la base nunca guarda la IP, solo
 * este valor, que no se puede invertir ni recalcular sin el secreto. Se anula a
 * las 24 h (ver `f211_priv.purgar_ip_huella`). Sin llave o sin IP confiable
 * devuelve null (la base usa entonces el cupo estricto «sin-ip»).
 */
export function huellaIp(ip: string | null, llaveServicio: string | undefined): string | null {
  if (!ip || !llaveServicio) return null;
  return createHmac("sha256", llaveServicio).update(`comparativa-ip:v1:${ip}`).digest("base64url");
}
