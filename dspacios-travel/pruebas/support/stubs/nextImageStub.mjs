// Stub de "next/image" para pruebas de interacción React (ver
// pruebas/support/reactLoader.mjs) — `next/image` no se puede resolver fuera
// del bundler de Next. Con `src` renderiza un <img> plano (para poder
// observar qué foto se muestra); sin `src` no renderiza nada.
import { createElement } from "react";
export default function ImageStub({ src, alt }) {
  return src ? createElement("img", { src, alt }) : null;
}
