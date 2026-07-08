"use client";

import React, { useEffect, useRef, useState } from "react";
import { Link2 } from "lucide-react";
import { useEdicion } from "./EdicionContext";
import { subirArchivoWeb } from "@/app/cms/upload";

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
  // Si la URL de la imagen falla (borrada, mal pegada), el navegador muestra
  // el ícono roto + el `alt` como texto plano sin estilo — feo y sin contraste
  // sobre fondos de color. Mejor no mostrar nada (el contenedor/gradiente de
  // la sección queda como fondo).
  const [error, setError] = useState(false);
  useEffect(() => setError(false), [src]);

  if (!editable) {
    if (!src || error) return null;
    return <img src={src} alt={alt} className={className} onError={() => setError(true)} />;
  }

  const fileRef = useRef(null);
  const [subiendo, setSubiendo] = useState(false);

  const elegirArchivo = () => fileRef.current?.click();

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("carpeta", "img");
      const r = await subirArchivoWeb(fd);
      if (r.ok) ctx.set(campo, r.url);
      else window.alert(r.error || "No se pudo subir la imagen.");
    } catch {
      window.alert("No se pudo subir la imagen (archivo muy pesado o falla de conexión). Intenta con un archivo más liviano.");
    } finally {
      setSubiendo(false);
    }
  };

  const pegarUrl = (e) => {
    e.stopPropagation();
    const url = window.prompt("Pega la URL de la imagen:", String(ctx.datos?.[campo] ?? ""));
    if (url != null) ctx.set(campo, url.trim());
  };

  return (
    <>
      {src && !error ? (
        <img src={src} alt={alt} className={className} onError={() => setError(true)} />
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={onFile}
        className="hidden"
        data-cms-tb=""
      />
      <div data-cms-tb="" className="absolute left-3 top-3 z-30 flex items-center gap-1">
        <button
          type="button"
          data-cms-tb=""
          onClick={elegirArchivo}
          disabled={subiendo}
          className="inline-flex items-center gap-1 rounded-lg bg-black/60 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-black/80 disabled:opacity-60"
        >
          {subiendo ? "Subiendo…" : "Cambiar imagen"}
        </button>
        <button
          type="button"
          data-cms-tb=""
          onClick={pegarUrl}
          title="Pegar una URL en vez de subir un archivo"
          className="inline-flex items-center gap-1 rounded-lg bg-black/60 px-2 py-1.5 text-xs font-semibold text-white shadow hover:bg-black/80"
        >
          <Link2 size={13} />
        </button>
      </div>
    </>
  );
}

// Editor IN-SITU del ENLACE (URL) de un botón. Fuera del CMS no renderiza nada
// (el botón se ve igual). Dentro del CMS muestra un chip "Enlace" que abre un
// prompt para fijar la URL de redirección. Los botones quedan INACTIVOS en el
// CMS (no navegan); este chip es la forma de editar su destino.
export function EditableUrl({ campo, className = "" }) {
  const ctx = useEdicion();
  if (!ctx?.editable) return null;

  const actual = String(ctx.datos?.[campo] ?? "");
  const editar = (e) => {
    e.stopPropagation();
    const url = window.prompt("Enlace del botón (URL de redirección):", actual);
    if (url != null) ctx.set(campo, url.trim());
  };

  return (
    <button
      type="button"
      data-cms-tb=""
      onClick={editar}
      onPointerDown={(e) => e.stopPropagation()}
      title={actual || "Sin enlace"}
      className={`inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white shadow hover:bg-black/80 ${className}`}
    >
      <Link2 size={12} /> Enlace
    </button>
  );
}
