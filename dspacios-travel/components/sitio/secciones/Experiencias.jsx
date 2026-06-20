"use client";

import React from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck, Headphones, Globe, Lock, HeartHandshake,
  Award, Star, Compass, Plane, Map,
} from 'lucide-react';
import { EditableText } from '@/components/sitio/edicion/Editable';
import { useEdicion } from '@/components/sitio/edicion/EdicionContext';

// Mapa de íconos disponibles (lucide-react de este repo no exporta todos).
const ICONOS = {
  shield: ShieldCheck,
  headphones: Headphones,
  globe: Globe,
  lock: Lock,
  corazon: HeartHandshake,
  award: Award,
  star: Star,
  compass: Compass,
  plane: Plane,
  map: Map,
};

// Sección EXPERIENCIAS. datos: { titulo?, subtitulo?, items?: [{titulo, texto, icono?}] }
const Experiencias = ({ datos = {} }) => {
  const editable = !!useEdicion()?.editable;
  const titulo = datos.titulo || "¿Por Qué Elegirnos?";
  const subtitulo = datos.subtitulo ||
    "Más que una agencia, somos tu socio de confianza en cada aventura.";

  const defaultItems = [
    { titulo: 'Atención Personalizada', texto: 'Asesores expertos disponibles para diseñar tu viaje a medida, escuchando cada una de tus necesidades.', icono: 'headphones' },
    { titulo: 'Paquetes Garantizados', texto: 'Sin sorpresas ocultas. Lo que reservas es lo que recibes, con total transparencia en cada detalle.', icono: 'shield' },
    { titulo: 'Aliados Internacionales', texto: 'Conectamos con las mejores cadenas hoteleras y operadores turísticos alrededor del mundo.', icono: 'globe' },
    { titulo: 'Seguridad en la Compra', texto: 'Plataforma segura y métodos de pago confiables para que tu única preocupación sea hacer la maleta.', icono: 'lock' },
    { titulo: 'Acompañamiento Total', texto: 'Estamos contigo antes, durante y después de tu viaje para asegurar una experiencia perfecta.', icono: 'corazon' },
  ];

  const items = Array.isArray(datos.items) && datos.items.length ? datos.items : defaultItems;

  return (
    <section className="py-24 bg-white relative overflow-hidden">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="text-[#d8f511] font-bold uppercase tracking-wider text-sm bg-[#120573] px-3 py-1 rounded-full">Experiencia Premium</span>
          <EditableText as="h2" campo="titulo" placeholder="Título" className="text-4xl md:text-5xl font-bold text-[#120573] mt-4 mb-6">{titulo}</EditableText>
          {(subtitulo || editable) ? (
            <EditableText as="p" campo="subtitulo" placeholder="Subtítulo" className="text-xl text-gray-600 max-w-2xl mx-auto font-light">{subtitulo}</EditableText>
          ) : null}
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 justify-center">
          {items.map((item, index) => {
            const Icon = ICONOS[item.icono] || Compass;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="bg-gray-50 p-8 rounded-2xl hover:shadow-xl transition-all duration-300 border border-gray-100 group hover:-translate-y-1"
              >
                <div className="w-16 h-16 bg-[#120573] rounded-2xl flex items-center justify-center mb-6 group-hover:bg-[#d8f511] transition-colors duration-300">
                  <Icon className="w-8 h-8 text-white group-hover:text-[#120573] transition-colors duration-300" />
                </div>
                <h3 className="text-xl font-bold text-[#120573] mb-3">{item.titulo}</h3>
                <p className="text-gray-600 leading-relaxed">{item.texto}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default Experiencias;
