import React from 'react';
import { motion } from 'framer-motion';
import { MessageCircle, CalendarCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

const Hero = () => {
  const whatsappLink = "https://wa.me/573212150582?text=%C2%A1Hola!%20He%20visto%20las%20ofertas%20de%20viajes%20de%20D%27SPACIOS%20TRAVEL%20y%20estoy%20interesado%20en%20saber%20m%C3%A1s%20detalles.%20%C2%BFPodr%C3%ADas%20darme%20m%C3%A1s%20informaci%C3%B3n?";

  return (
    <section id="hero" className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <img 
          className="w-full h-full object-cover"
          alt="Destino turístico paradisíaco"
          src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=80" 
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#120573]/90 via-[#120573]/60 to-transparent"></div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 z-10">
        <div className="max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <motion.span 
              className="inline-block py-1 px-3 rounded-full bg-[#d8f511] text-[#120573] font-bold text-sm mb-6 tracking-wide uppercase"
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
            >
              Agencia Mayorista de Viajes
            </motion.span>

            <motion.h1
              className="text-5xl md:text-7xl lg:text-8xl font-extrabold text-white mb-6 leading-tight tracking-tight"
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
            >
              Tu Próxima Aventura <br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#d8f511] to-white">
                Comienza Aquí
              </span>
            </motion.h1>
            
            <motion.p
              className="text-xl md:text-2xl text-gray-200 mb-10 leading-relaxed max-w-2xl font-light"
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
            >
              Creamos itinerarios personalizados que superan tus expectativas y transforman tus sueños en realidad.
            </motion.p>

            <motion.div
              className="flex flex-col sm:flex-row gap-4"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
            >
              <Button
                size="lg"
                className="bg-[#25D366] hover:bg-[#1ebc57] text-white font-bold text-lg px-8 py-7 rounded-xl shadow-2xl hover:shadow-[#25D366]/30 transition-all flex items-center gap-3"
                onClick={() => window.open(whatsappLink, '_blank')}
              >
                <MessageCircle className="h-6 w-6" />
                Cotizar por WhatsApp
              </Button>
              <Button
                size="lg"
                className="bg-[#d8f511] text-[#120573] hover:bg-[#cbe610] font-bold text-lg px-8 py-7 rounded-xl shadow-2xl hover:shadow-[#d8f511]/30 transition-all flex items-center gap-3"
                onClick={() => window.open(whatsappLink, '_blank')}
              >
                <CalendarCheck className="h-6 w-6" />
                Reserva Aquí
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Decorative Elements */}
      <motion.div
        className="absolute bottom-10 left-1/2 transform -translate-x-1/2"
        animate={{ y: [0, 10, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <div className="w-6 h-10 border-2 border-white/30 rounded-full flex items-start justify-center p-2">
          <div className="w-1 h-2 bg-[#d8f511] rounded-full"></div>
        </div>
      </motion.div>
    </section>
  );
};

export default Hero;