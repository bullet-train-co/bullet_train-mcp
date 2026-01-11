import { AsyncLocalStorage } from 'async_hooks';

/**
 * Context data stored per-request
 */
export interface RequestContext {
  /**
   * Bearer token extracted from Authorization header
   */
  bearerToken?: string;
}

/**
 * AsyncLocalStorage instance for storing per-request context
 * Used to pass Bearer tokens from transport layer to auth providers
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();
