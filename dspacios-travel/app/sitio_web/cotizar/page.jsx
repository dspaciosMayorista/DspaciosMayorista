"use client";

import React from 'react';
import { motion } from 'framer-motion';
import QuoteForm from '@/components/sitio/QuoteForm';
import { CheckCircle2, Award, Clock, HeartHandshake } from 'lucide-react';

export default function QuoteRequest() {
  const benefits = [
    { icon: <Clock className="w-6 h-6 text-[#d8f511]" />, title: "Respuesta Rápida", desc: "Cotización en menos de 24 horas" },
    { icon: <Award className="w-6 h-6 text-[#d8f511]" />, title: "Mejores Tarifas", desc: "Acuerdos directos con proveedores" },
    { icon: <HeartHandshake className="w-6 h-6 text-[#d8f511]" />, title: "Asesoría Experta", desc: "Personalizamos cada detalle" },
    { icon: <CheckCircle2 className="w-6 h-6 text-[#d8f511]" />, title: "Sin Compromiso", desc: "Cotiza gratis las veces que quieras" },
  ];

  return (
    <div className="pt-24 pb-16 min-h-screen bg-gray-50">
      <div className="container mx-auto px-4">

        <div className="max-w-4xl mx-auto mb-12 text-center">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-5xl font-extrabold text-[#120573] mb-4"
          >
            Comienza tu <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#120573] to-blue-600">Aventura</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-lg text-gray-600 max-w-2xl mx-auto"
          >
            Cuéntanos qué tienes en mente y nuestros expertos diseñarán una experiencia inolvidable a tu medida y presupuesto.
          </motion.p>
        </div>

        <div className="grid lg:grid-cols-12 gap-8 items-start">

          {/* Sidebar Benefits - Visible on desktop */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="hidden lg:block lg:col-span-4 space-y-6 sticky top-28"
          >
            <div className="bg-[#120573] rounded-3xl p-8 text-white shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#d8f511] rounded-full blur-3xl opacity-20 -mr-10 -mt-10"></div>
              <h3 className="text-2xl font-bold mb-6 relative z-10">¿Por qué cotizar con nosotros?</h3>

              <div className="space-y-6 relative z-10">
                {benefits.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-4">
                    <div className="p-2 bg-white/10 rounded-lg shrink-0">
                      {item.icon}
                    </div>
                    <div>
                      <h4 className="font-bold text-[#d8f511]">{item.title}</h4>
                      <p className="text-sm text-blue-100">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-8 pt-8 border-t border-white/10">
                <p className="text-sm text-blue-200 italic">
                  &quot;Hicieron de nuestra luna de miel algo mágico. La atención al detalle fue increíble.&quot;
                </p>
                <p className="text-xs text-[#d8f511] mt-2 font-bold">- María & José, Viajeros Felices</p>
              </div>
            </div>

            {/* Mobile/Quick Contact Info */}
            <div className="bg-white rounded-3xl p-6 shadow-lg border border-gray-100">
              <h4 className="font-bold text-[#120573] mb-2">¿Prefieres hablar ya?</h4>
              <p className="text-gray-600 text-sm mb-4">Llámanos o escríbenos directamente.</p>
              <a href="https://wa.me/573212150582" target="_blank" rel="noreferrer" className="block w-full text-center py-3 bg-green-50 text-green-600 rounded-xl font-bold hover:bg-green-100 transition-colors">
                WhatsApp Directo
              </a>
            </div>
          </motion.div>

          {/* Main Form Area */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="col-span-1 lg:col-span-8"
          >
            <QuoteForm />
          </motion.div>

        </div>
      </div>
    </div>
  );
}
