import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon-sm";
  icon?: ReactNode;
};

const variants = {
  primary: "bg-primary text-white shadow-[0_2px_8px_rgba(11,19,43,0.08)] hover:bg-[color:var(--app-primary-hover)] active:bg-primary/95",
  secondary: "bg-[#E8F0FF] text-primary ring-1 ring-inset ring-[#C4D8FF] hover:bg-[#DDEAFF] active:bg-[#D2E2FF]",
  ghost: "bg-transparent text-slate hover:bg-[#F6F8FC] hover:text-navy active:bg-lightgray",
  danger: "bg-scarlet text-white hover:bg-[#D72F25] active:bg-[#B92720]"
};

const sizes = {
  sm: "min-h-9 px-3 text-sm",
  md: "min-h-10 px-4 text-sm",
  "icon-sm": "h-9 w-9 shrink-0 p-0"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "primary", size = "md", icon, className = "", children, ...props }, ref) {
  return (
    <button
      ref={ref}
    className={`inline-flex touch-manipulation items-center justify-center gap-2 rounded-lg border-0 font-semibold transition-colors duration-150 motion-safe:active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-lightgray disabled:text-cool disabled:shadow-none disabled:ring-0 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
});
