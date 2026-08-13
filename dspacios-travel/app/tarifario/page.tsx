import { createClient } from "@/lib/supabase/server";
import { TarifarioPublic } from "./TarifarioPublic";
import { CartDrawer } from "./CartDrawer";
import { getProgramasResumen } from "@/lib/programas";
import { Logo } from "@/components/Logo";
import { BackgroundVideo } from "@/components/BackgroundVideo";
import { cargarDatosTarifario } from "@/lib/tarifario/datos";

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

  const {
    filasVisibles, filasAddon, cuposPorBloqueo, origenPorBloqueo, fotosPorHotel, fotosPorServicio,
    infoPorHotel, capPorHotel, planesInfo, ventanaPorPaquete, incluidosPorPaquete,
  } = await cargarDatosTarifario(sb);

  // Programas publicados (fuente propia, en su moneda).
  const programas = await getProgramasResumen(sb, true);

  // Video de fondo del tarifario (global, opcional).
  const { data: cfgSitio } = await sb.from("config_sitio").select("video_fondo_url").eq("id", 1).maybeSingle();
  const videoFondo = cfgSitio?.video_fondo_url ?? null;

  return (
    <div className="app-bg min-h-screen bg-gray-50">
      <header className={`relative overflow-hidden bg-brand-gradient px-6 pt-8 pb-16 text-white ${videoFondo ? "flex min-h-[60vh] flex-col justify-end" : "min-h-[200px] flex flex-col justify-end"}`}>
        <BackgroundVideo url={videoFondo} overlay={0.4} />
        {!videoFondo && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-15"
            style={{ backgroundImage: "url('https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&fit=crop&auto=format')" }}
          />
        )}
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
                <>
                  <a href="/portal/b2b" className="rounded-lg bg-white px-4 py-2 text-sm font-medium" style={{ color: "var(--brand-primary)" }}>
                    Portal B2B
                  </a>
                  <a href="/login" className="rounded-lg border border-white/60 px-4 py-2 text-sm font-medium text-white hover:bg-white/10">
                    Portal Admin
                  </a>
                </>
              )}
            </div>
            <CartDrawer checkoutHabilitado fotosPorHotel={fotosPorHotel} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1700px] px-4 pt-0 pb-8 md:px-6">
        {!filasVisibles.length && !programas.length ? (
          <p className="py-20 text-center text-gray-400">Tarifario en preparación.</p>
        ) : (
          <TarifarioPublic filas={filasVisibles} programas={programas} puedeReservar={puedeReservar} cuposPorBloqueo={cuposPorBloqueo} origenPorBloqueo={origenPorBloqueo} fotosPorHotel={fotosPorHotel} fotosPorServicio={fotosPorServicio} ventanaPorPaquete={ventanaPorPaquete} infoPorHotel={infoPorHotel} planesInfo={planesInfo} capPorHotel={capPorHotel} incluidosPorPaquete={incluidosPorPaquete} filasAddon={filasAddon} />
        )}
      </main>
    </div>
  );
}
