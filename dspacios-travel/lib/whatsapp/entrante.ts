// Extrae los mensajes de un POST del webhook de WhatsApp. Pura y tolerante:
// cualquier forma inesperada se ignora. Solo se leen mensajes (no `statuses`).
// Un toque en botón/lista llega con el `id` que pusimos al enviar: es el
// `valor` de la opción del flujo, que el flujo revalida igual que un texto.
import { sanearEntrada, type EntradaConversacion } from "@/lib/salesbot/conversacion/contrato";

export type MensajeEntrante = {
  waId: string;
  id: string;
  /** `timestamp` de Meta en segundos (0 si no viene): ordena los mensajes de un mismo cliente. */
  ts: number;
  nombrePerfil: string | null;
  /** `invalido` = tipo no soportado (audio, imagen…) o texto fuera de límites. */
  entrada: EntradaConversacion | "invalido";
};

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function entradaDe(m: Record<string, unknown>): EntradaConversacion | "invalido" {
  if (m.type === "text") return sanearEntrada({ tipo: "texto", texto: obj(m.text)?.body }) ?? "invalido";
  if (m.type === "interactive") {
    const i = obj(m.interactive);
    const r = obj(i?.button_reply) ?? obj(i?.list_reply);
    return sanearEntrada({ tipo: "opcion", valor: r?.id }) ?? "invalido";
  }
  return "invalido";
}

export function extraerMensajes(payload: unknown, phoneNumberId?: string | null): MensajeEntrante[] {
  const out: MensajeEntrante[] = [];
  const raiz = obj(payload);
  if (raiz?.object !== "whatsapp_business_account") return out;
  for (const e of arr(raiz.entry))
    for (const c of arr(obj(e)?.changes)) {
      const ch = obj(c);
      const v = obj(ch?.value);
      if (ch?.field !== "messages" || !v) continue;
      if (phoneNumberId && obj(v.metadata)?.phone_number_id !== phoneNumberId) continue;
      const nombres = new Map(arr(v.contacts).map((x) => [str(obj(x)?.wa_id), str(obj(obj(x)?.profile)?.name)] as const));
      for (const mm of arr(v.messages)) {
        const m = obj(mm);
        const waId = str(m?.from);
        const id = str(m?.id);
        if (!m || !waId || !id) continue;
        const ts = Number(str(m.timestamp));
        out.push({ waId, id, ts: Number.isSafeInteger(ts) && ts > 0 ? ts : 0, nombrePerfil: nombres.get(waId) ?? null, entrada: entradaDe(m) });
      }
    }
  return out;
}
