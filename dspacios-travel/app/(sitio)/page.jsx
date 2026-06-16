import Hero from '@/components/sitio/Hero';
import WhyChooseUs from '@/components/sitio/WhyChooseUs';
import FeaturedPackages from '@/components/sitio/FeaturedPackages';
import Destinations from '@/components/sitio/Destinations';
import Testimonials from '@/components/sitio/Testimonials';
import ContactForm from '@/components/sitio/ContactForm';
import InstagramFeed from '@/components/sitio/InstagramFeed';
import { getPaquetes, getDestinos, getTestimonios, getConfig } from '@/lib/sitio/cms';

export default async function Home() {
  const [paquetes, destinos, testimonios, config] = await Promise.all([
    getPaquetes(),
    getDestinos(),
    getTestimonios(),
    getConfig(),
  ]);

  return (
    <>
      <Hero config={config} />
      <WhyChooseUs />
      <FeaturedPackages items={paquetes} />
      <Destinations items={destinos} />
      <Testimonials items={testimonios} />
      <ContactForm config={config} />
      <InstagramFeed />
    </>
  );
}
