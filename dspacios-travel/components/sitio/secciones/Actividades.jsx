import React from 'react';

// Sección ACTIVIDADES ("Actividades Imperdibles").
// datos: { titulo, intro, imagen_fondo, items: [{ titulo, texto }] }
// Render: título + intro + lista numerada de actividades, sobre imagen de fondo opcional.
const Actividades = ({ datos = {} }) => {
  const titulo = datos.titulo || 'Actividades Imperdibles';
  const intro = datos.intro || '';
  const fondo = typeof datos.imagen_fondo === 'string' ? datos.imagen_fondo : '';
  const items = Array.isArray(datos.items) ? datos.items : [];

  return (
    <section className="relative overflow-hidden">
      {fondo ? (
        <>
          <div className="absolute inset-0 z-0">
            <img className="w-full h-full object-cover" alt={titulo} src={fondo} />
            <div className="absolute inset-0 bg-[#120573]/85" />
          </div>
        </>
      ) : null}

      <div className={`relative z-10 py-16 ${fondo ? '' : 'bg-[#120573]'}`}>
        <div className="container mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-3">
            {titulo}
          </h2>
          {intro ? (
            <p className="text-lg text-gray-200 mb-8 max-w-2xl whitespace-pre-line">
              {intro}
            </p>
          ) : null}

          <ol className="space-y-5">
            {items.map((it, i) => (
              <li key={i} className="flex gap-4">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[#d8f511] font-extrabold text-[#120573]">
                  {i + 1}
                </span>
                <div>
                  {it?.titulo ? (
                    <h3 className="text-lg font-bold text-white">{it.titulo}</h3>
                  ) : null}
                  {it?.texto ? (
                    <p className="text-gray-200 leading-relaxed whitespace-pre-line">
                      {it.texto}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
};

export default Actividades;
