import "./sitio.css";
import Header from "@/components/sitio/Header";
import Footer from "@/components/sitio/Footer";
import WhatsAppButton from "@/components/sitio/WhatsAppButton";
import ScrollToTop from "@/components/sitio/ScrollToTop";
import { Toaster } from "@/components/sitio/ui/toaster";
import { getConfig } from "@/lib/sitio/cms";
import { getMenu } from "@/lib/sitio/paginas";
import { orgDelRequest } from "@/lib/org";
import type { CSSProperties } from "react";

export default async function SitioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [config, menu, org] = await Promise.all([getConfig(), getMenu(), orgDelRequest()]);
  // SaaS: branding de colores por org (mismas CSS vars que el resto de la app).
  const brandStyle: CSSProperties | undefined = org && (org.color_primario || org.color_acento)
    ? ({
        ...(org.color_primario ? { "--brand-primary": org.color_primario } : {}),
        ...(org.color_acento ? { "--brand-accent": org.color_acento } : {}),
        ...(org.color_primario && org.color_acento
          ? { "--brand-gradient": `linear-gradient(120deg, ${org.color_primario}, ${org.color_acento})` }
          : {}),
      } as CSSProperties)
    : undefined;
  return (
    <div className="sitio-root min-h-screen bg-white flex flex-col" style={brandStyle}>
      <ScrollToTop />
      <Header config={config} menu={menu} />
      <main className="flex-grow">{children}</main>
      <Footer config={config} />
      <WhatsAppButton config={config} />
      <Toaster />
    </div>
  );
}
