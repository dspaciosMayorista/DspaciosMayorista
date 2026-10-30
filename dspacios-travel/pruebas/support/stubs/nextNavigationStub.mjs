// Stub de "next/navigation" para las pruebas de interacción React (ver
// pruebas/support/reactLoader.mjs) que montan componentes que usan `useRouter`
// (DifusionClient, LoginClient). Fuera del servidor de Next el hook real
// lanza; aquí basta un router falso. `push` registra el destino en `__pushes`
// (LoginClient: la prueba exige que cambiar de pestaña o seguir un enlace NO dispare
// una navegación programática) y, como Next, deja la URL nueva en la barra
// (history.pushState) y avisa a quien escuche con `__escuchar` — así una prueba de
// recorrido puede cambiar de página en el mismo árbol (el CartProvider vive en el layout).
export const __pushes = [];
const oyentes = new Set();
export function __escuchar(fn) {
  oyentes.add(fn);
  return () => { oyentes.delete(fn); };
}
function navegar(destino, reemplazar) {
  __pushes.push(destino);
  try { globalThis.window?.history[reemplazar ? "replaceState" : "pushState"]({}, "", destino); } catch { /* sin window: solo se registra */ }
  for (const fn of oyentes) fn(destino);
}
// Un solo objeto, como el router real (estable entre renders: se puede usar en las dependencias de un efecto).
const ROUTER = { refresh() {}, push(destino) { navegar(destino, false); }, replace(destino) { navegar(destino, true); } };
export function useRouter() {
  return ROUTER;
}
