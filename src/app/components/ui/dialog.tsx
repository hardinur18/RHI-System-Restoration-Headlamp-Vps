"use client";

import { ActionGroup } from './control-layout';

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";

import { cn, stripInternalDomProps } from "./utils";

function createCleanRadix<T extends React.ElementType>(Primitive: T, wrapAsChild: boolean = false) {
  const CleanPrimitive = React.forwardRef<React.ElementRef<T>, React.ComponentPropsWithoutRef<T>>(
    (props, ref) => {
      const cleanProps = stripInternalDomProps(props as Record<string, unknown>);
      
      if (wrapAsChild && cleanProps.asChild && React.isValidElement(cleanProps.children)) {
        if (typeof cleanProps.children.type !== 'string') {
          cleanProps.children = React.createElement(
            "div",
            { className: "relative inline-flex items-center justify-center" },
            cleanProps.children
          ) as unknown as React.ReactNode;
        }
      }

      const { children, ...rest } = cleanProps;
      return React.createElement(Primitive, { ...rest, ref } as any, children as React.ReactNode);
    }
  );
  CleanPrimitive.displayName = (Primitive as any).displayName || "CleanPrimitive";
  return CleanPrimitive;
}

const CleanRoot = createCleanRadix(DialogPrimitive.Root);
const CleanTrigger = createCleanRadix(DialogPrimitive.Trigger, true);
const CleanPortal = createCleanRadix(DialogPrimitive.Portal);
const CleanClose = createCleanRadix(DialogPrimitive.Close);
const CleanOverlay = createCleanRadix(DialogPrimitive.Overlay);
const CleanContent = createCleanRadix(DialogPrimitive.Content);
const CleanTitle = createCleanRadix(DialogPrimitive.Title);
const CleanDescription = createCleanRadix(DialogPrimitive.Description);

const DialogTrigger = CleanTrigger;
const DialogPortal = CleanPortal;
const DialogClose = CleanClose;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <CleanOverlay
    ref={ref}
    className={cn(
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-[120] bg-black/50",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <CleanContent
      ref={ref}
      className={cn(
        "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] fixed left-[50%] top-[50%] z-[130] grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border p-6 shadow-lg duration-200 sm:rounded-lg",
        className
      )}
      {...props}
    >
      {children}
      <CleanClose className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-offset-2 disabled:pointer-events-none">
        <XIcon className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </CleanClose>
    </CleanContent>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...stripInternalDomProps(props as Record<string, unknown>)}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <ActionGroup
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end",
      className
    )}
    {...stripInternalDomProps(props as Record<string, unknown>)}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <CleanTitle
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <CleanDescription
    ref={ref}
    className={cn("text-muted-foreground text-sm", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

type DialogProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root> & {
  isOpen?: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
};

function Dialog({ isOpen, onClose, title, open, onOpenChange, children, ...props }: DialogProps) {
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      onOpenChange?.(nextOpen);
      if (!nextOpen) onClose?.();
    },
    [onClose, onOpenChange],
  );

  const resolvedOpen = isOpen ?? open;
  const usesLegacyContent = isOpen !== undefined || onClose || title;

  return (
    <CleanRoot open={resolvedOpen} onOpenChange={handleOpenChange} {...props}>
      {usesLegacyContent ? (
        <DialogContent>
          {title ? (
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
          ) : null}
          {children}
        </DialogContent>
      ) : (
        children
      )}
    </CleanRoot>
  );
}
Dialog.displayName = DialogPrimitive.Root.displayName || "Dialog";

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
