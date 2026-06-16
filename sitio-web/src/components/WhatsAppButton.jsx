import React from 'react';
import { motion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';

const WhatsAppButton = () => {
  const whatsappLink = "https://wa.me/573212150582?text=%C2%A1Hola!%20He%20visto%20las%20ofertas%20de%20viajes%20de%20D%27SPACIOS%20TRAVEL%20y%20estoy%20interesado%20en%20saber%20m%C3%A1s%20detalles.%20%C2%BFPodr%C3%ADas%20darme%20m%C3%A1s%20informaci%C3%B3n?";

  const handleWhatsAppClick = () => {
    window.open(whatsappLink, '_blank');
  };

  return (
    <motion.button
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ duration: 0.3, delay: 1 }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      onClick={handleWhatsAppClick}
      className="fixed bottom-6 right-6 z-50 w-16 h-16 bg-[#25D366] hover:bg-[#20BA5A] rounded-full shadow-2xl flex items-center justify-center group transition-all"
      aria-label="Contactar por WhatsApp"
    >
      <MessageCircle className="w-8 h-8 text-white" />
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        whileHover={{ opacity: 1, x: -10 }}
        className="absolute right-full mr-4 bg-[#120573] text-white px-4 py-2 rounded-lg whitespace-nowrap shadow-lg hidden group-hover:block"
      >
        ¿Necesitas ayuda? ¡Escríbenos!
      </motion.div>
    </motion.button>
  );
};

export default WhatsAppButton;