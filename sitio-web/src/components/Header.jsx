import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link, useLocation } from 'react-router-dom';

const Header = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();

  const whatsappLink = "https://wa.me/573212150582?text=%C2%A1Hola!%20He%20visto%20las%20ofertas%20de%20viajes%20de%20D%27SPACIOS%20TRAVEL%20y%20estoy%20interesado%20en%20saber%20m%C3%A1s%20detalles.%20%C2%BFPodr%C3%ADas%20darme%20m%C3%A1s%20informaci%C3%B3n?";

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isActive = (path) => location.pathname === path;

  const linkClass = (path) => `font-medium transition-colors ${
    isActive(path) ? 'text-[#120573] font-bold' : 'text-gray-700 hover:text-[#120573]'
  }`;

  return (
    <motion.header
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5 }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled ? 'bg-white shadow-lg' : 'bg-white/95 backdrop-blur-sm'
      }`}
    >
      <nav className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link to="/">
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="flex items-center cursor-pointer"
            >
              <img
                src="https://horizons-cdn.hostinger.com/bc38254b-0628-443e-a042-b2bb3af1fb5a/b4bdab48eba84a991f5567ce4c70da86.png"
                alt="Logo D'Spacios Travel"
                className="h-10 sm:h-12 w-auto object-contain"
              />
            </motion.div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center gap-6 xl:gap-8">
            <Link to="/paquetes" className={linkClass('/paquetes')}>
              Paquetes
            </Link>
            <Link to="/destinos" className={linkClass('/destinos')}>
              Destinos
            </Link>
            <Link to="/nosotros" className={linkClass('/nosotros')}>
              Nosotros
            </Link>
            <Link to="/testimonios" className={linkClass('/testimonios')}>
              Testimonios
            </Link>
            <Link to="/blog" className={linkClass('/blog')}>
              Blog
            </Link>
            <Link to="/cotizar" className={linkClass('/cotizar')}>
              Cotizar
            </Link>
            <Button
              className="bg-[#d8f511] text-[#120573] hover:bg-[#c5e010] font-bold px-6 shadow-lg"
              onClick={() => window.open(whatsappLink, '_blank')}
            >
              Reserva Aquí
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="lg:hidden text-[#120573]"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X size={28} /> : <Menu size={28} />}
          </button>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden mt-4 pb-4 space-y-4"
          >
            <Link to="/paquetes" className="block w-full text-left text-gray-700 hover:text-[#120573] font-medium py-2" onClick={() => setIsMobileMenuOpen(false)}>
              Paquetes
            </Link>
            <Link to="/destinos" className="block w-full text-left text-gray-700 hover:text-[#120573] font-medium py-2" onClick={() => setIsMobileMenuOpen(false)}>
              Destinos
            </Link>
            <Link to="/nosotros" className="block w-full text-left text-gray-700 hover:text-[#120573] font-medium py-2" onClick={() => setIsMobileMenuOpen(false)}>
              Nosotros
            </Link>
            <Link to="/testimonios" className="block w-full text-left text-gray-700 hover:text-[#120573] font-medium py-2" onClick={() => setIsMobileMenuOpen(false)}>
              Testimonios
            </Link>
            <Link to="/blog" className="block w-full text-left text-gray-700 hover:text-[#120573] font-medium py-2" onClick={() => setIsMobileMenuOpen(false)}>
              Blog
            </Link>
            <Link to="/cotizar" className="block w-full text-left text-[#120573] font-bold py-2 bg-blue-50 px-4 rounded-lg" onClick={() => setIsMobileMenuOpen(false)}>
              Cotizar
            </Link>
            <Button
              className="w-full bg-[#d8f511] text-[#120573] hover:bg-[#c5e010] font-bold shadow-lg"
              onClick={() => {
                window.open(whatsappLink, '_blank');
                setIsMobileMenuOpen(false);
              }}
            >
              Reserva Aquí
            </Button>
          </motion.div>
        )}
      </nav>
    </motion.header>
  );
};

export default Header;