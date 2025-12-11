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
