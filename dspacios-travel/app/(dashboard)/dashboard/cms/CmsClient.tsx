"use client";

import { useState } from "react";
import type { Database } from "@/types/database";
import { PaquetesEditor } from "./editors/PaquetesEditor";
import { DestinosEditor } from "./editors/DestinosEditor";
import { TestimoniosEditor } from "./editors/TestimoniosEditor";
import { BlogEditor } from "./editors/BlogEditor";
import { ConfigEditor } from "./editors/ConfigEditor";

type Paquete = Database["public"]["Tables"]["web_paquetes"]["Row"];
type Destino = Database["public"]["Tables"]["web_destinos"]["Row"];
type Testimonio = Database["public"]["Tables"]["web_testimonios"]["Row"];
type Blog = Database["public"]["Tables"]["web_blog"]["Row"];
type Config = Database["public"]["Tables"]["web_config"]["Row"];

type Tab = "paquetes" | "destinos" | "testimonios" | "blog" | "config";

const TABS: { key: Tab; label: string }[] = [
  { key: "paquetes", label: "Paquetes" },
  { key: "destinos", label: "Destinos" },
  { key: "testimonios", label: "Testimonios" },
  { key: "blog", label: "Blog" },
  { key: "config", label: "Configuración" },
];

export function CmsClient({
  paquetes,
  destinos,
  testimonios,
  blog,
  config,
}: {
  paquetes: Paquete[];
  destinos: Destino[];
  testimonios: Testimonio[];
  blog: Blog[];
  config: Config | null;
}) {
  const [tab, setTab] = useState<Tab>("paquetes");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="rounded-t-lg px-4 py-2 text-sm font-medium transition-colors"
            style={
              tab === t.key
                ? {
                    color: "var(--brand-primary)",
                    borderBottom: "2px solid var(--brand-primary)",
                    fontWeight: 600,
                  }
                : { color: "#6b7280" }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "paquetes" && <PaquetesEditor paquetes={paquetes} />}
      {tab === "destinos" && <DestinosEditor destinos={destinos} />}
      {tab === "testimonios" && <TestimoniosEditor testimonios={testimonios} />}
      {tab === "blog" && <BlogEditor blog={blog} />}
      {tab === "config" && <ConfigEditor config={config} />}
    </div>
  );
}
