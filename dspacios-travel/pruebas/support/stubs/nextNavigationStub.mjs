// Stub de "next/navigation" para las pruebas de interacción React (ver
// pruebas/support/reactLoader.mjs) que montan componentes que usan `useRouter`
// (DifusionClient). Fuera del servidor de Next el hook real lanza; aquí basta
// un router falso que no navega.
export function useRouter() {
  return { refresh() {} };
}