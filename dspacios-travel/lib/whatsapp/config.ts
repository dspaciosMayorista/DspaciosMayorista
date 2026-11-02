// Configuración del canal WhatsApp de SalesBot (#56). Pura: recibe el entorno.
// Tres estados, APAGADO por defecto:
//   apagado  → el webhook responde 404; no se procesa nada.
//   simulado → se procesa y se guarda estado, pero NUNCA se llama a Meta.
//   real     → además envía por la Cloud API (exige ENVIO_REAL=1 + token + número + canal de aviso al equipo).
// En real, `numerosPrueba` (si no está vacío) limita a quién se le responde.
export type ConfigWhatsApp =
  | { estado: "apagado" }
  | {
      estado: "simulado" | "real";
      verifyToken: string;
      appSecret: string;
      accessToken: string | null;
      phoneNumberId: string | null;
      apiVersion: string;
      numerosPrueba: string[];
      urlBase: string | null;
      avisoEmail: string | null;
    };

/**
 * Versión de Graph/Cloud API por defecto. Verificada 2026-11-01 en el changelog de Graph: la última es v26.0 (29-jul-2026), pero el changelog
 * de WhatsApp solo documenta hasta v24.0; v25.0 (18-feb-2026) está vigente hasta 29-jul-2028. La anterior v21.0 vence el 21-ene-2027.
 * Subir con WHATSAPP_API_VERSION cuando WhatsApp documente la nueva; revisar este valor antes de cada vencimiento.
 */
export const VERSION_API_POR_DEFECTO = "v25.0";
const VERSION_VALIDA = /^v\d{1,2}\.\d{1,2}$/;

type Env = Record<string, string | undefined>;

/** Solo dígitos: WhatsApp entrega `wa_id` sin «+». */
export const soloDigitos = (v: string) => v.replace(/\D/g, "");

export function leerConfigWhatsApp(env: Env = process.env): ConfigWhatsApp | { estado: "mal_configurado"; falta: string[] } {
  if (env.WHATSAPP_BOT_ACTIVO !== "1") return { estado: "apagado" };
  const falta = ["WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET"].filter((k) => !env[k]);
  const real = env.WHATSAPP_ENVIO_REAL === "1";
  // En real el cliente recibe «un asesor te escribirá»: sin canal de aviso (correo + Resend) nadie vería la solicitud.
  if (real) falta.push(...["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "SALESBOT_WA_AVISO_EMAIL", "RESEND_API_KEY"].filter((k) => !env[k]));
  if (env.WHATSAPP_API_VERSION && !VERSION_VALIDA.test(env.WHATSAPP_API_VERSION)) falta.push("WHATSAPP_API_VERSION (formato vNN.N)");
  if (falta.length) return { estado: "mal_configurado", falta };
  return {
    estado: real ? "real" : "simulado",
    verifyToken: env.WHATSAPP_VERIFY_TOKEN!,
    appSecret: env.WHATSAPP_APP_SECRET!,
    accessToken: env.WHATSAPP_ACCESS_TOKEN ?? null,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? null,
    apiVersion: env.WHATSAPP_API_VERSION || VERSION_API_POR_DEFECTO,
    numerosPrueba: (env.WHATSAPP_NUMEROS_PRUEBA ?? "").split(",").map(soloDigitos).filter(Boolean),
    urlBase: (env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "") || null,
    avisoEmail: env.SALESBOT_WA_AVISO_EMAIL || null,
  };
}
