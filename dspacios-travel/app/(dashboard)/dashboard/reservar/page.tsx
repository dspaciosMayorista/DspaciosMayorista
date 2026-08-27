import { createClient } from "@/lib/supabase/server";
import { TarifarioPublic } from "@/app/tarifario/TarifarioPublic";
import { CartDrawer } from "@/app/tarifario/CartDrawer";
import { CartProvider } from "@/lib/cart/CartContext";
import { getProgramasResumen } from "@/lib/programas";
import { cargarDatosTarifario } from "@/lib/tarifario/datos";
import { liberarVencidas } from "./actions";
import {
  generarFlujoId, registrarEtapa, registrarDatoPagina,
  siguienteInvocacionProceso, tamanoAproximadoBytes, iniciarCronometro,
} from "@/lib/observabilidad/medicion";

export const dynamic = "force-dynamic";

const FLUJO = "pagina_reservar";

// Diagnóstico del incidente de ~13s en /dashboard/reservar, /dashboard/
// tarifario y /tarifario (las tres comparten las mismas fuentes pesadas,
// aunque no el mismo código): cada request genera su propio `flujoId` y deja
// en los logs, con el mismo formato ya usado por crearContrato()/
// reservarPrograma() (lib/observabilidad/medicion.ts), el tiempo de:
//  - `liberar_vencidas` — SECUENCIAL antes de lo demás a propósito: libera
//    sillas vencidas (cambia `sillas`), y `cargarDatosTarifario()` lee cupos
//    calculados a partir de esas mismas sillas — paralelizarlo arriesgaría
//    leer cupos ANTES de liberar, mostrando menos disponibilidad de la real.
//  - `tarifario_y_programas` — cargarDatosTarifario() y getProgramasResumen()
//    NO dependen una de la otra (ninguna lee lo que la otra escribe ni usa su
//    resultado), así que arrancan CONCURRENTEMENTE con Promise.all. Sus
//    propias etapas internas (carga_paginada/filtro_vigencia/datos_
//    auxiliares para la primera) se miden aparte dentro de
//    `cargarDatosTarifario()`.
//  - `total` — todo el Server Component, incluida la serialización de props
//    hacia los Client Components (CartDrawer/TarifarioPublic).
export default async function ReservarPage() {
  const flujoId = generarFlujoId();
  const invocacion = siguienteInvocacionProceso(FLUJO);
  const _cronoTotal = iniciarCronometro();

  const sb = await createClient();

  // Liberar reservas vencidas (perezoso) al entrar — medido aparte, ver nota arriba.
  const _cronoLiberar = iniciarCronometro();
  const liberado = await liberarVencidas().catch(() => ({ ok: false, liberadas: 0 }));
  registrarEtapa(FLUJO, flujoId, "liberar_vencidas", _cronoLiberar(), liberado.ok ? "ok" : "error");
  registrarDatoPagina(FLUJO, flujoId, "liberar_vencidas", `liberadas=${liberado.liberadas}`);

  const _cronoCarga = iniciarCronometro();
  const [datos, programas] = await Promise.all([
    cargarDatosTarifario(sb, FLUJO, flujoId),
    getProgramasResumen(sb, false), // interno: activos aunque no publicados (igual que /dashboard/tarifario)
  ]);
  registrarEtapa(FLUJO, flujoId, "tarifario_y_programas", _cronoCarga(), "ok");

  const {
    filasVisibles, filasAddon, cuposPorBloqueo, origenPorBloqueo, fotosPorHotel, fotosPorServicio,
    infoPorHotel, capPorHotel, planesInfo, ventanaPorPaquete, incluidosPorPaquete,
  } = datos;

  registrarDatoPagina(
    FLUJO, flujoId, "programas_resumen",
    `programas=${programas.length} payload_bytes=${tamanoAproximadoBytes(programas)}`
  );
  registrarDatoPagina(
    FLUJO, flujoId, "total",
    `invocacion_proceso=${invocacion} payload_bytes=${tamanoAproximadoBytes(datos) + tamanoAproximadoBytes(programas)}`
  );
  registrarEtapa(FLUJO, flujoId, "total", _cronoTotal(), "ok");

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
