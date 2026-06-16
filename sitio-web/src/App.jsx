import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import WhatsAppButton from '@/components/WhatsAppButton';

// Pages
import Home from '@/pages/Home';
import Packages from '@/pages/Packages';
import PackageDetail from '@/pages/PackageDetail';
import DestinationsPage from '@/pages/Destinations';
import DestinationDetail from '@/pages/DestinationDetail';
import About from '@/pages/About';
import TestimonialsPage from '@/pages/TestimonialsPage';
import Blog from '@/pages/Blog';
import BlogPost from '@/pages/BlogPost';
import QuoteRequest from '@/pages/QuoteRequest';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-white flex flex-col">
        <Header />
        <main className="flex-grow">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/paquetes" element={<Packages />} />
            <Route path="/paquetes/:id" element={<PackageDetail />} />
            <Route path="/destinos" element={<DestinationsPage />} />
            <Route path="/destinos/:id" element={<DestinationDetail />} />
            <Route path="/nosotros" element={<About />} />
            <Route path="/testimonios" element={<TestimonialsPage />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/:id" element={<BlogPost />} />
            <Route path="/cotizar" element={<QuoteRequest />} />
          </Routes>
        </main>
        <Footer />
        <WhatsAppButton />
        <Toaster />
      </div>
    </BrowserRouter>
  );
}

export default App;