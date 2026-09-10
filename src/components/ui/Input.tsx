import { cn } from "@/lib/utils";
import {
  InputHTMLAttributes,
  forwardRef,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-2xl border border-rose/20 bg-white/90 px-4 py-3 text-clay placeholder:text-clay/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]",
        "outline-none transition-all duration-200 focus:border-burgundy/30 focus:bg-white focus:ring-4 focus:ring-rose/12",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-2xl border border-rose/20 bg-white/90 px-4 py-3 text-clay placeholder:text-clay/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]",
        "outline-none transition-all duration-200 focus:border-burgundy/30 focus:bg-white focus:ring-4 focus:ring-rose/12",
        "min-h-[90px] resize-y",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "w-full rounded-2xl border border-rose/20 bg-white/90 px-4 py-3 text-clay shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]",
        "outline-none transition-all duration-200 focus:border-burgundy/30 focus:bg-white focus:ring-4 focus:ring-rose/12",
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
);
Select.displayName = "Select";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-2 block text-[0.68rem] tracking-label uppercase text-burgundy/62", className)}
      {...props}
    />
  );
}
