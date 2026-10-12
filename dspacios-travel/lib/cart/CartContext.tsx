"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { type CondicionTipo } from "@/lib/cotizacion/condicionPago";
import type { SalidaSeleccionadaBernaloEntrada } from "@/lib/reservar/solicitudAlojamientoBernalo";
import type { HabitacionOcupacionEntrada } from "@/lib/reservar/ocupacionPorHabitacion";
import { crearActualizadorConjunto, normalizarVinculos, quitarConVinculos } from "@/lib/cart/vinculoServicios";
import { resumirMonedas, type ResumenMonedas } from "@/lib/cart/monedaCarrito";

// Ítem de HOTEL del carrito — unión discriminada real por `modeloTarifario`
// (Fase 3F-1 Bernalo). `HotelCartItemPersona` es EXACTAMENTE el contrato de
// siempre (hoteles con `modelo_tarifario = "persona"`, el único que existía
// antes de esta fase) — el único cambio es el marcador `modeloTarifario?:
// undefined`, que nunca se escribe en runtime (ver la nota en el tipo) y no
// altera la serialización de un ítem persona ni un bit. Los ítems que ya
// viven en `localStorage` de antes de esta fase no traen la clave
// `modeloTarifario` en absoluto — se interpretan como persona (el branch
// `undefined`/ausente de la unión), sin ninguna migración de datos.
export type HotelCartItemPersona = {
  id: string;
  tipo: "hotel";
  // Marcador de discriminación (nunca se asigna: siempre `undefined` para un
  // ítem persona) — existe solo para que TypeScript narrowe
  // `if (item.modeloTarifario === "unidad")` sin necesitar un cast, tanto en
  // ítems nuevos como en los ya guardados en localStorage antes de esta fase
  // (que tampoco traen la clave, así que siguen cayendo en este branch).
  modeloTarifario?: undefined;
  modulo: "bloqueo" | "porcion_terrestre";
  paqueteId: number;
  hotelId: number;
  bloqueoId: number | null;
  hotelNombre: string;
  destino: string | null;
  fotoUrl: string | null;
  categoria: string;
  regimen: string;
  fechaIda: string | null;
  fechaRegreso: string | null;
  noches: number | null;
  habitaciones: Record<string, number>;
  ninos: number;
  ninos2: number;
  infantes: number;
  pax: number;
  precio: number;
  // Moneda de `precio` = la del hotel según el motor ("COP"/"USD"). Opcional:
  // ítems guardados en localStorage antes de este cambio no la traen y se
  // muestran "por confirmar" (lib/cart/monedaCarrito.ts) — nunca se asume COP.
  // Solo presentación: el checkout no la envía y el servidor re-liquida.
  moneda?: string | null;
  // Edad exacta de cada menor tal como se pidió en Vista Booking (misma
  // cantidad que ninos+ninos2+infantes), en el orden en que se capturó —
  // ver lib/reservar/edadesMenores.ts. Opcional: ítems del carrito
  // guardados en localStorage ANTES de este cambio no lo traen.
  edadesMenores?: number[];
  // Condición de pago/restricción comercial del hotel para estas fechas
  // (migración 164/165, `lib/reservar/liquidacionHotel.ts::condicionHotelFechas`)
  // — SOLO para mostrar el badge en el carrito, nunca se usa para calcular
  // `precio`. Opcional/`null`: ítems guardados antes de este cambio, o un
  // hotel sin condición configurada, simplemente no muestran badge.
  condicion?: {
    condicionPagoTipo: CondicionTipo;
    pctInicial: number | null;
    diasSaldo: number | null;
    restringido: boolean;
  } | null;
};

