"use client";

import React from 'react';
import { motion } from 'framer-motion';

// Sección GALERÍA. datos: { titulo?, imagenes: string[] }
const Galeria = ({ datos = {} }) => {
  const titulo = datos.titulo || "";
  const imagenes = Array.isArray(datos.imagenes) ? datos.imagenes.filter(Boolean) : [];
  if (imagenes.length === 0) return null;

  return (
    <section className="py-20 bg-gray-50">
      <div className="container mx-auto px-4">
        {titulo ? (
          <h2 className="text-3xl md:text-4xl font-bold text-[#120573] mb-10 text-center">
            {titulo}
          </h2>
        ) : null}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {imagenes.map((src, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.04 }}
              className="rounded-2xl overflow-hidden shadow-lg aspect-square group"
            >
              <img
                src={src}
                alt={`Imagen ${i + 1}`}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
              />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Galeria;
