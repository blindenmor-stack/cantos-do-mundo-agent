"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { BarChart3, Globe, LogOut, MessageSquare, Settings, Users } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/conversations", label: "Conversas", icon: MessageSquare },
  { href: "/settings", label: "Configurações", icon: Settings },
];

export function DashboardNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <aside className="flex w-60 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-5">
        <Globe className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold tracking-tight">Cantos do Mundo</span>
      </div>
      <Separator />
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {links.map((link) => {
          const isActive = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <link.icon className="h-4 w-4" />
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-2">
        <Separator className="mb-2" />
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sair
        </Button>
        <p className="mt-2 px-3 text-xs text-muted-foreground">
          Agente Miry v1.1
        </p>
      </div>
    </aside>
  );
}
