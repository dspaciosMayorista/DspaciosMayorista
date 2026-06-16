import React from 'react';
import { Plane, Mail, Phone, MapPin, Facebook, Instagram, Twitter } from 'lucide-react';
import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="bg-[#120573] text-white pt-16 pb-8">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 bg-[#d8f511] rounded-full flex items-center justify-center">
                <Plane className="w-6 h-6 text-[#120573]" />
              </div>
              <span className="text-2xl font-bold">D'Spacios Travel</span>
            </div>
            <p className="text-white/80 leading-relaxed">
              Tu agencia mayorista de viajes de confianza. Creando experiencias inolvidables desde 2008.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-lg font-bold mb-4 text-[#d8f511]">Enlaces Rápidos</h3>
            <ul className="space-y-3">
              <li>
                <Link to="/paquetes" className="text-white/80 hover:text-[#d8f511] transition-colors">
                  Paquetes
                </Link>
              </li>
              <li>
                <Link to="/destinos" className="text-white/80 hover:text-[#d8f511] transition-colors">
                  Destinos
                </Link>
              </li>
              <li>
                <Link to="/nosotros" className="text-white/80 hover:text-[#d8f511] transition-colors">
                  Nosotros
                </Link>
              </li>
              <li>
                <Link to="/testimonios" className="text-white/80 hover:text-[#d8f511] transition-colors">
                  Testimonios
                </Link>
              </li>
              <li>
                <Link to="/blog" className="text-white/80 hover:text-[#d8f511] transition-colors">
                  Blog
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-lg font-bold mb-4 text-[#d8f511]">Contacto</h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-2">
                <Phone className="w-5 h-5 text-[#d8f511] mt-1 shrink-0" />
                <span className="text-white/80">+57 123 456 7890</span>
              </li>
              <li className="flex items-start gap-2">
                <Mail className="w-5 h-5 text-[#d8f511] mt-1 shrink-0" />
                <span className="text-white/80">info@dspaciostravel.com</span>
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="w-5 h-5 text-[#d8f511] mt-1 shrink-0" />
                <span className="text-white/80">Bogotá, Colombia</span>
              </li>
            </ul>
          </div>

          {/* Social Media */}
          <div>
            <h3 className="text-lg font-bold mb-4 text-[#d8f511]">Síguenos</h3>
            <p className="text-white/80 mb-4">
              Mantente actualizado con nuestras ofertas y destinos
            </p>
            <div className="flex gap-4">
              <button 
                onClick={() => window.open('https://facebook.com', '_blank')}
                className="w-10 h-10 bg-white/10 hover:bg-[#d8f511] rounded-full flex items-center justify-center transition-all"
              >
                <Facebook className="w-5 h-5" />
              </button>
              <button 
                onClick={() => window.open('https://instagram.com', '_blank')}
                className="w-10 h-10 bg-white/10 hover:bg-[#d8f511] rounded-full flex items-center justify-center transition-all"
              >
                <Instagram className="w-5 h-5" />
              </button>
              <button 
                onClick={() => window.open('https://twitter.com', '_blank')}
                className="w-10 h-10 bg-white/10 hover:bg-[#d8f511] rounded-full flex items-center justify-center transition-all"
              >
                <Twitter className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-white/20 pt-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-white/60 text-sm">
              © 2025 D'Spacios Travel. Todos los derechos reservados.
            </p>
            <div className="flex gap-6 text-sm">
              <button className="text-white/60 hover:text-[#d8f511] transition-colors">
                Política de Privacidad
              </button>
              <button className="text-white/60 hover:text-[#d8f511] transition-colors">
                Términos y Condiciones
              </button>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;