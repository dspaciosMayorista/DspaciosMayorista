// Stub de "next/navigation" para las pruebas de interacción React (ver
// pruebas/support/reactLoader.mjs) que montan componentes que usan `useRouter`
// (DifusionClient, LoginClient). Fuera del servidor de Next el hook real
// lanza; aquí basta un router falso que no navega. `push` solo registra el
// destino en `__pushes` (LoginClient: la prueba exige que cambiar de pestaña o
// seguir un enlace NO dispare una navegación programática).
export const __pushes = [];
export function useRouter() {
  return { refresh() {}, push(destino) { __pushes.push(destino); } };
}
