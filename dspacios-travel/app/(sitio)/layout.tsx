import "./sitio.css";
import Header from "@/components/sitio/Header";
import Footer from "@/components/sitio/Footer";
import WhatsAppButton from "@/components/sitio/WhatsAppButton";
import ScrollToTop from "@/components/sitio/ScrollToTop";
import { Toaster } from "@/components/sitio/ui/toaster";
import { getConfig } from "@/lib/sitio/cms";
import { getMenu } from "@/lib/sitio/paginas";

export default async function SitioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [config, menu] = await Promise.all([getConfig(), getMenu()]);
  return (
    <div className="sitio-root min-h-screen bg-white flex flex-col">
      <ScrollToTop />
      <Header config={config} menu={menu} />
      <main className="flex-grow">{children}</main>
      <Footer config={config} />
      <WhatsAppButton config={config} />
      <Toaster />
    </div>
  );
}
