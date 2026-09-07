import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface KBButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
  label: string;
  variant?: "default" | "green" | "blue";
  size?: "default" | "lg";
  badge?: number;
  iconClassName?: string;
}

const VARIANT_CLASS: Record<NonNullable<KBButtonProps["variant"]>, string> = {
  default: "",
  green: "kb-btn-primary-green",
  blue: "kb-btn-blue",
};

export const KBButton = React.forwardRef<HTMLButtonElement, KBButtonProps>(
  (
    { icon: Icon, label, variant = "default", size = "default", badge, iconClassName, className, type = "button", ...rest },
    ref
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn("kb-btn", size === "lg" && "kb-btn-lg", VARIANT_CLASS[variant], className)}
        {...rest}
      >
        {Icon && (
          <Icon
            className={cn(
              size === "lg" ? "h-5 w-5" : "h-4 w-4",
              "shrink-0",
              variant === "green" ? "text-kb-green" : "text-kb-blue-dark",
              iconClassName
            )}
          />
        )}
        <span className="truncate">{label}</span>
        {typeof badge === "number" && badge > 0 && (
          <span className="kb-badge absolute -right-1.5 -top-1.5">{badge > 99 ? "99+" : badge}</span>
        )}
      </button>
    );
  }
);
KBButton.displayName = "KBButton";
