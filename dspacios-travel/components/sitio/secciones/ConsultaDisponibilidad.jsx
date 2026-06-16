"use client";

import React from 'react';
import { useRouter } from 'next/navigation';

// Sección "Consulta Disponibilidad": CTA que lleva a la vista booking del portal
// (el tarifario público). datos: {
//   titulo, boton_texto, url (def /tarifario), destino (opcional → ?destino=),
//   nueva_pestana (bool), imagen_fondo (opcional)
// }
const ConsultaDisponibilidad = ({ datos = {} }) => {
  const router = useRouter();
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
        <h2 className="text-4xl md:text-5xl font-bold text-[#120573] mb-8">{titulo}</h2>
        <button
          type="button"
          onClick={ir}
          className="inline-block bg-[#d8f511] text-[#120573] font-bold text-xl md:text-2xl px-12 py-5 rounded-3xl shadow-lg hover:bg-[#c4e000] hover:scale-105 transition-all"
        >
          {botonTexto}
        </button>
      </div>
    </section>
  );
};

export default ConsultaDisponibilidad;
