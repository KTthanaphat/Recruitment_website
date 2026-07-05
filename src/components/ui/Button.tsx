import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  icon?: ReactNode;
};

const variants = {
  primary: "bg-primary text-white shadow-sm hover:bg-[#082BB0] active:bg-[#072596]",
  secondary: "bg-[#EAF0FA] text-navy ring-1 ring-inset ring-[#C9D5E6] hover:bg-[#DDE7F5] active:bg-[#D2DEEF]",
  ghost: "bg-transparent text-slate hover:bg-lightgray active:bg-[#E6EDF7]",
  danger: "bg-scarlet text-white shadow-sm hover:bg-[#D72F25] active:bg-[#B92720]"
};

const sizes = {
  sm: "min-h-9 px-3 text-sm",
  md: "min-h-10 px-4 text-sm"
};

export function Button({ variant = "primary", size = "md", icon, className = "", children, ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex touch-manipulation items-center justify-center gap-2 rounded-md border-0 font-semibold transition-all duration-150 motion-safe:active:translate-y-px disabled:cursor-not-allowed disabled:bg-cool disabled:text-white disabled:shadow-none disabled:ring-0 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
