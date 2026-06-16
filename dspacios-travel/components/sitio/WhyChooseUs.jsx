"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Headphones, Globe, Lock, HeartHandshake } from 'lucide-react';

const WhyChooseUs = () => {
  const reasons = [
    {
      icon: Headphones,
      title: 'Atención Personalizada',
      description: 'Asesores expertos disponibles para diseñar tu viaje a medida, escuchando cada una de tus necesidades.'
    },
    {
      icon: ShieldCheck,
      title: 'Paquetes Garantizados',
      description: 'Sin sorpresas ocultas. Lo que reservas es lo que recibes, con total transparencia en cada detalle.'
    },
    {
      icon: Globe,
      title: 'Aliados Internacionales',
      description: 'Conectamos con las mejores cadenas hoteleras y operadores turísticos alrededor del mundo.'
    },
    {
      icon: Lock,
      title: 'Seguridad en la Compra',
      description: 'Plataforma segura y métodos de pago confiables para que tu única preocupación sea hacer la maleta.'
    },
    {
      icon: HeartHandshake,
      title: 'Acompañamiento Total',
      description: 'Estamos contigo antes, durante y después de tu viaje para asegurar una experiencia perfecta.'
    }
  ];

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
          <h2 className="text-4xl md:text-5xl font-bold text-[#120573] mt-4 mb-6">
            ¿Por Qué Elegirnos?
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto font-light">
            Más que una agencia, somos tu socio de confianza en cada aventura.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 justify-center">
          {reasons.map((reason, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="bg-gray-50 p-8 rounded-2xl hover:shadow-xl transition-all duration-300 border border-gray-100 group hover:-translate-y-1"
            >
              <div className="w-16 h-16 bg-[#120573] rounded-2xl flex items-center justify-center mb-6 group-hover:bg-[#d8f511] transition-colors duration-300">
                <reason.icon className="w-8 h-8 text-white group-hover:text-[#120573] transition-colors duration-300" />
              </div>
              <h3 className="text-xl font-bold text-[#120573] mb-3">
                {reason.title}
              </h3>
              <p className="text-gray-600 leading-relaxed">
                {reason.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default WhyChooseUs;
