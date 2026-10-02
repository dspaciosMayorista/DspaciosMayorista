// Stub de "./actions" importado por `app/(auth)/login/LoginClient.tsx`
// (pruebas/loginSolicitarAccesoB2B.react.ts). La action real ("use server")
// arrastra next/headers y el cliente service-role. La prueba nunca usa el
// "Acceso de pruebas": si alguien la llegara a invocar, se registra y lanza
// para no silenciar en falso un uso inesperado.
export const __llamadas = [];
export async function loginConCodigo(codigo) {
  __llamadas.push(codigo);
  throw new Error("loginActionsStub: loginConCodigo no debería invocarse en esta prueba");
}
