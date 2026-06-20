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

// Imagen editable IN-SITU. Fuera del CMS renderiza el <img> tal cual. Dentro del
// CMS muestra además un botón "Cambiar imagen" (sobre el contenedor posicionado
// padre). `fallback` es la imagen efectiva que ya calcula el componente.
export function EditableImage({
  campo,
  fallback = "",
  alt = "",
  className = "",
}) {
  const ctx = useEdicion();
  const editable = !!ctx?.editable;
  const valor = editable ? String(ctx.datos?.[campo] ?? "") : "";
  const src = editable ? valor || fallback : fallback;

  if (!editable) {
    return <img src={src} alt={alt} className={className} />;
  }

  const cambiar = () => {
    const url = window.prompt("Pega la URL de la imagen:", String(ctx.datos?.[campo] ?? ""));
    if (url != null) ctx.set(campo, url.trim());
  };

  return (
    <>
      <img src={src} alt={alt} className={className} />
      <button
        type="button"
        data-cms-tb=""
        onClick={cambiar}
        className="absolute left-3 top-3 z-30 inline-flex items-center gap-1 rounded-lg bg-black/60 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-black/80"
      >
        Cambiar imagen
      </button>
    </>
  );
}
