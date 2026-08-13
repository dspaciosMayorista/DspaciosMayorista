import { createClient } from "@/lib/supabase/server";
import { TarifarioPublic } from "@/app/tarifario/TarifarioPublic";
import { CartDrawer } from "@/app/tarifario/CartDrawer";
import { CartProvider } from "@/lib/cart/CartContext";
import { getProgramasResumen } from "@/lib/programas";
import { cargarDatosTarifario } from "@/lib/tarifario/datos";
import { liberarVencidas } from "./actions";

export const dynamic = "force-dynamic";

export default async function ReservarPage() {
  const sb = await createClient();

  // Liberar reservas vencidas (perezoso) al entrar
  await liberarVencidas().catch(() => {});

  const {
    filasVisibles, filasAddon, cuposPorBloqueo, origenPorBloqueo, fotosPorHotel, fotosPorServicio,
    infoPorHotel, capPorHotel, planesInfo, ventanaPorPaquete, incluidosPorPaquete,
  } = await cargarDatosTarifario(sb);

  // Programas (circuitos) activos: también reservables desde aquí.
  const programas = await getProgramasResumen(sb, false);

  return (
    <CartProvider>
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="mb-1 text-2xl font-semibold text-gray-900">Reservar</h1>
            <p className="text-sm text-gray-500">
              Tarifario comercial. Arma tu selección (hoteles y servicios) en el carrito y finaliza para generar la cotización.
            </p>
          </div>
          <CartDrawer checkoutHabilitado fotosPorHotel={fotosPorHotel} />
        </div>
        {!filasVisibles.length && !programas.length ? (
          <p className="py-20 text-center text-gray-400">No hay tarifas publicadas. Genera el tarifario en un paquete.</p>
        ) : (
          <TarifarioPublic
            filas={filasVisibles}
            programas={programas}
            puedeReservar
            cuposPorBloqueo={cuposPorBloqueo}
            origenPorBloqueo={origenPorBloqueo}
            fotosPorHotel={fotosPorHotel}
            fotosPorServicio={fotosPorServicio}
            infoPorHotel={infoPorHotel}
            planesInfo={planesInfo}
            capPorHotel={capPorHotel}
            ventanaPorPaquete={ventanaPorPaquete}
            incluidosPorPaquete={incluidosPorPaquete}
            filasAddon={filasAddon}
          />
        )}
      </div>
    </CartProvider>
  );
}
