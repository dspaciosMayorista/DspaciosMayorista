import "server-only";

// Envío por la Cloud API, UN cuerpo por llamada (el turno lleva la cuenta de cuántos acepta Meta).
// SOLO llama a Meta en estado «real» y, si hay lista de números de prueba, solo a esos.
// En «simulado» devuelve «ok» sin tocar la red. Cloud API no ofrece clave de idempotencia: un envío
// aceptado por Meta cuyo registro local falle puede repetirse una vez (ver docs/tecnico/salesbot-whatsapp.md).
import { soloDigitos, type ConfigWhatsApp } from "@/lib/whatsapp/config";
import { clasificarHttp, type CuerpoWA } from "@/lib/whatsapp/saliente";

export type ResultadoEnvio = "ok" | "permanente" | "transitorio";

export async function enviarCuerpo(cfg: Exclude<ConfigWhatsApp, { estado: "apagado" }>, waId: string, cuerpo: CuerpoWA): Promise<ResultadoEnvio> {
  if (cfg.estado !== "real") return "ok";
  if (cfg.numerosPrueba.length && !cfg.numerosPrueba.includes(soloDigitos(waId))) return "permanente";
  try {
    const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...cuerpo, to: waId }),
      signal: AbortSignal.timeout(8000),
    });
    const r = clasificarHttp(res.status);
    // Solo el código HTTP: el cuerpo de Meta puede traer datos del destinatario.
    if (r !== "ok") console.error(`[salesbot-wa] envio_fallido status=${res.status} clase=${r}`);
    return r;
  } catch {
    console.error("[salesbot-wa] envio_fallido red_o_tiempo");
    return "transitorio";
  }
}
