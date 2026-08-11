import { Children, isValidElement, useEffect, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { CommandSelector, type CommandOption } from "@/components/ui/CommandSelector";

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

/** Shared command-selector field that keeps the existing FormData shape. */
export function CreateSelectInput({ children, defaultValue, disabled, name, onChange, value, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const controlledValue = value === undefined ? undefined : String(value);
  const [internalValue, setInternalValue] = useState(controlledValue ?? String(defaultValue ?? ""));
  useEffect(() => { if (controlledValue !== undefined) setInternalValue(controlledValue); }, [controlledValue]);
  const options: CommandOption[] = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean }>(child)) return [];
    const optionValue = child.props.value ?? "";
    const optionLabel = typeof child.props.children === "string" || typeof child.props.children === "number" ? String(child.props.children) : optionValue;
    return [{ value: optionValue, label: optionLabel, disabled: child.props.disabled }];
  });
  const selectorValue = controlledValue ?? internalValue;
  return <CommandSelector
    ariaLabel={String(props["aria-label"] ?? name ?? "Select option")}
    disabled={disabled}
    emptyLabel={options.find((option) => option.value === "")?.label ?? "Select option"}
    name={name}
    onValueChange={(nextValue) => {
      if (controlledValue === undefined) setInternalValue(nextValue);
      onChange?.({ target: { value: nextValue, name }, currentTarget: { value: nextValue, name } } as unknown as ChangeEvent<HTMLSelectElement>);
    }}
    options={options}
    value={selectorValue}
  />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldClass} min-h-24 resize-y`} {...props} />;
}
