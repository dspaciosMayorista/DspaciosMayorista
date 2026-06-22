"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function salir() {
    start(async () => {
      const sb = createClient();
      await sb.auth.signOut();
      router.push("/tarifario");
      router.refresh();
    });
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={salir}
        disabled={pending}
        title="Cerrar sesión"
        aria-label="Cerrar sesión"
        className="grid h-9 w-9 place-items-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
      >
        <LogOut size={17} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={salir}
      disabled={pending}
      className={className ?? "inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800"}
    >
      <LogOut size={15} /> {pending ? "Saliendo…" : "Cerrar sesión"}
    </button>
  );
}
