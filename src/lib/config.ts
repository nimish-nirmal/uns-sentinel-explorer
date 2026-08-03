/**
 * Configuration management for UNS Sentinel Explorer
 * Supports environment variables and runtime configuration
 */

/**
 * Get the backend gateway URL
 * Priority:
 * 1. Environment variable VITE_GATEWAY_URL
 * 2. Always use localhost:4000 for development
 */
export function getGatewayUrl(): string {
  // Check environment variable first
  const envUrl = import.meta.env.VITE_GATEWAY_URL;
  if (envUrl) {
    return envUrl.trim();
  }

  // Always use port 4000 for the backend gateway
  // The backend runs on port 4000, NOT the Vite dev server port
  return 'http://localhost:4000';
}

/**
 * Get the frontend base URL
 */
export function getFrontendUrl(): string {
  return import.meta.env.BASE_URL || '/';
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return import.meta.env.DEV;
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return import.meta.env.PROD;
}

/**
 * Application configuration
 */
export const config = {
  gateway: {
    url: getGatewayUrl(),
  },
  frontend: {
    url: getFrontendUrl(),
  },
  environment: isProduction() ? 'production' : 'development',
} as const;

export default config;