"use client";

import { createContext, useContext } from "react";

// Contexto de EDICIÓN IN-SITU del sitio. Cuando una sección se renderiza dentro
// del CMS, se envuelve con <EdicionSeccion> y sus campos editables (EditableText)
// se vuelven editables en vivo. En el sitio público NO hay provider → editable
// es false y todo se ve/renderiza igual que siempre.
//
//   value = { editable: boolean, datos: Record<string,unknown>, set(campo, valor) }
const EdicionCtx = createContext(null);

export function EdicionSeccion({ value, children }) {
  return <EdicionCtx.Provider value={value}>{children}</EdicionCtx.Provider>;
}

export function useEdicion() {
  return useContext(EdicionCtx);
}
