import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Field({
  label,
  children,
  className = ""
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`grid gap-1.5 text-sm font-medium text-navy ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

const fieldClass =
  "min-h-10 w-full rounded-md border border-[#D7DEE8] bg-white px-3 py-2 text-sm font-normal text-navy shadow-none transition placeholder:text-cool hover:border-[#C9D5E6] focus:border-primary focus:bg-[#FBFDFF]";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={fieldClass} {...props} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={fieldClass} {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldClass} min-h-24 resize-y`} {...props} />;
}
