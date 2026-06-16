"use client";

import React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';

// Sección DESTINOS_GRID. datos: { titulo?, subtitulo? }
// hijos: subpáginas (PaginaHijo[]) → tarjetas que enlazan a /[slug].
// destinos: fallback con tarjetas de web_destinos (sin enlace de subpágina).
const DestinosGrid = ({ datos = {}, hijos = [], destinos = [] }) => {
  const titulo = datos.titulo || "Nuestros Destinos";
  const subtitulo = datos.subtitulo || "";

  const usarHijos = Array.isArray(hijos) && hijos.length > 0;
  const items = usarHijos
    ? hijos.map((h) => ({
        key: h.slug,
        name: h.titulo,
        image: h.imagenPortada,
        href: `/${h.slug}`,
      }))
    : (destinos || []).map((d) => ({
        key: d.id,
        name: d.name,
        image: d.image,
        href: null,
      }));

  if (items.length === 0) return null;

  return (
    <section className="py-20 bg-white">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="text-4xl md:text-5xl font-bold text-[#120573] mb-4">{titulo}</h2>
          {subtitulo ? (
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">{subtitulo}</p>
          ) : null}
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {items.map((item, index) => {
            const card = (
              <div className="relative rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 h-full">
                <div className="aspect-square">
                  <img
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    alt={item.name}
                    src={item.image || "https://images.unsplash.com/photo-1595872018818-97555653a011"}
                  />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-[#120573]/80 via-[#120573]/40 to-transparent flex items-end">
                  <div className="p-4 w-full">
                    <h3 className="text-white font-bold text-xl">{item.name}</h3>
                  </div>
                </div>
              </div>
            );
            return (
              <motion.div
                key={item.key ?? index}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.04 }}
                className="group cursor-pointer"
              >
                {item.href ? (
                  <Link href={item.href} className="block h-full">{card}</Link>
                ) : (
                  card
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default DestinosGrid;
