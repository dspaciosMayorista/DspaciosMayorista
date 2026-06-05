"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type NavItem = {
  href: string;
  label: string;
  children?: { href: string; label: string }[];
};

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-0.5 px-3 py-4">
      {items.map((it) => (
        <Group key={it.href} item={it} pathname={pathname} />
      ))}
    </nav>
  );
}

function Group({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(item.href + "/");
  const hasChildren = !!item.children?.length;
  // null = sigue al estado activo; true/false = el usuario lo abrió/cerró a mano
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? active;

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          className="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-gray-50"
          style={
            active
              ? { backgroundColor: "var(--brand-primary)", color: "white", fontWeight: 600 }
              : { color: "var(--nav-fg, #4b5563)" }
          }
        >
          {item.label}
        </Link>
        {hasChildren && (
          <button
            type="button"
            aria-label="Desplegar"
            onClick={() => setManual(!open)}
            className="px-2 py-2 text-gray-400 hover:text-gray-700"
          >
            {open ? "▾" : "▸"}
          </button>
        )}
      </div>

      {hasChildren && open && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-gray-100 pl-2">
          {item.children!.map((c) => {
            const cActive = pathname === c.href;
            return (
              <Link
                key={c.href}
                href={c.href}
                aria-current={cActive ? "page" : undefined}
                className="block rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-gray-50"
                style={cActive ? { color: "var(--brand-accent)", fontWeight: 600 } : { color: "var(--nav-subfg, #6b7280)" }}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
