import * as React from "react"
import { cn } from "./utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode
  icon?: React.ReactNode
  error?: React.ReactNode
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, icon, error, id, ...props }, ref) => {
    const input = (
      <div className="uiInputFrame relative" data-has-icon={icon ? "true" : undefined}>
        {icon ? (
          <span className="uiInputIcon pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 items-center text-muted-foreground">
            {icon}
          </span>
        ) : null}
      <input
        id={id}
        type={type}
        data-slot="input"
        className={cn(
          "uiInput flex w-full border transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
          icon && "pl-10",
          error && "border-destructive focus-visible:ring-destructive",
          className
        )}
        ref={ref}
        {...props}
      />
      </div>
    )

    if (!label && !error) return input

    return (
      <div className="space-y-1.5">
        {label ? (
          <label htmlFor={id} className="text-sm font-medium leading-none text-foreground">
            {label}
          </label>
        ) : null}
        {input}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    )
  }
)
Input.displayName = "Input"

export { Input }
