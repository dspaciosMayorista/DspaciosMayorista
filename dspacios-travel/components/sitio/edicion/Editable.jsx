"use client";

import React from "react";
import { useEdicion } from "./EdicionContext";

// Texto editable IN-SITU. Fuera del CMS (sin provider) renderiza `children` tal
// cual (el sitio público no cambia). Dentro del CMS se vuelve contentEditable y
// guarda el campo al salir (onBlur), sin re-render mientras se escribe.
//
//   <EditableText as="h1" campo="titulo" className="..." placeholder="Título">
//     {titulo}
//   </EditableText>
export function EditableText({
  campo,
  as = "span",
  className = "",
  placeholder = "",
  children,
}) {
  const ctx = useEdicion();
  const Tag = as;

  if (!ctx?.editable) {
    return <Tag className={className}>{children}</Tag>;
  }

  const valor = ctx.datos?.[campo];
  const texto = valor == null ? "" : String(valor);

  return (
    <Tag
      className={`${className} cms-editable`}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-cms-placeholder={placeholder}
      // Evita que el click de selección/arrastre del bloque robe el foco al texto.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        const nuevo = e.currentTarget.textContent ?? "";
        if (nuevo !== texto) ctx.set(campo, nuevo);
      }}
    >
      {texto}
    </Tag>
  );
}
