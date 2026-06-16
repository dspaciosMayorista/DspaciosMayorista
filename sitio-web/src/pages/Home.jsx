import React from 'react';
import Hero from '@/components/Hero';
import WhyChooseUs from '@/components/WhyChooseUs';
import FeaturedPackages from '@/components/FeaturedPackages';
import Destinations from '@/components/Destinations';
import Testimonials from '@/components/Testimonials';
import ContactForm from '@/components/ContactForm';
import InstagramFeed from '@/components/InstagramFeed';
import { Helmet } from 'react-helmet';

const Home = () => {
  return (
    <>
      <Helmet>
        <title>D'Spacios Travel | Agencia Mayorista de Viajes</title>
        <meta name="description" content="Descubre los mejores paquetes turísticos con D'Spacios Travel. Expertos en viajes nacionales e internacionales con atención personalizada." />
      </Helmet>
      <Hero />
      <WhyChooseUs />
      <FeaturedPackages />
      <Destinations />
      <Testimonials />
      <ContactForm />
      <InstagramFeed />
    </>
  );
};

export default Home;