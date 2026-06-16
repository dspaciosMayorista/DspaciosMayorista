import React from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

const WhiteLabelCTA = () => {
  return (
    <section className="py-8 bg-gradient-to-r from-[#120573] to-[#1a0a9e]">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="flex flex-col md:flex-row items-center justify-between gap-6"
        >
          <div className="flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-[#d8f511]" />
            <div>
              <h3 className="text-xl md:text-2xl font-bold text-white">Sistema de Reservas de Marca Blanca</h3>
              <p className="text-white/80 text-sm md:text-base">Accede a nuestro portal exclusivo para agencias</p>
            </div>
          </div>
          <Button
            size="lg"
            className="bg-[#d8f511] text-[#120573] hover:bg-[#c5e010] font-bold px-8 shadow-xl whitespace-nowrap"
            onClick={() => window.open('https://www.booking.com', '_blank')}
          >
            <ExternalLink className="mr-2 h-5 w-5" />
            Reserva Aquí - Marca Blanca
          </Button>
        </motion.div>
      </div>
    </section>
  );
};

export default WhiteLabelCTA;