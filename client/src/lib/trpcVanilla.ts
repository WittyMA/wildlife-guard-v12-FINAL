/**
 * Vanilla tRPC client for non-React code (e.g., aiDetection.ts)
 * This allows calling tRPC procedures outside of React components/hooks.
 */
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../../../server/routers';

export const vanillaTrpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/api/trpc',
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: 'include',
        });
      },
    }),
  ],
});
