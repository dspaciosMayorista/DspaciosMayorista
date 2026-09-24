// Stub de "next/link" para pruebas de interacción React (ver
// pruebas/support/reactLoader.mjs) — mismo problema que next/image: no se
// resuelve fuera del bundler de Next. Un <a> real es suficiente para probar
// DOM/eventos (nunca se navega de verdad en jsdom).
import React from "react";
export default function LinkStub({ href, children, ...props }) {
  return React.createElement("a", { href, ...props }, children);
}
