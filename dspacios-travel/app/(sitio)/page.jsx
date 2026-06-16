import Hero from '@/components/sitio/Hero';
import WhyChooseUs from '@/components/sitio/WhyChooseUs';
import FeaturedPackages from '@/components/sitio/FeaturedPackages';
import Destinations from '@/components/sitio/Destinations';
import Testimonials from '@/components/sitio/Testimonials';
import ContactForm from '@/components/sitio/ContactForm';
import InstagramFeed from '@/components/sitio/InstagramFeed';

export default function Home() {
  return (
    <>
      <Hero />
      <WhyChooseUs />
      <FeaturedPackages />
      <Destinations />
      <Testimonials />
      <ContactForm />
      <InstagramFeed />
    </>
  );
}
