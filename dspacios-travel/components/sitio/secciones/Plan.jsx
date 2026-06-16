import React from 'react';

// Sección PLAN ("El plan incluye / no incluye").
// datos: { incluye_titulo, incluye: string[], no_incluye_titulo, no_incluye: string[] }
const Plan = ({ datos = {} }) => {
  const incluyeTitulo = datos.incluye_titulo || 'El plan incluye:';
  const noIncluyeTitulo = datos.no_incluye_titulo || 'El Plan no Incluye:';
  const incluye = Array.isArray(datos.incluye)
    ? datos.incluye.filter((x) => typeof x === 'string' && x.trim())
    : [];
  const noIncluye = Array.isArray(datos.no_incluye)
    ? datos.no_incluye.filter((x) => typeof x === 'string' && x.trim())
    : [];

  return (
    <section className="bg-[#120573] py-16">
      <div className="container mx-auto px-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm md:p-8">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <div>
              <h3 className="mb-4 text-xl font-extrabold text-[#d8f511]">
                {incluyeTitulo}
              </h3>
              <ul className="space-y-2">
                {incluye.map((t, i) => (
                  <li key={i} className="flex gap-2 text-gray-100">
                    <span className="mt-1 text-[#d8f511]">•</span>
                    <span className="whitespace-pre-line">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-4 text-xl font-extrabold text-white">
                {noIncluyeTitulo}
              </h3>
              <ul className="space-y-2">
                {noIncluye.map((t, i) => (
                  <li key={i} className="flex gap-2 text-gray-300">
                    <span className="mt-1 text-white/50">•</span>
                    <span className="whitespace-pre-line">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Plan;
