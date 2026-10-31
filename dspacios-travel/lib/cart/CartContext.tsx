"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { type CondicionTipo } from "@/lib/cotizacion/condicionPago";
import type { SalidaSeleccionadaBernaloEntrada } from "@/lib/reservar/solicitudAlojamientoBernalo";
import type { HabitacionOcupacionEntrada } from "@/lib/reservar/ocupacionPorHabitacion";
import {
  crearActualizadorConjunto, normalizarVinculos, quitarConVinculos, reemplazarConjunto,
  type MotivoRechazoConjunto, type ReemplazoConjunto,
} from "@/lib/cart/vinculoServicios";
import { resumirMonedas, type ResumenMonedas } from "@/lib/cart/monedaCarrito";
import { reemplazarManual, type ServicioManual } from "@/lib/cart/servicioManual";
import { MAX_OPCIONES } from "@/lib/cotizacion/comparativa";
import { hayHoraPendiente, tieneHoraPendiente, MENSAJE_HORA_PENDIENTE } from "@/lib/cart/horaPendiente";

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
  modulo: "bloqueo" | "porcion_terrestre" | "dinamico";
  paqueteId: number;
  hotelId: number;
  bloqueoId: number | null;
  // Solo `dinamico`: la salida elegida (sus fechas son fijas). El servidor re-liquida con ESA salida.
  salidaId?: number | null;
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
  /** Hora local prevista del traslado (llegada / salida), para servicios con suplementos por franja horaria. El servidor la valida y, con vuelo, usa la del vuelo. */
  horas?: { llegada?: string | null; salida?: string | null };
  /** Traslado con recargo por horario cuyo precio es el BASE (falta la hora): `precio` NO es un total final. El servidor lo recotiza con la hora del vuelo. */
  referencial?: boolean;
};

/** Servicio listo para entrar al carrito junto con su hotel (`addConjunto`
 * le asigna `id` y `hotelItemId`). */
export type TourSinVinculo = Omit<TourCartItem, "id" | "hotelItemId">;

// #64: servicio MANUAL (vuelo libre u otro) agregado por personal interno. No es
// un vuelo de Sistema: sin bloqueo, sin sillas. Comparte `nombre`/`fotoUrl`/
// fechas/`pax`/`precio`/`moneda` con el tour para que el carrito lo muestre igual,
// pero NUNCA lleva `servicioId`/`paqueteId` ni vínculo a un hotel.
export type ManualCartItem = ServicioManual & {
  id: string;
  tipo: "manual";
  fotoUrl: null;
  noches: null;
};

export type CartItem = HotelCartItem | TourCartItem | ManualCartItem;

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

/** #54: edición confirmada de un conjunto que YA está en el carrito. Ver
 * `reemplazarConjunto` (lib/cart/vinculoServicios.ts). */
export type ActualizacionConjunto = {
  /** `id` del hotel en el carrito: se conserva, y con él el vínculo de sus servicios. */
  hotelItemId: string;
  /** `firmaConjunto` del conjunto sobre el que se preparó la edición. */
  firmaEsperada: string;
  hotel: DistributiveOmit<HotelCartItem, "id">;
  /** Servicios definitivos (vacío = retirarlos todos). */
  servicios: readonly TourSinVinculo[];
  /** Identidad completa de la reserva (persona o unidad), para no convertir una en otra. */
  claveReserva?: (hotel: HotelCartItem) => string;
};
export type ResultadoActualizacionConjunto = { ok: true } | { ok: false; motivo: MotivoRechazoConjunto };

/** Aviso cuando, en modo comparativa, se intenta agregar un hotel de más (se muestra donde se pulsó «Agregar»). */
export const AVISO_MAXIMO_COMPARATIVA = `Una comparativa admite hasta ${MAX_OPCIONES} hoteles. Quita uno del carrito para agregar otro, o desactiva «Cotización comparativa».`;

