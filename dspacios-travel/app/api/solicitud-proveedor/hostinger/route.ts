import { NextResponse } from "next/server";
import { configHostinger, manejarNotificacionHostinger } from "@/lib/solicitudProveedor/hostinger";
import { construirDepsHostinger } from "@/lib/solicitudProveedor/hostingerDeps";

// #103 — receptor de las notificaciones `message.received` de Hostinger (Agentic Mail). APAGADO por defecto (SOLICITUD_PROVEEDOR_HOSTINGER=activo + secretos en el entorno). La notificación solo AUTENTICA (Bearer) y DISPARA un
// pase ACOTADO de lectura del buzón configurado (su cuerpo no se interpreta: la carga útil no está documentada, y no se supone que Hostinger reintente). Si el pase no termina responde 202 `completo:false`; lo pendiente lo termina el
// siguiente pase (otra notificación o el drenaje programado /api/cron/respuestas-hostinger). Lógica y contrato verificado: lib/solicitudProveedor/hostinger.ts y docs/tecnico/hostinger-entrada-103.md.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const config = configHostinger();
  const cuerpoCrudo = config.ok ? await req.text() : "";           // nothing is read or touched while the feature is off
  const r = await manejarNotificacionHostinger({ config, authorization: req.headers.get("authorization"), cuerpoCrudo, construir: construirDepsHostinger })
    .catch((e) => { console.error("solicitud-proveedor hostinger:", e instanceof Error ? e.message : e); return { status: 500, body: { error: "No se pudo procesar la notificación." } }; });
  return NextResponse.json(r.body, { status: r.status });
}
