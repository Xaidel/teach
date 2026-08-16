import { CheckCircle2, X, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '#/lib/cn'

type ToastVariant = 'success' | 'error'

type ToastItem = {
  id: string
  variant: ToastVariant
  message: string
}

type ToastContextValue = {
  showToast: (variant: ToastVariant, message: string) => void
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => undefined,
})

const TOAST_DURATION_MS = 4000

let nextToastId = 0

/** Reads the nearest ToastProvider's toast dispatcher. Falls back to a
 * no-op outside a provider — component tests that render a submission
 * form in isolation don't need to know about toasts at all. */
export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}

/** Hosts the app's transient toast stack (bottom-right, auto-dismissing
 * after `TOAST_DURATION_MS`). Mount once near the document root; every
 * `useToast()` caller anywhere in the tree shares this one queue. */
export function ToastProvider({
  children,
}: {
  children: ReactNode
}): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timeoutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timeout = timeoutsRef.current.get(id)
    if (timeout) {
      clearTimeout(timeout)
      timeoutsRef.current.delete(id)
    }
  }, [])

  const showToast = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = String(++nextToastId)
      setToasts((current) => [...current, { id, variant, message }])
      timeoutsRef.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_DURATION_MS),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const timeouts = timeoutsRef.current
    return () => {
      for (const timeout of timeouts.values()) clearTimeout(timeout)
    }
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed inset-x-4 bottom-4 z-50 grid justify-items-end gap-2 sm:inset-x-auto sm:right-4"
      >
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            onDismiss={() => dismiss(toast.id)}
            toast={toast}
          />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastItem
  onDismiss: () => void
}): React.JSX.Element {
  const isSuccess = toast.variant === 'success'
  return (
    <div
      className={cn(
        'flex w-full max-w-sm items-center gap-3 rounded-2xl border px-4 py-3 shadow-xl',
        isSuccess
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-destructive/30 bg-destructive/10 text-destructive',
      )}
      data-slot="toast"
      role="status"
    >
      {isSuccess ? (
        <CheckCircle2 aria-hidden="true" className="size-5 shrink-0" />
      ) : (
        <XCircle aria-hidden="true" className="size-5 shrink-0" />
      )}
      <p className="flex-1 text-sm font-semibold">{toast.message}</p>
      <button
        aria-label="Dismiss notification"
        className="shrink-0 rounded-full p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        onClick={onDismiss}
        type="button"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  )
}
