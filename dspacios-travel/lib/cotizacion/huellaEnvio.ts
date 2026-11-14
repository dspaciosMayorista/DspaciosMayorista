// #14-A — HUELLA del contenido de un envío del carrito (la calcula el SERVIDOR; el navegador nunca la manda). SHA-256 del contenido canónico (claves ordenadas, sin `vistos` ni la propia clave): dos envíos
// con el mismo contenido tienen la misma huella aunque el navegador ordene las claves distinto; cualquier cambio de contenido (otro titular, otro recobro, otro hotel…) la cambia.
import { createHash } from "node:crypto";

const EXCLUIDAS = new Set(["vistos", "claveEnvio"]);

function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(Object.keys(v as object).filter((k) => !EXCLUIDAS.has(k)).sort().map((k) => [k, canonico((v as Record<string, unknown>)[k])]));
  }
  return v;
}

export function huellaDeEnvio(contenido: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonico(contenido)) ?? "null").digest("hex");
}
