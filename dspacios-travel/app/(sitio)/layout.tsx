import "./sitio.css";
import Header from "@/components/sitio/Header";
import Footer from "@/components/sitio/Footer";
import WhatsAppButton from "@/components/sitio/WhatsAppButton";
import ScrollToTop from "@/components/sitio/ScrollToTop";
import { Toaster } from "@/components/sitio/ui/toaster";

export default function SitioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="sitio-root min-h-screen bg-white flex flex-col">
      <ScrollToTop />
      <Header />
      <main className="flex-grow">{children}</main>
      <Footer />
      <WhatsAppButton />
      <Toaster />
    </div>
  );
}
