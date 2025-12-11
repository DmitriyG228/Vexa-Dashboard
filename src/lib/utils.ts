import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Parse a timestamp string as UTC.
 * The API returns timestamps without timezone suffix (e.g., "2025-12-11T14:20:25.222296")
 * which JavaScript would interpret as local time. This function ensures UTC interpretation.
 */
export function parseUTCTimestamp(timestamp: string): Date {
  // Append 'Z' if not present to ensure UTC interpretation
  const utcTimestamp = timestamp.endsWith('Z') ? timestamp : timestamp + 'Z';
  return new Date(utcTimestamp);
}

/**
 * Get the WebSocket URL for the Vexa API.
 * Priority: NEXT_PUBLIC_VEXA_WS_URL > derived from NEXT_PUBLIC_VEXA_API_URL > default
 */
export function getVexaWebSocketUrl(): string {
  // First check for explicit WebSocket URL
  if (process.env.NEXT_PUBLIC_VEXA_WS_URL) {
    return process.env.NEXT_PUBLIC_VEXA_WS_URL;
  }

  // Derive from API URL if available
  if (process.env.NEXT_PUBLIC_VEXA_API_URL) {
    const apiUrl = process.env.NEXT_PUBLIC_VEXA_API_URL;
    // Convert http(s) to ws(s)
    const wsUrl = apiUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
    // Append /ws if not already there
    return wsUrl.endsWith('/ws') ? wsUrl : `${wsUrl.replace(/\/$/, '')}/ws`;
  }

  // Default fallback
  return "ws://localhost:18056/ws";
}
