"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function salir() {
    start(async () => {
      const sb = createClient();
      await sb.auth.signOut();
      router.push("/login");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={salir}
      disabled={pending}
      className={className ?? "text-sm text-gray-500 hover:text-gray-800"}
    >
      {pending ? "Saliendo…" : "Cerrar sesión"}
    </button>
  );
}
