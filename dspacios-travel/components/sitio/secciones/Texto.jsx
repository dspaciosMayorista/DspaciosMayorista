import React from 'react';

// Sección TEXTO. datos: { titulo, cuerpo }
// El cuerpo es texto plano; respetamos saltos de línea con whitespace-pre-line.
// NO usamos dangerouslySetInnerHTML (input libre del CMS sin sanitizar).
const Texto = ({ datos = {} }) => {
  const titulo = datos.titulo || "";
  const cuerpo = datos.cuerpo || datos.texto || "";

  return (
    <section className="py-20 bg-white">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto">
          {titulo ? (
            <h2 className="text-3xl md:text-4xl font-bold text-[#120573] mb-6">
              {titulo}
            </h2>
          ) : null}
          {cuerpo ? (
            <p className="text-lg text-gray-700 leading-relaxed whitespace-pre-line">
              {cuerpo}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
};

export default Texto;
