import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) => {
    const base =
      "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium tracking-[0.18em] uppercase transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50";
    const sizes = {
      md: "px-6 py-3",
      sm: "px-4 py-2 text-xs",
    };
    const variants = {
      primary:
        "bg-burgundy text-pearl shadow-card hover:-translate-y-0.5 hover:bg-burgundy-light hover:shadow-soft",
      secondary:
        "border border-rose/20 bg-white/90 text-burgundy shadow-[0_10px_35px_-24px_rgba(122,38,50,0.2)] hover:-translate-y-0.5 hover:bg-blush/80",
      ghost: "bg-transparent text-burgundy hover:bg-white/70",
      danger: "border border-alert/15 bg-alert/10 text-alert hover:bg-alert hover:text-pearl",
    };
    return (
      <button
        ref={ref}
        className={cn(base, sizes[size], variants[variant], className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