type CartCtx = {
  items: CartItem[];
  // #64: modo «Cotización comparativa». Activo, el carrito no admite un hotel más allá del máximo (el servidor también lo rechaza).
  modoComparativa: boolean;
  setModoComparativa: (v: boolean) => void;
  avisoCarrito: string | null;
  add: (item: DistributiveOmit<CartItem, "id">) => void;
  // Hotel + sus servicios elegidos en la tarjeta, en UNA sola actualización
  // del carrito (nunca queda un servicio sin su hotel). Devuelve el id del hotel.
  addConjunto: (hotel: DistributiveOmit<HotelCartItem, "id">, servicios: readonly TourSinVinculo[]) => string;
  // #54: sustituye hotel + servicios de un conjunto ya agregado, en UNA sola
  // actualización y solo si sigue siendo el conjunto sobre el que se editó.
  // Si no aplica (hotel quitado, conjunto cambiado, reserva distinta) el
  // carrito queda igual y se devuelve el motivo.
  actualizarConjunto: (cambio: ActualizacionConjunto) => ResultadoActualizacionConjunto;
  // #64: edita SOLO el servicio manual `id` (el resto del carrito no cambia).
  actualizarManual: (id: string, datos: ServicioManual) => void;
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
// El modo «Cotización comparativa» se recuerda junto al carrito: cambiar de página, volver al carrito o recargar no lo apaga en silencio.
const KEY_MODO = "dspacios_cart_modo_v1";
const leerModoGuardado = (): boolean => { try { return localStorage.getItem(KEY_MODO) === "comparativa"; } catch { return false; } };

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addonsIntent, setAddonsIntent] = useState<AddonsIntent | null>(null);
  const [modoComparativa, setModoComparativaEstado] = useState(false);
  const modoRef = useRef(false);
  const [avisoCarrito, setAvisoCarrito] = useState<string | null>(null);
  const setModoComparativa = useCallback((v: boolean) => {
    modoRef.current = v; setModoComparativaEstado(v); if (!v) setAvisoCarrito(null);
    try { if (v) localStorage.setItem(KEY_MODO, "comparativa"); else localStorage.removeItem(KEY_MODO); } catch { /* sin almacenamiento: el modo vale solo en esta pantalla */ }
  }, []);
  useEffect(() => {
    if (!leerModoGuardado()) return;
    modoRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hidratar desde localStorage tras montar (evita el desajuste de SSR)
    setModoComparativaEstado(true);
  }, []);
  useEffect(() => {
    if (!avisoCarrito) return;
    const t = setTimeout(() => setAvisoCarrito(null), 7000);
    return () => clearTimeout(t);
  }, [avisoCarrito]);
  // El cuarto hotel en modo comparativa no entra: el aviso sale en el mismo lugar donde se pulsó «Agregar».
  const hotelDeMasEnComparativa = useCallback(() => modoRef.current && ultimoRef.current.filter((i) => i.tipo === "hotel").length >= MAX_OPCIONES, []);
  // No se guarda en localStorage hasta que el render YA incluye lo hidratado.
  // Es estado (no una ref) a propósito: con <StrictMode> en la raíz los
  // efectos corren dos veces al montar, y con una ref el efecto de guardado
  // escribía `[]` (el estado inicial) antes de que la segunda hidratación
  // leyera — el carrito se perdía al recargar en desarrollo.
  const [hidratado, setHidratado] = useState(false);
  // #54: estado del carrito tras TODAS las actualizaciones ya pedidas, aunque
  // React todavía no las haya renderizado. Cada mutación aplica aquí la MISMA
  // función pura que encola en `setItems`, en el mismo orden, así que este
  // valor es exactamente el `prev` que verá el siguiente actualizador. Con él
  // `actualizarConjunto` responde lo que de verdad se aplicará, también si en
  // el mismo lote hubo un `remove` u otra edición (sin efectos secundarios
  // dentro de `setItems`).
  const ultimoRef = useRef<CartItem[]>([]);
  const encolar = useCallback((f: (prev: CartItem[]) => CartItem[]) => {
    ultimoRef.current = f(ultimoRef.current);
    setItems(f);
  }, []);

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
        const hidratados = normalizarVinculos(parsed.map((i) => (i.tipo ? i : { ...i, tipo: "hotel" })) as CartItem[]);
        ultimoRef.current = hidratados;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setItems(hidratados);
      }
    } catch { /* ignore */ }
    setHidratado(true);
  }, []);

  useEffect(() => {
    if (!hidratado) return;
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* ignore */ }
  }, [items, hidratado]);

  const add = useCallback((item: DistributiveOmit<CartItem, "id">) => {
    if (item.tipo === "hotel" && hotelDeMasEnComparativa()) { setAvisoCarrito(AVISO_MAXIMO_COMPARATIVA); return; }
    if (tieneHoraPendiente(item)) { setAvisoCarrito(MENSAJE_HORA_PENDIENTE); return; }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ultimoRef.current = [...ultimoRef.current, { ...item, id } as CartItem];
    setItems((prev) => [...prev, { ...item, id: id } as CartItem]);
  }, [hotelDeMasEnComparativa]);
  const addConjunto = useCallback((hotel: DistributiveOmit<HotelCartItem, "id">, servicios: readonly TourSinVinculo[]) => {
    if (hotelDeMasEnComparativa()) { setAvisoCarrito(AVISO_MAXIMO_COMPARATIVA); return ""; }
    if (hayHoraPendiente(servicios)) { setAvisoCarrito(MENSAJE_HORA_PENDIENTE); return ""; }
    const nuevoId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Todos los ids se deciden AQUÍ, fuera del actualizador: así el
    // actualizador es puro y, si React lo ejecuta más de una vez (modo
    // estricto), produce exactamente los mismos ids y vínculos.
    const ids = { hotel: nuevoId(), servicios: servicios.map(() => nuevoId()) };
    encolar(crearActualizadorConjunto<CartItem>(
      hotel as Omit<CartItem, "id">, servicios as unknown as Omit<CartItem, "id" | "hotelItemId">[], ids,
    ));
    return ids.hotel;
  }, [encolar, hotelDeMasEnComparativa]);
  const actualizarConjunto = useCallback((c: ActualizacionConjunto): ResultadoActualizacionConjunto => {
    const nuevoId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (hayHoraPendiente(c.servicios)) return { ok: false, motivo: "servicio_invalido" };
    const claveReserva = c.claveReserva;
    // Igual que `addConjunto`: los ids se deciden aquí, fuera del actualizador.
    const cambio: ReemplazoConjunto<CartItem> = {
      hotelItemId: c.hotelItemId,
      firmaEsperada: c.firmaEsperada,
      hotel: c.hotel as Omit<CartItem, "id">,
      servicios: c.servicios as unknown as Omit<CartItem, "id" | "hotelItemId">[],
      idsNuevos: c.servicios.map(() => nuevoId()),
      claveReserva: claveReserva ? (h) => (h.tipo === "hotel" ? claveReserva(h) : "") : undefined,
    };
    // Se decide contra el estado tras lo ya pedido (`ultimoRef`), que es el
    // `prev` exacto con el que correrá el actualizador: lo que se responde es
    // lo que se aplica. Si no aplica, no se encola nada.
    const r = reemplazarConjunto(ultimoRef.current, cambio);
    if (!r.ok) return { ok: false, motivo: r.motivo };
    encolar((prev) => {
      const v = reemplazarConjunto(prev, cambio);
      return v.ok ? v.items : prev;
    });
    return { ok: true };
  }, [encolar]);
  const remove = useCallback((id: string) => encolar((prev) => quitarConVinculos(prev, id)), [encolar]);
  const actualizarPrecioBernalo = useCallback((id: string, precio: number, moneda: string | null) => {
    encolar((prev) => prev.map((i) => (i.id === id && i.tipo === "hotel" && i.modeloTarifario === "unidad" ? { ...i, precio, moneda } : i)));
  }, [encolar]);
  const actualizarManual = useCallback((id: string, datos: ServicioManual) => {
    encolar((prev) => reemplazarManual(prev, id, { ...datos }));
  }, [encolar]);
  const clear = useCallback(() => encolar(() => []), [encolar]);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const totales = resumirMonedas(items);

  return (
    <Ctx.Provider value={{
      items, add, addConjunto, remove, actualizarPrecioBernalo, clear, totales, count: items.length,
      actualizarConjunto, actualizarManual,
      drawerOpen, openDrawer, closeDrawer, addonsIntent, setAddonsIntent,
      modoComparativa, setModoComparativa, avisoCarrito,
    }}>
      {children}
      {avisoCarrito && (
        <div role="alert" data-testid="aviso-comparativa-maximo"
          className="fixed inset-x-3 bottom-4 z-[70] mx-auto flex max-w-md items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg">
          <span className="min-w-0 flex-1">{avisoCarrito}</span>
          <button type="button" onClick={() => setAvisoCarrito(null)} className="shrink-0 text-xs font-semibold underline">Entendido</button>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useCart(): CartCtx {
  const c = useContext(Ctx);
  if (!c) {
    // Outside CartProvider: return safe no-ops.
    return {
      items: [], add: () => {}, addConjunto: () => "", actualizarConjunto: () => ({ ok: false, motivo: "hotel_no_encontrado" }), actualizarManual: () => {}, remove: () => {}, actualizarPrecioBernalo: () => {}, clear: () => {}, totales: resumirMonedas([]), count: 0,
      drawerOpen: false, openDrawer: () => {}, closeDrawer: () => {}, addonsIntent: null, setAddonsIntent: () => {},
      modoComparativa: false, setModoComparativa: () => {}, avisoCarrito: null,
    };
  }
  return c;
}
