import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// GUARDA CONTRA LA DIVERGENCIA — badges de condición de pago en booking/carrito
//
// Auditoría del dueño: el catálogo (`hotel_temporadas`, migración 164) ya
// tenía condiciones/restricciones cargadas, pero Vista Booking y el carrito
// nunca las mostraban — el dato NO viajaba desde el catálogo hasta la UI
// pública (no era un problema de renderizado: `condicionHotelFechas` no
// existía todavía, y `buscarHoteles`/`cotizarPorFechas` no seleccionaban las
// columnas de condición de `hotel_temporadas`).
//
// Estas pruebas miran el CÓDIGO FUENTE (no ejecutan React) para asegurar que
// los 4 puntos de cableado siguen conectados: si alguien quita el import o
// deja de pasar `condicion` al armar el ítem del carrito, esto lo delata.
// El cálculo real (¿la condición correcta llega para la fecha correcta?) se
// prueba con ejecución real en `pruebas/condicionHotelFechas.test.ts`.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

test("cotizar.ts selecciona las columnas de condición de hotel_temporadas y las expone en BusquedaResultado/CotizarResult", () => {
  const src = leer("lib/reservar/cotizar.ts");
  assert.match(src, /condicion_pago_tipo, condicion_pago_pct_inicial, condicion_pago_dias_saldo/, "el select a hotel_temporadas no trae las columnas de condición");
  assert.match(src, /condicionHotelFechas/, "no importa/usa el resolver de condición");
  assert.match(src, /condicion\?: CondicionHotelFechas \| null/, "BusquedaResultado no expone el campo condicion");
});

test("BuscadorBooking.tsx: el resultado muestra el badge Y lo propaga al ítem del carrito", () => {
  const src = leer("app/tarifario/BuscadorBooking.tsx");
  assert.match(src, /import \{ CondicionHotelBadges \} from "@\/components\/cotizacion\/CondicionHotelBadges"/);
  assert.match(src, /<CondicionHotelBadges condicion=\{r\.condicion\} \/>/, "la tarjeta de resultado no renderiza el badge");
  assert.match(src, /condicion: r\.condicion/, "el ítem armado para el carrito no incluye la condición del resultado");
});

test("VistaBooking.tsx (SelectorPorFechas — modal de selección por fechas): resuelve, renderiza y propaga el badge", () => {
  const src = leer("app/tarifario/VistaBooking.tsx");
  assert.match(src, /import \{ CondicionHotelBadges, type CondicionHotelBadgeData \} from "@\/components\/cotizacion\/CondicionHotelBadges"/, "no importa el componente de badge");
  assert.match(src, /setCondicion\(r\.condicion \?\? null\)/, "no guarda la condición devuelta por cotizarPorFechas");
  assert.match(src, /<CondicionHotelBadges condicion=\{condicion\} \/>/, "el modal de selección por fechas no renderiza el badge");
  assert.match(src, /habitaciones, ninos, ninos2, infantes, pax, precio, edadesMenores, condicion,/, "el ítem armado para el carrito desde este modal no incluye la condición");
});

test("CartContext.tsx: HotelCartItem tiene el campo condicion (opcional, no afecta el total)", () => {
  const src = leer("lib/cart/CartContext.tsx");
  assert.match(src, /condicion\?: \{/, "HotelCartItem no declara el campo condicion");
  // El total del carrito se sigue sumando SOLO por `precio` — la condición
  // nunca debe colarse en el cálculo del total.
  assert.match(src, /const total = items\.reduce\(\(s, i\) => s \+ i\.precio, 0\);/);
});

test("CartDrawer.tsx: cada línea de hotel muestra el badge de condición", () => {
  const src = leer("app/tarifario/CartDrawer.tsx");
  assert.match(src, /import \{ CondicionHotelBadges \} from "@\/components\/cotizacion\/CondicionHotelBadges"/);
  assert.match(src, /<CondicionHotelBadges condicion=\{it\.condicion\} \/>/, "la línea de hotel del carrito no renderiza el badge");
});

test("CondicionHotelBadges no renderiza nada para una condición neutra sin restricción (nunca inventa un badge)", () => {
  const src = leer("components/cotizacion/CondicionHotelBadges.tsx");
  assert.match(src, /if \(!condicion\) return null;/);
  assert.match(src, /if \(neutra && !condicion\.restringido\) return null;/);
});
