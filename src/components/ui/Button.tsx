import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon-sm";
  icon?: ReactNode;
};

const variants = {
  primary: "bg-primary text-white shadow-sm hover:bg-[#082BB0] active:bg-[#072596]",
  secondary: "bg-white text-navy ring-1 ring-inset ring-[#C9D5E6] hover:bg-[#F6F8FC] active:bg-[#EAF0FA]",
  ghost: "bg-transparent text-slate hover:bg-[#F6F8FC] active:bg-lightgray",
  danger: "bg-scarlet text-white shadow-sm hover:bg-[#D72F25] active:bg-[#B92720]"
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
      className={`inline-flex touch-manipulation items-center justify-center gap-2 rounded-md border-0 font-semibold transition-colors duration-150 motion-safe:active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-lightgray disabled:text-cool disabled:shadow-none disabled:ring-0 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
});
