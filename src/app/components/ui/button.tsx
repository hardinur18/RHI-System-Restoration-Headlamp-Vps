import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "./utils"

const buttonVariants = cva(
  "uiButton ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        default: "primaryButton",
        primary: "primaryButton",
        destructive: "dangerButton",
        danger: "dangerButton",
        success: "successButton",
        outline: "ghostButton",
        secondary: "secondaryButton",
        ghost: "ghostButton",
        link: "linkButton",
      },
      size: {
        // Group layouts normalize adjacent controls; standalone compact sizes are explicit.
        default: "",
        md: "",
        sm: "buttonSm",
        lg: "buttonLg",
        icon: "iconButton",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  icon?: React.ReactNode
  iconPosition?: "left" | "right"
  fullWidth?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, icon, iconPosition = "left", fullWidth = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"

    if (asChild) {
      return (
        <Comp
          data-ui-variant={variant ?? "default"}
          data-ui-size={size ?? "default"}
          className={cn(buttonVariants({ variant, size, className }), fullWidth && "w-full")}
          ref={ref}
          {...props}
        >
          {children}
        </Comp>
      )
    }

    return (
      <Comp
        data-ui-variant={variant ?? "default"}
        data-ui-size={size ?? "default"}
        className={cn(buttonVariants({ variant, size, className }), fullWidth && "w-full")}
        ref={ref}
        {...props}
      >
        {icon && iconPosition === "left" ? icon : null}
        {children}
        {icon && iconPosition === "right" ? icon : null}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
