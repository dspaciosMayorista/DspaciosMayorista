"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/sitio/ui/button';
import { EditableText } from '@/components/sitio/edicion/Editable';
import { useEdicion } from '@/components/sitio/edicion/EdicionContext';

// Sección CTA. datos: { titulo, texto, boton_texto, boton_url }
const Cta = ({ datos = {} }) => {
  const router = useRouter();
  const editable = !!useEdicion()?.editable;
  const titulo = datos.titulo || "¿Por qué elegirnos?";
  const texto = datos.texto || "";
  const botonTexto = datos.boton_texto || "Ver Tarifario";
  const botonUrl = datos.boton_url || "/tarifario";

  const esExterno = /^https?:\/\//i.test(botonUrl);

  return (
    <section className="py-20 bg-white">
      <div className="container mx-auto px-4">
        <div className="bg-[#120573] rounded-3xl p-12 text-center text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-40 h-40 bg-[#d8f511] rounded-full blur-3xl opacity-20 -mr-10 -mt-10"></div>
          <div className="relative z-10">
            <EditableText as="h2" campo="titulo" placeholder="Título" className="text-3xl font-bold mb-6">{titulo}</EditableText>
            {(texto || editable) ? (
              <EditableText as="p" campo="texto" placeholder="Texto de apoyo" className="text-xl mb-8 max-w-2xl mx-auto text-white/90">{texto}</EditableText>
            ) : null}
            <Button
              className="bg-[#d8f511] text-[#120573] hover:bg-white font-bold text-lg px-8 py-6"
              onClick={() => {
                if (editable) return;
                if (esExterno) window.open(botonUrl, '_blank');
                else router.push(botonUrl);
              }}
            >
              {botonTexto}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Cta;
