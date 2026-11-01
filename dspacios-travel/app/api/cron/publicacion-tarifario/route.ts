import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cadenaDe, correrCola, debeEncadenar, urlRuta, type RpcAdmin } from "@/lib/tarifario/continuacionPublicacion";

// Continuación de la publicación del tarifario por lotes SIN navegador (migración 260). Corre el trabajador de la base (`tarifario_cola_correr`) hasta agotar su presupuesto y, si
// queda trabajo, encadena otra invocación de sí misma. Es la alternativa a pg_cron; ambos conviven sin estorbarse (un solo trabajador por publicación, SKIP LOCKED).
// Lo llaman: la acción que deja la publicación en la cola (empujón inmediato), y la propia cadena (respaldo manual o por empujón; NO hay cron programado en vercel.json: con pg_cron activo el flujo normal no la usa). Siempre con CRON_SECRET.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // Sin CRON_SECRET configurado, el endpoint rechaza todo (falla cerrado) en vez de quedar abierto a cualquiera con la URL.
  if (!secret) return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const cadena = cadenaDe(req.headers.get("x-cadena"));
  const admin = createAdminClient();
  const resumen = await correrCola((fn, args) => admin.rpc(fn as never, args as never) as unknown as ReturnType<RpcAdmin>);
  const encadenar = debeEncadenar(resumen, cadena);
  if (encadenar) {
    // Después de responder: no alarga esta respuesta y la nueva invocación empieza con su propia ventana completa.
    after(async () => {
      try { await fetch(urlRuta(), { headers: { authorization: `Bearer ${secret}`, "x-cadena": String(cadena + 1) }, cache: "no-store" }); }
      catch (e) { console.error("publicacion-tarifario: no se pudo encadenar la siguiente invocación:", e instanceof Error ? e.message : e); }
    });
  }
  if (resumen.error) console.error(`publicacion-tarifario: el trabajador falló: ${resumen.error}`);
  return NextResponse.json({ ...resumen, cadena, encadenada: encadenar }, { status: resumen.error ? 500 : 200 });
}
