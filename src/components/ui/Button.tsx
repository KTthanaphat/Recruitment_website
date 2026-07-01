import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  icon?: ReactNode;
};

const variants = {
  primary: "bg-primary text-white hover:bg-[#082BB0]",
  secondary: "bg-[#E6EDF7] text-navy hover:bg-[#D7DEE8]",
  ghost: "bg-transparent text-slate hover:bg-lightgray",
  danger: "bg-scarlet text-white hover:bg-[#D72F25]"
};

const sizes = {
  sm: "min-h-9 px-3 text-sm",
  md: "min-h-10 px-4 text-sm"
};

export function Button({ variant = "primary", size = "md", icon, className = "", children, ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex touch-manipulation items-center justify-center gap-2 rounded-md border-0 font-bold transition-colors disabled:cursor-not-allowed disabled:bg-cool disabled:text-white ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
