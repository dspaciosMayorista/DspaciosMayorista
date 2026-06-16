"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Target, Heart, Award, ShieldCheck, Users, Globe } from 'lucide-react';
import { Button } from '@/components/sitio/ui/button';

export default function About() {
  const router = useRouter();
  return (
    <div className="pt-28 pb-20 bg-white">
      <div className="container mx-auto px-4">
        {/* Hero Section */}
        <div className="text-center max-w-3xl mx-auto mb-20">
          <h1 className="text-4xl md:text-5xl font-bold text-[#120573] mb-6">Más que una agencia, somos tus compañeros de viaje</h1>
          <p className="text-xl text-gray-600 leading-relaxed">
            Desde 2008, D'Spacios Travel ha sido sinónimo de confianza, calidad y experiencias inolvidables.
          </p>
        </div>

        {/* Mission & Vision */}
        <div className="grid md:grid-cols-2 gap-12 mb-20">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="bg-gray-50 p-8 rounded-2xl border-l-4 border-[#120573]"
          >
            <div className="w-12 h-12 bg-[#120573] rounded-full flex items-center justify-center mb-6">
              <Target className="text-white w-6 h-6" />
            </div>
            <h2 className="text-2xl font-bold text-[#120573] mb-4">Nuestra Misión</h2>
            <p className="text-gray-700">
              Brindar experiencias turísticas integrales de alta calidad, superando las expectativas de nuestros clientes a través de un servicio personalizado, innovador y confiable, fomentando el turismo responsable y sostenible.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="bg-gray-50 p-8 rounded-2xl border-l-4 border-[#d8f511]"
          >
            <div className="w-12 h-12 bg-[#d8f511] rounded-full flex items-center justify-center mb-6">
              <Globe className="text-[#120573] w-6 h-6" />
            </div>
            <h2 className="text-2xl font-bold text-[#120573] mb-4">Nuestra Visión</h2>
            <p className="text-gray-700">
              Ser reconocidos en 2030 como la agencia mayorista líder en innovación turística en la región, conectando personas con destinos soñados y creando recuerdos que perduran toda la vida.
            </p>
          </motion.div>
        </div>

        {/* Values */}
        <div className="mb-20">
          <h2 className="text-3xl font-bold text-[#120573] text-center mb-12">Nuestros Valores</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: ShieldCheck, title: 'Integridad', desc: 'Transparencia y honestidad en cada trato.' },
              { icon: Heart, title: 'Pasión', desc: 'Amamos viajar y transmitimos esa emoción.' },
              { icon: Users, title: 'Servicio', desc: 'El cliente es el centro de nuestro universo.' },
              { icon: Award, title: 'Excelencia', desc: 'Calidad garantizada en cada detalle.' },
            ].map((val, i) => (
              <div key={i} className="text-center p-6 hover:shadow-lg transition-shadow rounded-xl">
                <val.icon className="w-12 h-12 text-[#d8f511] mx-auto mb-4" />
                <h3 className="text-xl font-bold text-[#120573] mb-2">{val.title}</h3>
                <p className="text-gray-600">{val.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="bg-[#120573] rounded-3xl p-12 text-center text-white relative overflow-hidden">
          <div className="relative z-10">
            <h2 className="text-3xl font-bold mb-6">¿Por qué elegirnos?</h2>
            <p className="text-xl mb-8 max-w-2xl mx-auto text-white/90">
              15+ años de experiencia, miles de viajeros felices y alianzas con las mejores cadenas hoteleras del mundo.
            </p>
            <Button
              className="bg-[#d8f511] text-[#120573] hover:bg-white font-bold text-lg px-8 py-6"
              onClick={() => router.push('/tarifario')}
            >
              Ver Tarifario
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
