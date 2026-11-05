// Stub de "./actions" cuando lo importa PaqueteTotalForm.tsx (ver pruebas/support/reactLoader.mjs). El archivo real arrastra Supabase del servidor y todo el motor;
// aquí `guardarPaqueteTotal` solo registra la entrada que recibiría el servidor, para comprobar lo que el formulario enviaría.
export const llamadas = [];
export async function guardarPaqueteTotal(entrada) {
  llamadas.push(entrada);
  return { ok: true, id: 1 };
}
