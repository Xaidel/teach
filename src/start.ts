import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

const csrfMiddleware = createCsrfMiddleware({
  filter: (context) => context.handlerType === 'serverFn',
})

/** Global Start configuration for same-origin server function protection. */
export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
}))
