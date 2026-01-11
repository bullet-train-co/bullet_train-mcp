import { AxiosError } from "axios"
import { requestContext } from "./request-context.js"

/**
 * Interface for providing authentication headers and handling authentication errors
 */
export interface AuthProvider {
  /**
   * Get authentication headers for the current request
   * This method is called before each API request to get fresh headers
   *
   * @returns Promise that resolves to headers object
   * @throws Error if authentication is not available (e.g., token expired)
   */
  getAuthHeaders(): Promise<Record<string, string>>

  /**
   * Handle authentication errors from API responses
   * This is called when the API returns authentication-related errors (401, 403)
   *
   * @param error - The axios error from the failed request
   * @returns Promise that resolves to true if the request should be retried, false otherwise
   */
  handleAuthError(error: AxiosError): Promise<boolean>
}

/**
 * Check if an error is authentication-related
 *
 * @param error - The error to check
 * @returns true if the error is authentication-related
 */
export function isAuthError(error: AxiosError): boolean {
  return error.response?.status === 401 || error.response?.status === 403
}

/**
 * Simple AuthProvider implementation that uses static headers
 * This is used for backward compatibility when no AuthProvider is provided
 */
export class StaticAuthProvider implements AuthProvider {
  constructor(private headers: Record<string, string> = {}) {}

  async getAuthHeaders(): Promise<Record<string, string>> {
    return { ...this.headers }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async handleAuthError(_error: AxiosError): Promise<boolean> {
    // Static auth provider cannot handle auth errors
    return false
  }
}

/**
 * AuthProvider implementation that uses Bearer tokens from request context
 * This is used for OAuth flows where the client provides a Bearer token in the Authorization header
 * The token is extracted by the transport layer and stored in AsyncLocalStorage
 */
export class BearerTokenAuthProvider implements AuthProvider {
  async getAuthHeaders(): Promise<Record<string, string>> {
    const context = requestContext.getStore()
    const token = context?.bearerToken

    if (!token) {
      throw new Error(
        "No bearer token found in request context. Ensure the client sends Authorization: Bearer <token> header.",
      )
    }

    return {
      Authorization: `Bearer ${token}`,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async handleAuthError(_error: AxiosError): Promise<boolean> {
    // Bearer token provider cannot refresh tokens - client must provide a new token
    return false
  }
}
