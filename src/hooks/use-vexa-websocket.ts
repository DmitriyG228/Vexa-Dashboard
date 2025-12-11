"use client";

import { useEffect, useRef, useCallback } from "react";
import type {
  Platform,
  WebSocketIncomingMessage,
  TranscriptSegment,
  MeetingStatus,
} from "@/types/vexa";
import { useLiveStore } from "@/stores/live-store";
import { getVexaWebSocketUrl } from "@/lib/utils";

interface UseVexaWebSocketOptions {
  platform: Platform;
  nativeId: string;
  onTranscript?: (segment: TranscriptSegment) => void;
  onStatusChange?: (status: MeetingStatus) => void;
  onError?: (error: string) => void;
  autoConnect?: boolean;
}

interface UseVexaWebSocketReturn {
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
}

const PING_INTERVAL = 25000; // 25 seconds
const RECONNECT_DELAY = 3000; // 3 seconds

export function useVexaWebSocket(
  options: UseVexaWebSocketOptions
): UseVexaWebSocketReturn {
  const { platform, nativeId, onTranscript, onStatusChange, onError, autoConnect = true } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);

  const {
    isConnecting,
    isConnected,
    connectionError,
    setConnectionState,
    addLiveTranscript,
    setBotStatus,
  } = useLiveStore();

  const cleanup = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message: WebSocketIncomingMessage = JSON.parse(event.data);

        switch (message.type) {
          case "transcript.mutable":
            addLiveTranscript(message.segment);
            onTranscript?.(message.segment);
            break;

          case "meeting.status":
            setBotStatus(message.status);
            onStatusChange?.(message.status);
            break;

          case "subscribed":
            console.log("WebSocket: Subscribed to meeting");
            break;

          case "pong":
            // Keepalive acknowledged
            break;

          case "error":
            console.error("WebSocket error:", message.message);
            onError?.(message.message);
            break;
        }
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    },
    [addLiveTranscript, setBotStatus, onTranscript, onStatusChange, onError]
  );

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    cleanup();
    shouldReconnectRef.current = true;
    setConnectionState(true, false);

    const wsUrl = getVexaWebSocketUrl();

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket: Connected");
        setConnectionState(false, true);

        // Subscribe to meeting
        ws.send(
          JSON.stringify({
            action: "subscribe",
            meetings: [{ platform, native_id: nativeId }],
          })
        );

        // Start ping interval
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: "ping" }));
          }
        }, PING_INTERVAL);
      };

      ws.onmessage = handleMessage;

      ws.onerror = (event) => {
        console.error("WebSocket error:", event);
        setConnectionState(false, false, "Connection error");
        onError?.("WebSocket connection error");
      };

      ws.onclose = (event) => {
        console.log("WebSocket: Closed", event.code, event.reason);
        setConnectionState(false, false);

        // Cleanup ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // Auto-reconnect if not intentionally closed
        if (shouldReconnectRef.current && event.code !== 1000) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log("WebSocket: Attempting reconnection...");
            connect();
          }, RECONNECT_DELAY);
        }
      };
    } catch (error) {
      console.error("Failed to create WebSocket:", error);
      setConnectionState(false, false, (error as Error).message);
      onError?.((error as Error).message);
    }
  }, [platform, nativeId, handleMessage, cleanup, setConnectionState, onError]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    cleanup();
    setConnectionState(false, false);
  }, [cleanup, setConnectionState]);

  // Auto-connect on mount if enabled
  // Note: We intentionally exclude connect/cleanup from deps to avoid infinite loops
  // The effect should only run when platform/nativeId/autoConnect changes
  useEffect(() => {
    if (autoConnect && platform && nativeId) {
      // Cleanup any existing connection first
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      shouldReconnectRef.current = true;
      setConnectionState(true, false);

      const wsUrl = getVexaWebSocketUrl();

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("WebSocket: Connected");
          setConnectionState(false, true);

          // Subscribe to meeting
          ws.send(
            JSON.stringify({
              action: "subscribe",
              meetings: [{ platform, native_id: nativeId }],
            })
          );

          // Start ping interval
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ action: "ping" }));
            }
          }, PING_INTERVAL);
        };

        ws.onmessage = (event) => {
          try {
            const message: WebSocketIncomingMessage = JSON.parse(event.data);

            switch (message.type) {
              case "transcript.mutable":
                addLiveTranscript(message.segment);
                onTranscript?.(message.segment);
                break;

              case "meeting.status":
                setBotStatus(message.status);
                onStatusChange?.(message.status);
                break;

              case "subscribed":
                console.log("WebSocket: Subscribed to meeting");
                break;

              case "pong":
                // Keepalive acknowledged
                break;

              case "error":
                console.error("WebSocket error:", message.message);
                onError?.(message.message);
                break;
            }
          } catch (error) {
            console.error("Failed to parse WebSocket message:", error);
          }
        };

        ws.onerror = (event) => {
          console.error("WebSocket error:", event);
          setConnectionState(false, false, "Connection error");
          onError?.("WebSocket connection error");
        };

        ws.onclose = (event) => {
          console.log("WebSocket: Closed", event.code, event.reason);
          setConnectionState(false, false);

          // Cleanup ping interval
          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
          }

          // Don't auto-reconnect for now to avoid loops
        };
      } catch (error) {
        console.error("Failed to create WebSocket:", error);
        setConnectionState(false, false, (error as Error).message);
        onError?.((error as Error).message);
      }
    }

    return () => {
      shouldReconnectRef.current = false;
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, platform, nativeId]);

  return {
    isConnecting,
    isConnected,
    error: connectionError,
    connect,
    disconnect,
  };
}
