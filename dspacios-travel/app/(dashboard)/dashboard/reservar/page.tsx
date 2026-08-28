import { createClient } from "@/lib/supabase/server";
import { TarifarioPublic } from "@/app/tarifario/TarifarioPublic";
import { CartDrawer } from "@/app/tarifario/CartDrawer";
import { CartProvider } from "@/lib/cart/CartContext";
import { getProgramasResumen } from "@/lib/programas";
import { liberarVencidas } from "./actions";
import {
  generarFlujoId, registrarEtapa, registrarDatoPagina, registrarErrorTecnico,
  siguienteInvocacionProceso, iniciarCronometro,
} from "@/lib/observabilidad/medicion";

export const dynamic = "force-dynamic";

const FLUJO = "pagina_reservar";

/**
 * Rediseño "carga bajo demanda" (medición real de preview: la versión
 * anterior descargaba el catálogo COMPLETO al entrar — 17.197 filas, ~11,1
 * MB — y ni siquiera pudo cachearse ("items over 2MB can not be cached")).
 * Pedido explícito del dueño: esta pantalla NO debe traer tarifario al
 * entrar. La carga inicial trae solo lo que el formulario necesita para
 * existir (sesión de carrito + programas, un dataset chico aparte del
 * problema de las ~17.000 filas) — cero consultas a `tarifario_resultado`.
 * `TarifarioPublic` (mismo componente que /tarifario) recibe
 * `filasIniciales=[]`/`cargaInicial={false}` y muestra el CTA "Buscar
 * tarifas" en vez de cualquier listado; solo al pulsar Buscar dispara la
 * Server Action `buscarPaginaTarifarioAccion` (compartida con /tarifario),
 * que reutiliza el MISMO motor server-side de siempre
 * (`buscarPaginaTarifarioCompleta` → `procesarFilasTarifario`, con
 * vigencia/cupos/markup/edades/habitaciones/sugerencias de fecha
 * exactamente como antes) — nunca se replica ningún cálculo en el cliente.
 * `liberarVencidas()` se conserva EAGER (libera sillas vencidas antes de
 * que el usuario busque, mismo criterio de siempre) — es independiente de
 * si se pre-carga tarifario o no.
 */
export default async function ReservarPage() {
  const flujoId = generarFlujoId();
  const invocacion = siguienteInvocacionProceso(FLUJO);
  const _cronoPrep = iniciarCronometro();

  const sb = await createClient();

  const _cronoLiberar = iniciarCronometro();
  const liberado = await liberarVencidas().catch(() => ({ ok: false, liberadas: 0 }));
  registrarEtapa(FLUJO, flujoId, "liberar_vencidas", _cronoLiberar(), liberado.ok ? "ok" : "error");
  registrarDatoPagina(FLUJO, flujoId, "liberar_vencidas", `liberadas=${liberado.liberadas}`);

  // Programas (circuitos): dataset chico, no forma parte del problema de las
  // ~17.000 filas de tarifario_resultado — se sigue trayendo entero, sin
  // paginar. Interno: activos aunque no publicados.
  const resProgramas = await getProgramasResumen(sb, false);
  if (resProgramas.error) {
    registrarErrorTecnico(FLUJO, flujoId, "programas_resumen", "error_getProgramasResumen", resProgramas.error);
  }
  const programas = resProgramas.programas;
  registrarDatoPagina(FLUJO, flujoId, "programas_resumen", `programas=${programas.length}`);
  registrarDatoPagina(FLUJO, flujoId, "preparacion_servidor", `invocacion_proceso=${invocacion} filas_iniciales=0 (carga bajo demanda)`);
  registrarEtapa(FLUJO, flujoId, "preparacion_servidor", _cronoPrep(), "ok");

  return (
    <CartProvider>
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="mb-1 text-2xl font-semibold text-gray-900">Reservar</h1>
            <p className="text-sm text-gray-500">
              Elige un destino/salida y pulsa Buscar para ver hoteles y tarifas. Arma tu selección en el carrito y finaliza para generar la cotización.
            </p>
          </div>
          <CartDrawer checkoutHabilitado fotosPorHotel={{}} />
        </div>
        <TarifarioPublic
          filasIniciales={[]} totalInicial={0} cargaInicial={false}
          programas={programas} puedeReservar
        />
      </div>
    </CartProvider>
  );
}
