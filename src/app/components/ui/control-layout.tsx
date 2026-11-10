import * as React from 'react';
import { cn } from './utils';

/** Presentation only: preserves native div props, refs, children and handlers. */
export const ActionGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-ui-controls="standard" className={cn('uiActionGroup', className)} {...props} />
  ),
);
ActionGroup.displayName = 'ActionGroup';

/** Fields wrap to the available card width, including when the sidebar is open. */
export const FilterRow = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-ui-controls="standard" className={cn('responsiveFilterGrid', className)} {...props} />
  ),
);
FilterRow.displayName = 'FilterRow';
