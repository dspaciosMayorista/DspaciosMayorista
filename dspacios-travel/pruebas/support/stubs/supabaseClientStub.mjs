// Stub de "@/lib/supabase/client" para `LoginClient.tsx`
// (pruebas/loginSolicitarAccesoB2B.react.ts). Registra cada vez que el login
// crea un cliente de Supabase: cambiar de pestaña o seguir el enlace de
// solicitud de acceso NUNCA deben tocar la autenticación. Cualquier llamada de
// auth lanza para hacerlo evidente.
export const __llamadas = [];
export function createClient() {
  __llamadas.push("createClient");
  const lanzar = (m) => () => { throw new Error(`supabaseClientStub: ${m} no debería invocarse`); };
  return {
    auth: { signInWithPassword: lanzar("signInWithPassword"), signInWithOAuth: lanzar("signInWithOAuth"), signOut: lanzar("signOut") },
    from: lanzar("from"),
  };
}
