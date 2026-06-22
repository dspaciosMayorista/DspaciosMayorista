"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { EditableText, EditableUrl } from '@/components/sitio/edicion/Editable';
import { useEdicion } from '@/components/sitio/edicion/EdicionContext';

// Sección "Consulta Disponibilidad": CTA que lleva a la vista booking del portal
// (el tarifario público). datos: {
//   titulo, boton_texto, url (def /tarifario), destino (opcional → ?destino=),
//   nueva_pestana (bool), imagen_fondo (opcional)
// }
const ConsultaDisponibilidad = ({ datos = {} }) => {
  const router = useRouter();
  const editable = !!useEdicion()?.editable;
  const titulo = datos.titulo || "Elige tu fecha Favorita aquí";
  const botonTexto = datos.boton_texto || "Consulta Disponibilidad";
  const base = datos.url || "/tarifario";
  const destino = (datos.destino || "").trim();
  const href = destino ? `${base}?destino=${encodeURIComponent(destino)}` : base;
  const nuevaPestana = !!datos.nueva_pestana;
  const imagenFondo = datos.imagen_fondo || "";

  const ir = () => {
    if (nuevaPestana) window.open(href, "_blank");
    else router.push(href);
  };

  return (
    <section
      className="relative py-20 bg-cover bg-center"
      style={imagenFondo ? { backgroundImage: `url(${imagenFondo})` } : undefined}
    >
      {imagenFondo ? <div className="absolute inset-0 bg-white/40" /> : null}
      <div className="relative z-10 container mx-auto px-4 text-center">
        <EditableText as="h2" campo="titulo" placeholder="Título" className="text-4xl md:text-5xl font-bold text-[#120573] mb-8">{titulo}</EditableText>
        <button
          type="button"
          onClick={() => { if (!editable) ir(); }}
          className="inline-block bg-[#d8f511] text-[#120573] font-bold text-xl md:text-2xl px-12 py-5 rounded-3xl shadow-lg hover:bg-[#c4e000] hover:scale-105 transition-all"
        >
          <EditableText as="span" campo="boton_texto" placeholder="Texto del botón">{botonTexto}</EditableText>
        </button>
        {editable ? <div className="mt-4"><EditableUrl campo="url" /></div> : null}
      </div>
    </section>
  );
};

export default ConsultaDisponibilidad;
