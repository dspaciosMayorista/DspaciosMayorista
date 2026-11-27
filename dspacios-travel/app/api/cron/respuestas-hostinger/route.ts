import { NextResponse } from "next/server";
import { configHostinger, manejarCronHostinger } from "@/lib/solicitudProveedor/hostinger";
import { construirDepsHostinger } from "@/lib/solicitudProveedor/hostingerDeps";

// #103 — drenaje PROGRAMADO de las respuestas de proveedores en el buzón de Hostinger: el mecanismo confiable de recuperación (no depende de que Hostinger notifique ni reintente). Mismo pase acotado que el webhook; termina lo que una
// notificación perdida, una descarga fallida o un tope dejaron pendiente. Exige CRON_SECRET como las demás rutas de cron (sin él → 503). Con la entrada de Hostinger apagada responde 200 «desactivado» y no toca nada.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const r = await manejarCronHostinger({ config: configHostinger(), authorization: req.headers.get("authorization"), secretoCron: process.env.CRON_SECRET, construir: construirDepsHostinger })
    .catch((e) => { console.error("cron respuestas-hostinger:", e instanceof Error ? e.message : e); return { status: 500, body: { error: "No se pudo procesar el drenaje." } }; });
  return NextResponse.json(r.body, { status: r.status });
}
