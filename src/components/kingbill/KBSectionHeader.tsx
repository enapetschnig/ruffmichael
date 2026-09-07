import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface KBSectionHeaderProps {
  icon: LucideIcon;
  title: string;
  className?: string;
}

export function KBSectionHeader({ icon: Icon, title, className }: KBSectionHeaderProps) {
  return (
    <div
      className={cn(
        // Navy-Leiste (Kundenwunsch 24.08.2026: "die Überschriften im
        // Hauptmenü farblich mehr herausheben") — KingBill-Blau wie die
        // Toolbar, weiße Schrift.
        "flex items-center gap-2.5 rounded-md bg-kb-blue-dark px-3 py-2 shadow-sm",
        className
      )}
    >
      <Icon className="h-9 w-9 shrink-0 text-white/90" strokeWidth={1.75} />
      <h2 className="kb-section-title truncate text-white">{title}</h2>
    </div>
  );
}
