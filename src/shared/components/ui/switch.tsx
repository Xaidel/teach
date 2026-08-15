import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '#/lib/cn'

/** Props for the shared toggle-switch primitive. */
export type SwitchProps = React.ComponentProps<typeof SwitchPrimitive.Root>

/** Renders an accessible on/off switch (ARIA `role="switch"`), styled as a
 * sliding thumb rather than a checkbox. */
export function Switch({
  className,
  ...props
}: SwitchProps): React.JSX.Element {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-[18px]',
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  )
}
