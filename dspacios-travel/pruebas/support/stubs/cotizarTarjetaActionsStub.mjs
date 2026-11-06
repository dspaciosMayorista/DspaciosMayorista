// Stub de "app/tarifario/cotizarTarjetaActions" para las pruebas React (el archivo real es "use server" y termina en next/headers).
// Las pruebas de la tarjeta inyectan su propia función `cotizar`; si alguna llamara a la acción real, falla claro.
export async function cotizarTarjetaHotel(...args) {
  if (globalThis.__cotizarTarjetaFake) return globalThis.__cotizarTarjetaFake(...args); // recorrido tarjeta → modal
  throw new Error("cotizarTarjetaHotel: no implementado en el stub de pruebas — inyecta `cotizar` en la tarjeta");
}
