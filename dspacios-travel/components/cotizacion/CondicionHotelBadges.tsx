// ─────────────────────────────────────────────────────────────────────────
// Badges de condición de pago/restricción comercial de un HOTEL, para
// mostrarse ANTES de reservar — resultado de Vista Booking y línea del
// carrito (migración 164/165). Puramente presentacional: recibe la condición
// YA resuelta (`lib/reservar/liquidacionHotel.ts::condicionHotelFechas`) y
// solo la traduce a texto/color, reutilizando las MISMAS funciones puras que
// ya usa el panel de administración de temporadas
// (`app/(dashboard)/dashboard/producto/hoteles/[id]/HotelDetalleClient.tsx`)
// y el congelado real del contrato (Rama B, PR #282) — un mismo criterio en
// los tres lugares, nunca tres fórmulas de texto distintas.
//
// No renderiza nada si la condición es neutra (`sin_condicion`/`normal`) y no
// está restringida — nunca se inventa un badge para un hotel sin condición
// configurada ni se "rellena" con una condición por defecto.
// ─────────────────────────────────────────────────────────────────────────
import { esNeutra, type CondicionTipo } from "@/lib/cotizacion/condicionPago";
import { fraseCondicion, etiquetasRestriccion } from "@/lib/cotizacion/etiquetasCondicion";

export type CondicionHotelBadgeData = {
  condicionPagoTipo: CondicionTipo;
  pctInicial: number | null;
  diasSaldo: number | null;
  restringido: boolean;
} | null | undefined;

export function CondicionHotelBadges({ condicion }: { condicion: CondicionHotelBadgeData }) {
  if (!condicion) return null;
  const neutra = esNeutra(condicion.condicionPagoTipo);
  if (neutra && !condicion.restringido) return null;

  const frase = !neutra
    ? fraseCondicion(condicion.condicionPagoTipo, { pctInicial: condicion.pctInicial, diasSaldo: condicion.diasSaldo })
    : null;
  const etiquetasRestric = condicion.restringido ? etiquetasRestriccion("no_reembolsable_no_endosable") : [];

  return (
    <div className="flex flex-wrap items-center gap-1" title={frase?.detalle ?? undefined}>
      {frase && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
          {frase.texto}
        </span>
      )}
      {etiquetasRestric.map((e) => (
        <span key={e} className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">
          {e}
        </span>
      ))}
    </div>
  );
}

// ── Versión compacta — tarjeta de exploración (Vista Booking) ──────────────
//
// Un solo resumen ("Con condiciones"), sin desglosar tipo/%/restricción — a
// diferencia de `CondicionHotelBadges` (detalle completo: modal, resultado y
// carrito), esta tarjeta es la vitrina general de "explorar alojamientos"
// (antes de elegir fechas/abrir el hotel), donde solo cabe un aviso corto.
// El detalle completo sigue viviendo exclusivamente en modal/resultado/carrito.
//
// Recibe un booleano YA resuelto (`InfoHotelDato.tieneCondicion`,
// `lib/tarifario/resumen.ts`) — no vuelve a evaluar nada, así que no hereda
// tipo/porcentaje: es deliberadamente ciego a esos detalles.
export function CondicionCompacta({ activo }: { activo?: boolean }) {
  if (!activo) return null;
  return (
    <span
      className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700"
      title="Este alojamiento tiene condiciones o restricciones de pago para algunas fechas — ver detalle al elegir tus fechas"
    >
      Con condiciones
    </span>
  );
}
