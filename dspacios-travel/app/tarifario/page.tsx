import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TarifarioPublic, type FilaTarifario } from "./TarifarioPublic";
import { CartDrawer } from "./CartDrawer";
import { getProgramasResumen } from "@/lib/programas";
import { Logo } from "@/components/Logo";
import { BackgroundVideo } from "@/components/BackgroundVideo";
import type { AcomConfig } from "@/lib/acomodaciones";

export const revalidate = 120; // revalida cada 2 min

export default async function TarifarioPublicoPage() {
  const sb = await createClient();

  // Detectar sesión (badge de agencia + permiso de reservar)
  const { data: { user } } = await sb.auth.getUser();
  let esAgencia = false;
  let puedeReservar = false;
  if (user) {
    const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).single();
    esAgencia = !!perfil && ["agencia", "freelance", "superadmin", "operaciones", "gerencia", "administracion"].includes(perfil.rol);
    puedeReservar = !!perfil && ["superadmin", "operaciones", "gerencia", "administracion", "venta", "agencia", "freelance"].includes(perfil.rol);
  }

  // Resultado del tarifario (solo paquetes activos). Paginado por si supera 1000.
  const filas: FilaTarifario[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page } = await sb
      .from("tarifario_resultado")
      .select(
        "modulo, bloqueo_label, bloqueo_id, paquete_id, hotel_id, servicio_nombre, tipo_tarifa, pax_desde, pax_hasta, fecha_ida, fecha_regreso, noches, destino_nombre, paquete_nombre, hotel_nombre, categoria, regimen, acomodacion, precio_pvp"
      )
      .eq("paquete_activo", true)
      .order("destino_nombre")
      .order("bloqueo_label")
      .order("hotel_nombre")
      .order("categoria")
      .order("regimen")
      .range(from, from + PAGE - 1);
    if (!page || page.length === 0) break;
    filas.push(...(page as unknown as FilaTarifario[]));
    if (page.length < PAGE) break;
  }

  // Cupos disponibles por bloqueo (para mostrar y ocultar salidas sin cupos).
  // Se lee con service-role porque el tarifario es público (anónimo).
  const cuposPorBloqueo: Record<number, number> = {};
  const bloqueoIds = [...new Set(
    filas.filter((f) => f.modulo === "bloqueo" && f.bloqueo_id != null).map((f) => f.bloqueo_id as number)
  )];
  if (bloqueoIds.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient();
    const { data: cup } = await admin.from("cupos_por_bloqueo").select("id, cupos_disponibles").in("id", bloqueoIds);
    for (const c of cup ?? []) cuposPorBloqueo[c.id as number] = Number(c.cupos_disponibles) || 0;
  }

  // En la vitrina "Servicios" solo deben verse los paquetes de tipo 'servicios'.
  // Los servicios de paquetes porción/bloqueo existen como add-on para Reservar,
  // pero NO deben publicarse como productos sueltos.
  let filasVisibles = filas;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && filas.some((f) => f.modulo === "servicios")) {
    const admin = createAdminClient();
    const { data: pkgs } = await admin.from("armado_paquetes").select("id").eq("tipo", "servicios");
    const idsServicios = new Set((pkgs ?? []).map((p) => p.id));
    filasVisibles = filas.filter((f) => f.modulo !== "servicios" || (f.paquete_id != null && idsServicios.has(f.paquete_id)));
  }

  // Foto de portada por hotel (bucket público; lectura anónima permitida).
  const fotosPorHotel: Record<number, string> = {};
  const hotelIds = [...new Set(filasVisibles.filter((f) => f.hotel_id != null).map((f) => f.hotel_id as number))];
  if (hotelIds.length) {
    const { data: fotos } = await sb
      .from("hotel_fotos")
      .select("hotel_id, url, es_portada, orden")
      .in("hotel_id", hotelIds)
      .order("orden");
    for (const f of fotos ?? []) {
      if (fotosPorHotel[f.hotel_id] == null) fotosPorHotel[f.hotel_id] = f.url; // primera por orden
      if (f.es_portada) fotosPorHotel[f.hotel_id] = f.url;                       // portada gana
    }
  }

  // Estrellas / clasificación / descripción por hotel (hoteles es lectura pública).
  const infoPorHotel: Record<number, { estrellas: number | null; clasificacion: string | null; descripcion: string | null; ubicacion: string | null; video_url: string | null }> = {};
  // Capacidades por hotel (pax mín/máx + config de acomodaciones) para validar el
  // carrito. pax_min/max viven en `hoteles` (público); la config de acomodaciones
  // (`hotel_acomodaciones`) NO es pública → se lee con service-role.
  const capPorHotel: Record<number, { paxMin: number | null; paxMax: number | null; acom: AcomConfig[] }> = {};
  if (hotelIds.length) {
    const { data: hs } = await sb.from("hoteles").select("id, estrellas, clasificacion, descripcion, ubicacion, video_url, pax_min, pax_max").in("id", hotelIds);
    for (const h of hs ?? []) {
      infoPorHotel[h.id] = { estrellas: h.estrellas, clasificacion: h.clasificacion, descripcion: h.descripcion, ubicacion: h.ubicacion, video_url: h.video_url };
      capPorHotel[h.id] = { paxMin: h.pax_min, paxMax: h.pax_max, acom: [] };
    }
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const admin = createAdminClient();
      const { data: acs } = await admin
        .from("hotel_acomodaciones")
        .select("hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max")
        .in("hotel_id", hotelIds);
      for (const a of acs ?? []) {
        const slot = (capPorHotel[a.hotel_id] ??= { paxMin: null, paxMax: null, acom: [] });
        slot.acom.push(a as unknown as AcomConfig);
      }
    }
  }

  // Régimen de alimentación: qué incluye cada plan (catálogo, lectura pública).
  const planesInfo: Record<string, { nombre: string | null; descripcion: string | null; nota_especial: string | null }> = {};
  {
    const { data: planes } = await sb.from("planes_alimentacion").select("codigo, nombre, descripcion, nota_especial");
    for (const p of planes ?? []) planesInfo[(p.codigo ?? "").trim().toUpperCase()] = { nombre: p.nombre, descripcion: p.descripcion, nota_especial: p.nota_especial };
  }

  // Ventana de viaje por paquete (porción/dinámico) para el motor por fechas de la
  // vista Booking. armado_paquetes es interno → se lee con service-role.
  const ventanaPorPaquete: Record<number, { min: string | null; max: string | null }> = {};
  const paqIdsPorcion = [...new Set(
    filasVisibles.filter((f) => f.modulo === "porcion_terrestre" && f.paquete_id != null).map((f) => f.paquete_id as number)
  )];
  if (paqIdsPorcion.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient();
    const { data: pqs } = await admin.from("armado_paquetes").select("id, fecha_viaje_inicio, fecha_viaje_fin").in("id", paqIdsPorcion);
    for (const p of pqs ?? []) ventanaPorPaquete[p.id as number] = { min: p.fecha_viaje_inicio as string | null, max: p.fecha_viaje_fin as string | null };
  }

  // Programas publicados (fuente propia, en su moneda).
  const programas = await getProgramasResumen(sb, true);

  // Video de fondo del tarifario (global, opcional).
  const { data: cfgSitio } = await sb.from("config_sitio").select("video_fondo_url").eq("id", 1).maybeSingle();
  const videoFondo = cfgSitio?.video_fondo_url ?? null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className={`relative overflow-hidden bg-brand-gradient px-6 py-8 text-white ${videoFondo ? "flex min-h-[60vh] flex-col justify-end" : ""}`}>
        <BackgroundVideo url={videoFondo} overlay={0.4} />
        <div className="relative mx-auto flex w-full max-w-[1700px] flex-wrap items-end justify-between gap-4">
          <div>
            <Logo variant="white" height={56} priority className="h-12 w-auto md:h-14" />
            <p className="mt-2 text-sm opacity-90">Tarifario 2026</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-3">
              {esAgencia && (
                <span className="rounded-full bg-white/20 px-3 py-1.5 text-xs font-medium">Modo agencia</span>
              )}
              {user ? (
                <a href="/dashboard" className="rounded-lg bg-white px-4 py-2 text-sm font-medium" style={{ color: "var(--brand-primary)" }}>
                  Ir al panel →
                </a>
              ) : (
                <a href="/login" className="rounded-lg bg-white px-4 py-2 text-sm font-medium" style={{ color: "var(--brand-primary)" }}>
                  Ingresar
                </a>
              )}
            </div>
            <CartDrawer checkoutHabilitado fotosPorHotel={fotosPorHotel} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1700px] px-4 py-8 md:px-6">
        {!filasVisibles.length && !programas.length ? (
          <p className="py-20 text-center text-gray-400">Tarifario en preparación.</p>
        ) : (
          <TarifarioPublic filas={filasVisibles} programas={programas} puedeReservar={puedeReservar} cuposPorBloqueo={cuposPorBloqueo} fotosPorHotel={fotosPorHotel} ventanaPorPaquete={ventanaPorPaquete} infoPorHotel={infoPorHotel} planesInfo={planesInfo} capPorHotel={capPorHotel} />
        )}
      </main>
    </div>
  );
}
