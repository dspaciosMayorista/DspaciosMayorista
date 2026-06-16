"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { Star, Quote, MessageCircle } from 'lucide-react';
import { Button } from '@/components/sitio/ui/button';
import { testimonials } from '@/lib/sitio/data';

export default function TestimonialsPage() {
  return (
    <div className="pt-28 pb-24 bg-gray-50 min-h-screen">
      <div className="container mx-auto px-4">
        <div className="text-center mb-20">
          <h1 className="text-4xl md:text-5xl font-bold text-[#120573] mb-6">Historias de Viajeros Felices</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            No confíes solo en nuestra palabra. Lee lo que nuestros viajeros tienen para decir sobre sus experiencias con D'Spacios Travel.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-20">
          {testimonials.map((item, idx) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="bg-white p-10 rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 flex flex-col h-full relative overflow-hidden group"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#d8f511]/10 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-150 duration-500"></div>

              <div className="flex items-center gap-5 mb-8 relative z-10">
                <div className="p-1 bg-gradient-to-br from-[#120573] to-[#d8f511] rounded-full">
                  <img src={item.image} alt={item.name} className="w-16 h-16 rounded-full object-cover border-4 border-white" />
                </div>
                <div>
                  <h3 className="font-bold text-[#120573] text-lg">{item.name}</h3>
                  <p className="text-sm text-gray-500 font-medium">{item.location}</p>
                </div>
              </div>

              <div className="flex gap-1 mb-6">
                {[...Array(item.rating)].map((_, i) => (
                  <Star key={i} className="w-5 h-5 fill-[#d8f511] text-[#d8f511]" />
                ))}
              </div>

              <div className="relative flex-grow">
                <Quote className="absolute -top-4 -left-2 w-8 h-8 text-gray-100" />
                <p className="text-gray-600 italic relative z-10 leading-relaxed">"{item.comment}"</p>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="bg-[#120573] rounded-3xl p-12 text-center text-white shadow-2xl relative overflow-hidden max-w-4xl mx-auto">
          <div className="relative z-10">
            <h2 className="text-3xl font-bold mb-6">¿Quieres vivir tu propia experiencia?</h2>
            <p className="text-lg text-white/80 mb-8 max-w-2xl mx-auto">
              Únete a miles de viajeros satisfechos y comienza a planear el viaje de tus sueños hoy mismo.
            </p>
            <Button
              className="bg-[#25D366] hover:bg-[#1ebc57] text-white font-bold px-10 py-8 text-lg rounded-full shadow-lg hover:shadow-green-300/50 transition-all"
              onClick={() => window.open('https://wa.me/573212150582', '_blank')}
            >
              <MessageCircle className="mr-3 w-6 h-6" /> Quiero ser el próximo viajero feliz
            </Button>
          </div>

          {/* Decorative circles */}
          <div className="absolute top-0 left-0 w-64 h-64 bg-[#d8f511] rounded-full blur-3xl opacity-10 -translate-x-1/2 -translate-y-1/2"></div>
          <div className="absolute bottom-0 right-0 w-64 h-64 bg-[#d8f511] rounded-full blur-3xl opacity-10 translate-x-1/2 translate-y-1/2"></div>
        </div>
      </div>
    </div>
  );
}
