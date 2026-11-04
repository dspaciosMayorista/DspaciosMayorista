import "server-only";
// Lectura servidor de los paquetes dinámicos publicados (#82). Service-role porque las tablas paquete_din*
// guardan netas y no son públicas; lo que sale de aquí ya pasó por `vistaPublica` (solo PVP).
// Un fallo NUNCA bloquea el tarifario: devuelve lista vacía.
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { tenantDinamicosVisibles } from "@/lib/paqueteDinamico/solicitud";
import { hoyBogota } from "@/lib/cotizacion/vigencia";
import { vistaPublica, type ContextoPublico, type DinamicoPublico } from "@/lib/paqueteDinamico/publico";
import { cargarFichasServicio, cargarOpcionesHotelFicha, cargarReglasHoteles, cargarVuelosDetalle } from "@/lib/paqueteDinamico/fichas";
import { resumenFicha } from "@/lib/paqueteDinamico/servicioFicha";
import type { FilaHotelDin, FilaPaqueteDin, FilaServicioDin, FilaVueloDin } from "@/lib/paqueteDinamico/modelo";

type FilaP = FilaPaqueteDin & { destino_id: number | null; compra_inicio: string | null; compra_fin: string | null; descripcion: string | null; incluye: string | null; no_incluye: string | null };

/** Agencia cuyos paquetes se muestran: la decide la SESIÓN (visitante → Mayorista; aliado B2B → su agencia; personal → la activa). */
export async function tenantVisibleDin(): Promise<"mayorista" | "minorista"> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return "mayorista";
  const { data: perfil } = await sb.from("usuarios").select("rol, activo, tenant").eq("id", user.id).maybeSingle();
  if (!perfil) return "mayorista";
  return tenantDinamicosVisibles({ rol: String(perfil.rol), activo: perfil.activo === true, tenant: perfil.tenant ?? null }, await getTenant());
}

export async function cargarDinamicosPublicados(): Promise<DinamicoPublico[]> {
  try {
    const tenant = await tenantVisibleDin();
    const admin = createAdminClient();
    const hoy = hoyBogota();
    const { data: ps } = await admin.from("paquete_din" as never).select("*").eq("publicado", true).eq("activo", true).eq("tenant", tenant) as { data: FilaP[] | null };
    const vigentes = (ps ?? []).filter((p) => (!p.compra_inicio || p.compra_inicio <= hoy) && (!p.compra_fin || p.compra_fin >= hoy));
    if (!vigentes.length) return [];
    const ids = vigentes.map((p) => p.id);
    const [h, v, s, d] = await Promise.all([
      admin.from("paquete_din_hoteles" as never).select("*").in("paquete_id", ids).order("orden") as unknown as Promise<{ data: (FilaHotelDin & { paquete_id: number })[] | null }>,
      admin.from("paquete_din_vuelos" as never).select("*").in("paquete_id", ids).order("orden") as unknown as Promise<{ data: (FilaVueloDin & { paquete_id: number })[] | null }>,
      admin.from("paquete_din_servicios" as never).select("*").in("paquete_id", ids).order("orden") as unknown as Promise<{ data: (FilaServicioDin & { paquete_id: number })[] | null }>,
      admin.from("destinos").select("id, nombre"),
    ]);
    const nombreDestino = new Map((d.data ?? []).map((x) => [x.id, String(x.nombre).toUpperCase()]));
    // Reglas de las fichas (hotel: edades y capacidad; servicio: cobro y rango; vuelo: horarios). Solo datos comerciales: ningún costo.
    const hotelesTodos = (h.data ?? []) as unknown as FilaHotelDin[], vuelosTodos = (v.data ?? []) as unknown as FilaVueloDin[], serviciosTodos = (s.data ?? []) as unknown as FilaServicioDin[];
    const admin2 = admin;
    const [reglasHotel, opcionesFicha, detalleVuelos, fichasSrv] = await Promise.all([
      cargarReglasHoteles(admin2, hotelesTodos), cargarOpcionesHotelFicha(admin2, hotelesTodos.map((x) => x.hotel_id).filter((x): x is number => x != null)),
      cargarVuelosDetalle(admin2, vuelosTodos), cargarFichasServicio(admin2, serviciosTodos.map((x) => x.servicio_id).filter((x): x is number => x != null)),
    ]);
    const ctx: ContextoPublico = { reglasHotel, vuelos: detalleVuelos, opcionesHotel: new Map(), fichas: new Map() };
    for (const x of hotelesTodos) if (x.hotel_id != null && opcionesFicha.has(x.hotel_id)) ctx.opcionesHotel!.set(x.id, opcionesFicha.get(x.hotel_id)!);
    for (const x of serviciosTodos) { const f = x.servicio_id != null ? fichasSrv.get(x.servicio_id) : undefined; if (f) ctx.fichas!.set(x.id, resumenFicha(f)); }
    const out: DinamicoPublico[] = [];
    for (const p of vigentes) {
      const vista = vistaPublica(
        { ...p, destino: nombreDestino.get(p.destino_id ?? -1) ?? "" },
        (h.data ?? []).filter((x) => x.paquete_id === p.id), (v.data ?? []).filter((x) => x.paquete_id === p.id), (s.data ?? []).filter((x) => x.paquete_id === p.id), ctx,
      );
      if (vista) out.push(vista);
    }
    return out;
  } catch (e) {
    console.error("dinamicos publicados", (e as Error).message);
    return [];
  }
}
