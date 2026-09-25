"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  FolderKanban,
  KeyRound,
  LogOut,
  Rss,
  Settings2,
  ShieldCheck,
  TrendingUp,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useUser } from "@/hooks/useUser";
import { logout } from "@/lib/api";

const groups = [
  {
    label: "App",
    items: [
      { title: "Feed", href: "/", icon: Rss },
      { title: "Projects", href: "/projects", icon: FolderKanban },
      { title: "Growth", href: "/growth", icon: TrendingUp },
    ],
  },
  {
    label: "Manage",
    items: [
      { title: "Filters", href: "/settings/filters", icon: Settings2 },
      { title: "Auth tokens", href: "/auth-tokens", icon: KeyRound },
      { title: "Webhook", href: "/webhooks", icon: Webhook },
      { title: "Admin", href: "/admin", icon: ShieldCheck },
    ],
  },
];

function initialsFor(email: string): string {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[.\-_+]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "??";
}

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const { user } = useUser();
  const [signingOut, setSigningOut] = useState(false);

  // Close the mobile sidebar whenever the route changes.
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await logout();
      router.push("/login");
    } catch {
      toast.error("Sign out failed");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="size-4"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </div>
          <div className="grid leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">x-feed</span>
            <span className="text-xs text-muted-foreground">Live tracker</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        render={<Link href={item.href} />}
                        isActive={active}
                        tooltip={item.title}
                        onClick={() => setOpenMobile(false)}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">
              {user ? initialsFor(user.email) : "…"}
            </AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">
              {user?.email ?? " "}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            disabled={signingOut}
            onClick={() => void onSignOut()}
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
