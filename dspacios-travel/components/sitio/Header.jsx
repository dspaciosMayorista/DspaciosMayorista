"use client";

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Menu, X, ChevronDown, Phone } from 'lucide-react';
import { Button } from '@/components/sitio/ui/button';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Construye el menú desde el árbol getMenu(). Los ítems con hijos
// (Destinos Nacionales/Internacionales) se muestran como desplegables.
const Header = ({ config, menu }) => {
  const items = Array.isArray(menu) ? menu : [];
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [openDesktop, setOpenDesktop] = useState(null);
  const [openMobile, setOpenMobile] = useState(null);
  const pathname = usePathname();

  const waNumero = config?.whatsappNumero || "573212150582";
  const waMensaje = config?.whatsappMensaje
    ? encodeURIComponent(config.whatsappMensaje)
    : "%C2%A1Hola!%20He%20visto%20las%20ofertas%20de%20viajes%20de%20D%27SPACIOS%20TRAVEL%20y%20estoy%20interesado%20en%20saber%20m%C3%A1s%20detalles.%20%C2%BFPodr%C3%ADas%20darme%20m%C3%A1s%20informaci%C3%B3n?";
  const whatsappLink = `https://wa.me/${waNumero}?text=${waMensaje}`;

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Líneas de atención para la barra superior.
  const lineas = [];
  if (config?.contactoTelefono) lineas.push(config.contactoTelefono);
  if (Array.isArray(config?.lineasAtencion)) lineas.push(...config.lineasAtencion);
  if (config?.telefonoFijo) lineas.push(config.telefonoFijo);
  const lineasUnicas = [...new Set(lineas.filter(Boolean))];

  const hrefDe = (item) => (item.slug === 'inicio' ? '/' : `/${item.slug}`);
  const isActive = (href) => pathname === href;
  const linkClass = (href) => `font-medium transition-colors ${
    isActive(href) ? 'text-[#120573] font-bold' : 'text-gray-700 hover:text-[#120573]'
  }`;

  const closeAll = () => {
    setIsMobileMenuOpen(false);
    setOpenMobile(null);
    setOpenDesktop(null);
  };

  return (
    <>
      {/* Barra superior: Líneas de Atención */}
      {lineasUnicas.length > 0 && (
        <div className="hidden md:block bg-[#120573] text-white text-sm">
          <div className="container mx-auto px-4 py-1.5 flex items-center justify-end gap-6">
            <span className="flex items-center gap-2 text-[#d8f511] font-semibold uppercase tracking-wide text-xs">
              <Phone className="w-4 h-4" /> Líneas de Atención
            </span>
            <div className="flex items-center gap-4">
              {lineasUnicas.map((tel, i) => (
                <a key={i} href={`tel:${tel.replace(/\s+/g, '')}`} className="hover:text-[#d8f511] transition-colors">
                  {tel}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      <motion.header
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.5 }}
        className={`sticky top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled ? 'bg-white shadow-lg' : 'bg-white/95 backdrop-blur-sm'
        }`}
      >
        <nav className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" onClick={closeAll}>
              <motion.div whileHover={{ scale: 1.02 }} className="flex items-center cursor-pointer">
                <img
                  src="https://horizons-cdn.hostinger.com/bc38254b-0628-443e-a042-b2bb3af1fb5a/b4bdab48eba84a991f5567ce4c70da86.png"
                  alt="Logo D'Spacios Travel"
                  className="h-10 sm:h-12 w-auto object-contain"
                />
              </motion.div>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-5 xl:gap-7">
              {items.map((item) => {
                const tieneHijos = item.hijos && item.hijos.length > 0;
                if (tieneHijos) {
                  return (
                    <div
                      key={item.id}
                      className="relative"
                      onMouseEnter={() => setOpenDesktop(item.id)}
                      onMouseLeave={() => setOpenDesktop(null)}
                    >
                      <button className="flex items-center gap-1 font-medium text-gray-700 hover:text-[#120573] transition-colors">
                        {item.etiquetaMenu}
                        <ChevronDown className={`w-4 h-4 transition-transform ${openDesktop === item.id ? 'rotate-180' : ''}`} />
                      </button>
                      {openDesktop === item.id && (
                        <div className="absolute left-0 top-full pt-2 w-64 z-50">
                          <div className="bg-white rounded-xl shadow-xl border border-gray-100 py-2 max-h-[70vh] overflow-y-auto">
                            <Link href={hrefDe(item)} onClick={closeAll} className="block px-4 py-2 text-sm font-bold text-[#120573] hover:bg-gray-50">
                              Ver todo
                            </Link>
                            {item.hijos.map((h) => (
                              <Link
                                key={h.id}
                                href={`/${h.slug}`}
                                onClick={closeAll}
                                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-[#120573] transition-colors"
                              >
                                {h.etiquetaMenu}
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }
                const href = hrefDe(item);
                return (
                  <Link key={item.id} href={href} className={linkClass(href)}>
                    {item.etiquetaMenu}
                  </Link>
                );
              })}
              <Link href="/tarifario" className={linkClass('/tarifario')}>
                Tarifario
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
              aria-label="Menú"
            >
              {isMobileMenuOpen ? <X size={28} /> : <Menu size={28} />}
            </button>
          </div>

          {/* Mobile Menu */}
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="lg:hidden mt-4 pb-4 space-y-1 max-h-[70vh] overflow-y-auto"
            >
              {items.map((item) => {
                const tieneHijos = item.hijos && item.hijos.length > 0;
                if (tieneHijos) {
                  const abierto = openMobile === item.id;
                  return (
                    <div key={item.id}>
                      <button
                        className="w-full flex items-center justify-between text-left text-gray-700 hover:text-[#120573] font-medium py-2"
                        onClick={() => setOpenMobile(abierto ? null : item.id)}
                      >
                        {item.etiquetaMenu}
                        <ChevronDown className={`w-4 h-4 transition-transform ${abierto ? 'rotate-180' : ''}`} />
                      </button>
                      {abierto && (
                        <div className="pl-4 border-l-2 border-gray-100 ml-1 space-y-1">
                          <Link href={hrefDe(item)} onClick={closeAll} className="block text-sm font-bold text-[#120573] py-1.5">
                            Ver todo
                          </Link>
                          {item.hijos.map((h) => (
                            <Link key={h.id} href={`/${h.slug}`} onClick={closeAll} className="block text-sm text-gray-600 hover:text-[#120573] py-1.5">
                              {h.etiquetaMenu}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                const href = hrefDe(item);
                return (
                  <Link key={item.id} href={href} onClick={closeAll} className="block text-left text-gray-700 hover:text-[#120573] font-medium py-2">
                    {item.etiquetaMenu}
                  </Link>
                );
              })}
              <Link href="/tarifario" onClick={closeAll} className="block text-left text-[#120573] font-bold py-2 bg-[#d8f511]/30 px-4 rounded-lg">
                Tarifario
              </Link>
              {lineasUnicas.length > 0 && (
                <div className="pt-2 text-sm text-gray-500">
                  {lineasUnicas.map((tel, i) => (
                    <a key={i} href={`tel:${tel.replace(/\s+/g, '')}`} className="flex items-center gap-2 py-1 hover:text-[#120573]">
                      <Phone className="w-4 h-4" /> {tel}
                    </a>
                  ))}
                </div>
              )}
              <Button
                className="w-full bg-[#d8f511] text-[#120573] hover:bg-[#c5e010] font-bold shadow-lg mt-2"
                onClick={() => { window.open(whatsappLink, '_blank'); closeAll(); }}
              >
                Reserva Aquí
              </Button>
            </motion.div>
          )}
        </nav>
      </motion.header>
    </>
  );
};

export default Header;
