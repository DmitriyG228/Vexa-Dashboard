"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type {
  Platform,
  WebSocketIncomingMessage,
  MeetingStatus,
} from "@/types/vexa";
import { useMeetingsStore } from "@/stores/meetings-store";
import { getVexaWebSocketUrl } from "@/lib/utils";

interface UseLiveTranscriptsOptions {
  platform: Platform;
  nativeId: string;
  meetingId: string;
  isActive: boolean;
  onStatusChange?: (status: MeetingStatus) => void;
}

interface UseLiveTranscriptsReturn {
  isConnecting: boolean;
  isConnected: boolean;
  connectionError: string | null;
  reconnectAttempts: number;
}

// Configuration
const PING_INTERVAL = 25000; // 25 seconds
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds
const MAX_RECONNECT_ATTEMPTS = 10;
const POLLING_INTERVAL = 10000; // 10 seconds fallback polling

/**
 * Hook for managing live transcript updates via WebSocket.
 * Automatically connects when meeting is active and updates useMeetingsStore.
 * Falls back to polling if WebSocket connection fails.
 */
export function useLiveTranscripts(
  options: UseLiveTranscriptsOptions
): UseLiveTranscriptsReturn {
  const { platform, nativeId, meetingId, isActive, onStatusChange } = options;

  // Connection state
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // Refs for cleanup and internal state
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);
  const mountedRef = useRef(true);
  const reconnectAttemptsRef = useRef(0);

  // Store refs for stable callbacks
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // Store actions (stable references from Zustand)
  const addTranscriptSegment = useMeetingsStore((state) => state.addTranscriptSegment);
  const updateMeetingStatus = useMeetingsStore((state) => state.updateMeetingStatus);
  const fetchTranscripts = useMeetingsStore((state) => state.fetchTranscripts);

  // Calculate reconnect delay with exponential backoff
  const getReconnectDelay = useCallback((attempt: number) => {
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(2, attempt),
      MAX_RECONNECT_DELAY
    );
    // Add jitter (±20%)
    const jitter = delay * 0.2 * (Math.random() - 0.5);
    return Math.round(delay + jitter);
  }, []);

  // Cleanup all intervals and connections
  const cleanup = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, "Cleanup");
      wsRef.current = null;
    }
  }, []);

  // Start polling as fallback
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) return;

    console.log("[LiveTranscripts] Starting fallback polling");

    // Fetch immediately
    fetchTranscripts(platform, nativeId).catch((error) => {
      console.error("[LiveTranscripts] Initial polling fetch error:", error);
    });

    pollingIntervalRef.current = setInterval(async () => {
      if (!mountedRef.current) return;

      try {
        await fetchTranscripts(platform, nativeId);
      } catch (error) {
        console.error("[LiveTranscripts] Polling error:", error);
      }
    }, POLLING_INTERVAL);
  }, [platform, nativeId, fetchTranscripts]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      console.log("[LiveTranscripts] Stopped fallback polling");
    }
  }, []);

  // Main connection effect
  useEffect(() => {
    if (!isActive || !platform || !nativeId) {
      // Clean up and reset when not active
      shouldReconnectRef.current = false;
      cleanup();
      setIsConnecting(false);
      setIsConnected(false);
      setReconnectAttempts(0);
      reconnectAttemptsRef.current = 0;
      return;
    }

    mountedRef.current = true;
    shouldReconnectRef.current = true;
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);

    const connect = () => {
      if (!mountedRef.current || !shouldReconnectRef.current) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      // Clean up any existing connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      setIsConnecting(true);
      setConnectionError(null);

      const wsUrl = getVexaWebSocketUrl();
      console.log("[LiveTranscripts] Connecting to:", wsUrl);

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mountedRef.current) return;

          console.log("[LiveTranscripts] Connected");
          setIsConnecting(false);
          setIsConnected(true);
          setReconnectAttempts(0);
          reconnectAttemptsRef.current = 0;
          setConnectionError(null);

          // Stop polling since WebSocket is connected
          stopPolling();

          // Subscribe to meeting
          ws.send(
            JSON.stringify({
              action: "subscribe",
              meetings: [{ platform, native_id: nativeId }],
            })
          );

          // Start ping interval for keepalive
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ action: "ping" }));
            }
          }, PING_INTERVAL);
        };

        ws.onmessage = (event) => {
          if (!mountedRef.current) return;

          try {
            const message: WebSocketIncomingMessage = JSON.parse(event.data);

            switch (message.type) {
              case "transcript.mutable":
                // Add or update transcript in the store
                addTranscriptSegment(message.segment);
                break;

              case "meeting.status":
                // Update meeting status in the store
                updateMeetingStatus(meetingId, message.status);
                onStatusChangeRef.current?.(message.status);

                // If meeting ended, disconnect WebSocket
                if (message.status === "completed" || message.status === "failed") {
                  console.log("[LiveTranscripts] Meeting ended, disconnecting");
                  shouldReconnectRef.current = false;
                  ws.close(1000, "Meeting ended");
                }
                break;

              case "subscribed":
                console.log("[LiveTranscripts] Successfully subscribed to meeting");
                break;

              case "pong":
                // Keepalive acknowledged - connection is healthy
                break;

              case "error":
                console.error("[LiveTranscripts] Server error:", message.message);
                setConnectionError(message.message);
                break;
            }
          } catch (error) {
            console.error("[LiveTranscripts] Failed to parse message:", error);
          }
        };

        ws.onerror = (event) => {
          console.error("[LiveTranscripts] WebSocket error:", event);
          if (!mountedRef.current) return;
          setConnectionError("Connection error");
        };

        ws.onclose = (event) => {
          if (!mountedRef.current) return;

          console.log("[LiveTranscripts] Disconnected:", event.code, event.reason);
          setIsConnecting(false);
          setIsConnected(false);

          // Cleanup ping interval
          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
          }

          // Auto-reconnect if not intentionally closed
          if (shouldReconnectRef.current && event.code !== 1000) {
            reconnectAttemptsRef.current += 1;
            const attempts = reconnectAttemptsRef.current;
            setReconnectAttempts(attempts);

            if (attempts <= MAX_RECONNECT_ATTEMPTS) {
              const delay = getReconnectDelay(attempts);
              console.log(`[LiveTranscripts] Reconnecting in ${delay}ms (attempt ${attempts}/${MAX_RECONNECT_ATTEMPTS})`);

              reconnectTimeoutRef.current = setTimeout(() => {
                if (mountedRef.current && shouldReconnectRef.current) {
                  connect();
                }
              }, delay);
            } else {
              console.log("[LiveTranscripts] Max reconnect attempts reached, falling back to polling");
              setConnectionError("Connection lost. Using polling fallback.");
              startPolling();
            }
          }
        };
      } catch (error) {
        console.error("[LiveTranscripts] Failed to create WebSocket:", error);
        if (!mountedRef.current) return;

        setIsConnecting(false);
        setConnectionError((error as Error).message);

        // Fall back to polling immediately
        startPolling();
      }
    };

    // Start connection
    connect();

    // Cleanup on unmount or when dependencies change
    return () => {
      mountedRef.current = false;
      shouldReconnectRef.current = false;
      cleanup();
      setIsConnecting(false);
      setIsConnected(false);
    };
  }, [
    isActive,
    platform,
    nativeId,
    meetingId,
    addTranscriptSegment,
    updateMeetingStatus,
    getReconnectDelay,
    cleanup,
    startPolling,
    stopPolling,
  ]);

  return {
    isConnecting,
    isConnected,
    connectionError,
    reconnectAttempts,
  };
}
