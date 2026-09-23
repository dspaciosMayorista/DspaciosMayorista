import { LoadingScreen } from "@/components/LoadingScreen";

// Fallback de este segmento: cubre `page.tsx` (ej. dashboard/page.tsx, ~13
// consultas). Rutas con loading.tsx propio (reservar, tarifario) nunca lo
// muestran — su Suspense más específico intercepta primero.
//
// `fullScreen={false}`: el sidebar/topbar ya están en pantalla cuando este
// Suspense se activa, así que el overlay solo cubre `<main>` (ahora
// `position: relative`) — no vuelve a tapar el chrome.
//
// Este fallback NO cubre la resolución de `layout.tsx` (sesión/rol/tenant) —
// eso lo cierra `app/loading.tsx`, un nivel arriba. Sin sesión, `proxy.ts`
// (middleware) ya redirige antes de que exista árbol de React, así que
// ninguno de los dos llega a mostrarse en ese caso.
//
// PENDIENTE: confirmar en Preview, con sesión autenticada real, que la
// secuencia completa no tenga parpadeo del sidebar/topbar.
export default function CargandoDashboard() {
  return <LoadingScreen fullScreen={false} />;
}
