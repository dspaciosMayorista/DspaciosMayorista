"use client";

import React from 'react';
import { EditableText } from '@/components/sitio/edicion/Editable';
import { useEdicion } from '@/components/sitio/edicion/EdicionContext';

// Sección TEXTO. datos: { titulo, cuerpo }
// El cuerpo es texto plano; respetamos saltos de línea con whitespace-pre-line.
// NO usamos dangerouslySetInnerHTML (input libre del CMS sin sanitizar).
const Texto = ({ datos = {} }) => {
  const editable = !!useEdicion()?.editable;
  const titulo = datos.titulo || "";
  const cuerpo = datos.cuerpo || datos.texto || "";

  return (
    <section className="py-20 bg-white">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto">
          {(titulo || editable) ? (
            <EditableText as="h2" campo="titulo" placeholder="Título"
              className="text-3xl md:text-4xl font-bold text-[#120573] mb-6">
              {titulo}
            </EditableText>
          ) : null}
          {(cuerpo || editable) ? (
            <EditableText as="p" campo="cuerpo" placeholder="Escribe el texto…"
              className="text-lg text-gray-700 leading-relaxed whitespace-pre-line">
              {cuerpo}
            </EditableText>
          ) : null}
        </div>
      </div>
    </section>
  );
};

export default Texto;
