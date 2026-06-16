"use client";

import React from 'react';
import { Mail, Phone, MapPin } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { SITIO_BASE, rutaSitio } from '@/lib/sitio/rutas';

// Íconos sociales como SVG inline: lucide-react de este repo no exporta
// Facebook/Instagram/Youtube/Tiktok, así que evitamos depender de su versión.
const FacebookIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.91 3.78-3.91 1.1 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.44 2.9h-2.34V22c4.78-.79 8.44-4.94 8.44-9.94Z" />
  </svg>
);
const InstagramIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37Z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);
const TiktokIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M16 2h-3v13.5a2.5 2.5 0 1 1-2.5-2.5c.17 0 .34.02.5.05V10a5.5 5.5 0 1 0 5 5.47V8.4a6.7 6.7 0 0 0 4 1.32V6.7A3.7 3.7 0 0 1 16 2Z" />
  </svg>
);
const YoutubeIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M23 12s0-3.2-.4-4.74a2.5 2.5 0 0 0-1.76-1.77C19.3 5.1 12 5.1 12 5.1s-7.3 0-8.84.39A2.5 2.5 0 0 0 1.4 7.26C1 8.8 1 12 1 12s0 3.2.4 4.74a2.5 2.5 0 0 0 1.76 1.77C4.7 18.9 12 18.9 12 18.9s7.3 0 8.84-.39a2.5 2.5 0 0 0 1.76-1.77C23 15.2 23 12 23 12Zm-13 3.1V8.9l5.2 3.1-5.2 3.1Z" />
  </svg>
);

const Footer = ({ config }) => {
  const telefono = config?.contactoTelefono || "+57 123 456 7890";
  const email = config?.contactoEmail || "info@dspaciostravel.com";
  const direccion = config?.direccion || "Bogotá, Colombia";
  const facebookUrl = config?.facebookUrl;
  const instagramUrl = config?.instagramUrl;
  const tiktokUrl = config?.tiktokUrl;
  const youtubeUrl = config?.youtubeUrl;

  const redes = [
    { url: facebookUrl, Icon: FacebookIcon, label: 'Facebook' },
    { url: instagramUrl, Icon: InstagramIcon, label: 'Instagram' },
    { url: tiktokUrl, Icon: TiktokIcon, label: 'TikTok' },
    { url: youtubeUrl, Icon: YoutubeIcon, label: 'YouTube' },
  ].filter((r) => r.url);

  return (
    <footer className="bg-[#120573] text-white pt-16 pb-8">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
          {/* Brand */}
          <div>
            <Link href={SITIO_BASE} className="inline-flex items-center mb-4">
              <Logo variant="white" height={40} className="h-10 w-auto" />
            </Link>
            <p className="text-white/80 leading-relaxed">
              Tu agencia mayorista de viajes de confianza. Creando experiencias inolvidables desde 2008.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-lg font-bold mb-4 text-[#d8f511]">Enlaces Rápidos</h3>
            <ul className="space-y-3">
              <li><Link href={rutaSitio('destinos-nacionales')} className="text-white/80 hover:text-[#d8f511] transition-colors">Destinos Nacionales</Link></li>
              <li><Link href={rutaSitio('destinos-internacionales')} className="text-white/80 hover:text-[#d8f511] transition-colors">Destinos Internacionales</Link></li>
              <li><Link href={rutaSitio('experiencias')} className="text-white/80 hover:text-[#d8f511] transition-colors">Experiencias</Link></li>
              <li><Link href={rutaSitio('sobre-nosotros')} className="text-white/80 hover:text-[#d8f511] transition-colors">Sobre Nosotros</Link></li>
              <li><Link href={rutaSitio('blog')} className="text-white/80 hover:text-[#d8f511] transition-colors">Blog</Link></li>
              <li><Link href="/tarifario" className="text-white/80 hover:text-[#d8f511] transition-colors">Tarifario</Link></li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-lg font-bold mb-4 text-[#d8f511]">Contacto</h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-2">
                <Phone className="w-5 h-5 text-[#d8f511] mt-1 shrink-0" />
                <span className="text-white/80">{telefono}</span>
              </li>
              <li className="flex items-start gap-2">
                <Mail className="w-5 h-5 text-[#d8f511] mt-1 shrink-0" />
                <span className="text-white/80">{email}</span>
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="w-5 h-5 text-[#d8f511] mt-1 shrink-0" />
                <span className="text-white/80 whitespace-pre-line">{direccion}</span>
              </li>
            </ul>
          </div>

          {/* Social Media */}
          <div>
            <h3 className="text-lg font-bold mb-4 text-[#d8f511]">Síguenos</h3>
            <p className="text-white/80 mb-4">Mantente actualizado con nuestras ofertas y destinos</p>
            <div className="flex gap-4">
              {redes.map(({ url, Icon, label }) => (
                <button
                  key={label}
                  onClick={() => window.open(url, '_blank')}
                  aria-label={label}
                  className="w-10 h-10 bg-white/10 hover:bg-[#d8f511] hover:text-[#120573] rounded-full flex items-center justify-center transition-all"
                >
                  <Icon className="w-5 h-5" />
                </button>
              ))}
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
              <span className="text-white/60">Política de Privacidad</span>
              <span className="text-white/60">Términos y Condiciones</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
