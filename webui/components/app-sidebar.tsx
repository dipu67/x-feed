"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Rss, FolderKanban, KeyRound, Webhook, TrendingUp } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const nav = [
  { title: "Feed", href: "/", icon: Rss },
  { title: "Projects", href: "/projects", icon: FolderKanban },
  { title: "Growth", href: "/growth", icon: TrendingUp },
  { title: "Auth tokens", href: "/auth-tokens", icon: KeyRound },
  { title: "Webhook", href: "/webhooks", icon: Webhook },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-semibold">
            X
          </div>
          <div className="grid leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">x-feed</span>
            <span className="text-xs text-muted-foreground">Live tracker</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>App</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => {
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
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