// Ítem de HOTEL BERNALO del carrito (`hoteles.modelo_tarifario = "unidad"`,
// Fase 3F-1) — transporta SOLO decisiones del usuario, nunca dinero: sin
// neto, bruto, comisión, snapshot, payload, costos ni markup. `precio`/
// `moneda` son PRESENTACIÓN (el "desde" que ya mostró Vista Booking al
// cotizar en vivo, Fase 3E) — nunca autoridad; el checkout siempre re-liquida
// (hoy, 3F-1, esa re-liquidación termina bloqueada por la guardia de
// `computarReserva`, sin cambios en esta fase).
export type HotelCartItemBernalo = {
  id: string;
  tipo: "hotel";
  modeloTarifario: "unidad";
  paqueteId: number;
  hotelId: number;
  hotelNombre: string;
  destino: string | null;
  fotoUrl: string | null;
  // Categoría/alimentación EXACTAS elegidas (nunca texto libre adivinado —
  // regla B1 de la auditoría DeepSeek, Fase 3E: solo valores realmente
  // vinculados al hotel/paquete).
  categoria: string;
  alimentacion: string;
  // Identidad discriminada de la salida elegida — nunca un índice `[0]`
  // (regla A1). Validable server-side con
  // `validarSalidaSeleccionadaBernalo` (lib/reservar/solicitudAlojamientoBernalo.ts).
  salida: SalidaSeleccionadaBernaloEntrada;
  // Habitaciones FÍSICAS con id, acomodación, adultos y edades exactas de
  // sus menores — mismo wire format que ya valida
  // `cotizarAlojamientoBernaloPublico` (Fase 3E). Nunca un conteo agregado:
  // la asociación habitación↔edad se pierde si se aplana.
  habitaciones: HabitacionOcupacionEntrada[];
  // Presentación únicamente — ver la nota del tipo completo.
  precio: number;
  moneda: string | null;
  // Composición SANEADA (adultos/niños/infantes) por habitación, saliente
  // de la clasificación AUTORITATIVA de la tarifa
  // (`resultado.menoresClasificados` dentro de `computarReservaBernalo`,
  // sanitizada en `cotizarAlojamientoBernaloPublico` — ver
  // `lib/reservar/composicionHabitacionBernalo.ts`). SOLO presentación (el
  // resumen "Doble (2 adt + 1 chd)" del carrito, `CartDrawer.tsx`): checkout
  // y conversión SIEMPRE re-liquidan, nunca confían en estos conteos para
  // calcular nada. Opcional: ítems agregados al carrito ANTES de esta
  // ronda (ya en `localStorage`) no lo traen — `resumenHabitacionesBernalo`
  // debe seguir renderizando sin romper cuando falta.
  composicionHabitaciones?: { habitacionId: string; adultos: number; ninos: number; infantes: number }[];
};

export type HotelCartItem = HotelCartItemPersona | HotelCartItemBernalo;

// Ítem de SERVICIO/TOUR (add-on de un paquete) — siempre con fechas/pax
// reales de una cotización, nunca con el "desde" genérico. Desde la pestaña
// Receptivos entra suelto; desde la tarjeta de un hotel entra JUNTO con el
// hotel (`addConjunto`) y queda vinculado a él por `hotelItemId`.
export type TourCartItem = {
  id: string;
  tipo: "tour";
  paqueteId: number;
  servicioId: number | null;
  nombre: string;
  destino: string | null;
  fotoUrl: string | null;
  fechaIda: string | null;
  fechaRegreso: string | null;
  noches: number | null;
  pax: number;
  precio: number;
  moneda?: string | null;
  /** `id` del ítem de hotel al que pertenece (subelección de su tarjeta).
   * Ausente = servicio independiente (Receptivos). Ver lib/cart/vinculoServicios.ts. */
  hotelItemId?: string | null;
};

/** Servicio listo para entrar al carrito junto con su hotel (`addConjunto`
 * le asigna `id` y `hotelItemId`). */
export type TourSinVinculo = Omit<TourCartItem, "id" | "hotelItemId">;

export type CartItem = HotelCartItem | TourCartItem;

// `Omit<Union, K>` NO es distributivo (`keyof` de una unión colapsa a la
// intersección de claves) — aplicado a `CartItem` (unión discriminada de 3
// miembros desde Fase 3F-1) produce un tipo mezclado que ya no deja
// TypeScript verificar un literal contra UN SOLO miembro. Esta variante SÍ
// distribuye sobre cada miembro de la unión antes de omitir `id`, así que
// `add({ tipo: "hotel", modulo: ... })` (persona) y
// `add({ tipo: "hotel", modeloTarifario: "unidad", ... })` (Bernalo) siguen
// verificándose cada uno contra su propia forma completa, como antes de la
// unión.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// Señal para que Vista Booking abra Receptivos ya filtrado por el destino/
// fechas/pax del hotel recién agregado (ver botón "Agregar tours" del
// carrito). `nonce` identifica CADA clic del botón (se incrementa en
// `CartDrawer`) — es lo que permite a `BuscadorReceptivos` distinguir "un
// intent nuevo que hay que consumir" de "el mismo intent de siempre" aunque
// el componente ya esté montado (no dependa solo del montaje inicial), sin
// disparar la búsqueda dos veces ni perder los resultados cuando el intent
// se limpia después de consumirse. Mismo patrón que `sugerenciaPedida` en
// `BuscadorBooking.tsx`.
// `paqueteId` conserva la identidad del paquete de origen (fix "add-ons
// propios reemplazados por el catálogo general del destino") — ver la
// cabecera de `lib/cart/addonsIntent.ts`. Siempre presente cuando el intent
// se construyó con éxito (AddonsIntentBase.paqueteId es obligatorio, nunca
// null): un ítem del carrito sin paqueteId válido se descarta como
// referencia ANTES de llegar acá, nunca produce un intent con este campo vacío.
export type AddonsIntent = { paqueteId: number; destino: string | null; fechaIda: string | null; fechaRegreso: string | null; pax: number; nonce: number };

type CartCtx = {
  items: CartItem[];
  add: (item: DistributiveOmit<CartItem, "id">) => void;
  // Hotel + sus servicios elegidos en la tarjeta, en UNA sola actualización
  // del carrito (nunca queda un servicio sin su hotel). Devuelve el id del hotel.
  addConjunto: (hotel: DistributiveOmit<HotelCartItem, "id">, servicios: readonly TourSinVinculo[]) => string;
  // Quitar un hotel quita también sus servicios vinculados; quitar un
  // servicio deja el hotel.
  remove: (id: string) => void;
  // Fase 3F-4A: cuando el checkout detecta que el PVP/moneda autoritativos de
  // un ítem Bernalo ya no coinciden con lo que el carrito mostraba
  // (`precio_actualizado`), esto actualiza SOLO el ítem visible en el
  // carrito — nunca reordena ni recalcula nada más. No-op si `id` no
  // corresponde a un ítem de hotel Bernalo (ej. ya se eliminó del carrito).
  actualizarPrecioBernalo: (id: string, precio: number, moneda: string | null) => void;
  clear: () => void;
  // Subtotales por moneda (nunca una suma de COP con USD). `totales.unica` es
  // el total único solo si todo el carrito comparte una moneda conocida.
  totales: ResumenMonedas;
  count: number;
  // El panel del carrito es controlable desde cualquier componente (ej. al
  // agregar un hotel, se abre solo — antes se quedaba pegado en la misma vista).
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  addonsIntent: AddonsIntent | null;
  setAddonsIntent: (v: AddonsIntent | null) => void;
};

const Ctx = createContext<CartCtx | null>(null);
const KEY = "dspacios_cart_v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addonsIntent, setAddonsIntent] = useState<AddonsIntent | null>(null);
  // Evita guardar en el primer render (antes de hidratar desde localStorage).
  const yaHidrato = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      // Hidratar desde localStorage tras montar (en cliente) evita el desajuste
      // de SSR; es el patrón estándar de carrito persistente. Ítems guardados
      // antes de que existiera "tipo" (solo hoteles) se migran a tipo:"hotel".
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>[];
        // Un servicio vinculado cuyo hotel ya no está (carrito editado o de
        // una versión anterior) se descarta: nunca queda suelto.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setItems(normalizarVinculos(parsed.map((i) => (i.tipo ? i : { ...i, tipo: "hotel" })) as CartItem[]));
      }
    } catch { /* ignore */ }
    yaHidrato.current = true;
  }, []);

  useEffect(() => {
    if (!yaHidrato.current) return;
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* ignore */ }
  }, [items]);

  const add = useCallback((item: DistributiveOmit<CartItem, "id">) => {
    setItems((prev) => [...prev, { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } as CartItem]);
  }, []);
  const addConjunto = useCallback((hotel: DistributiveOmit<HotelCartItem, "id">, servicios: readonly TourSinVinculo[]) => {
    const nuevoId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Todos los ids se deciden AQUÍ, fuera del actualizador: así el
    // actualizador es puro y, si React lo ejecuta más de una vez (modo
    // estricto), produce exactamente los mismos ids y vínculos.
    const ids = { hotel: nuevoId(), servicios: servicios.map(() => nuevoId()) };
    setItems(crearActualizadorConjunto<CartItem>(
      hotel as Omit<CartItem, "id">, servicios as unknown as Omit<CartItem, "id" | "hotelItemId">[], ids,
    ));
    return ids.hotel;
  }, []);
  const remove = useCallback((id: string) => setItems((prev) => quitarConVinculos(prev, id)), []);
  const actualizarPrecioBernalo = useCallback((id: string, precio: number, moneda: string | null) => {
    setItems((prev) => prev.map((i) => (i.id === id && i.tipo === "hotel" && i.modeloTarifario === "unidad" ? { ...i, precio, moneda } : i)));
  }, []);
  const clear = useCallback(() => setItems([]), []);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const totales = resumirMonedas(items);

  return (
    <Ctx.Provider value={{
      items, add, addConjunto, remove, actualizarPrecioBernalo, clear, totales, count: items.length,
      drawerOpen, openDrawer, closeDrawer, addonsIntent, setAddonsIntent,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCart(): CartCtx {
  const c = useContext(Ctx);
  if (!c) {
    // Outside CartProvider: return safe no-ops.
    return {
      items: [], add: () => {}, addConjunto: () => "", remove: () => {}, actualizarPrecioBernalo: () => {}, clear: () => {}, totales: resumirMonedas([]), count: 0,
      drawerOpen: false, openDrawer: () => {}, closeDrawer: () => {}, addonsIntent: null, setAddonsIntent: () => {},
    };
  }
  return c;
}
