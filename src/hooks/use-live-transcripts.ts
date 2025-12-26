"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type {
  Platform,
  WebSocketIncomingMessage,
  MeetingStatus,
  TranscriptSegment,
  WebSocketSegment,
} from "@/types/vexa";
import { useMeetingsStore } from "@/stores/meetings-store";
import { vexaAPI } from "@/lib/api";

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

/**
 * Hook for managing live transcript updates via WebSocket.
 * Implements the algorithm from ws_realtime_transcription.py:
 * 1. Bootstrap from REST API (seed in-memory map by absolute_start_time)
 * 2. Connect to WebSocket and subscribe to meeting
 * 3. Process transcript.mutable and transcript.finalized events
 * 4. Deduplicate by absolute_start_time (keep newer updated_at)
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
  const shouldReconnectRef = useRef(true);
  const mountedRef = useRef(true);
  const reconnectAttemptsRef = useRef(0);
  const bootstrappedRef = useRef(false);

  // Store refs for stable callbacks
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // Store actions (stable references from Zustand)
  const bootstrapTranscripts = useMeetingsStore((state) => state.bootstrapTranscripts);
  const upsertTranscriptSegments = useMeetingsStore((state) => state.upsertTranscriptSegments);
  const updateMeetingStatus = useMeetingsStore((state) => state.updateMeetingStatus);

  // Convert WebSocket segment to TranscriptSegment format
  const convertWebSocketSegment = useCallback(
    (seg: WebSocketSegment): TranscriptSegment => ({
      id: seg.absolute_start_time, // Use timestamp as unique ID
      meeting_id: nativeId,
      start_time: seg.start || 0,
      end_time: seg.end_time || 0,
      absolute_start_time: seg.absolute_start_time,
      absolute_end_time: seg.absolute_end_time,
      text: seg.text,
      speaker: seg.speaker || "Unknown",
      language: seg.language || "en",
      session_uid: seg.session_uid || "",
      created_at: seg.absolute_start_time,
      updated_at: seg.updated_at,
    }),
    [nativeId]
  );

  // Step 1: Bootstrap from REST API
  const bootstrapFromRest = useCallback(async () => {
    if (bootstrappedRef.current) return;

    try {
      console.log(`[LiveTranscripts] Bootstrapping from REST API: ${platform}/${nativeId}`);
      const segments = await vexaAPI.getTranscripts(platform, nativeId);
      console.log(`[LiveTranscripts] Bootstrapped ${segments.length} segments from REST API`);
      
      // Bootstrap the transcript map (algorithm step 1)
      bootstrapTranscripts(segments);
      bootstrappedRef.current = true;
    } catch (error) {
      console.error("[LiveTranscripts] Bootstrap from REST API failed:", error);
      // Continue anyway - WebSocket will provide segments
      bootstrappedRef.current = true;
    }
  }, [platform, nativeId, bootstrapTranscripts]);

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
    if (wsRef.current) {
      wsRef.current.close(1000, "Cleanup");
      wsRef.current = null;
    }
  }, []);

  // WebSocket connection function
  const connect = useCallback(async () => {
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

    // Fetch WebSocket URL and auth token from runtime config API
    let wsUrl: string;
    let authToken: string | null = null;
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a89f31ed-bb1b-47a2-9c8c-c03467b63bbc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'use-live-transcripts.ts:159',message:'Fetching WebSocket config',data:{endpoint:'/api/config'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      const configResponse = await fetch("/api/config");
      const config = await configResponse.json();
      wsUrl = config.wsUrl;
      authToken = config.authToken;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a89f31ed-bb1b-47a2-9c8c-c03467b63bbc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'use-live-transcripts.ts:163',message:'WebSocket config received',data:{wsUrl:wsUrl?.replace(/api_key=[^&]+/,'api_key=***'),hasAuthToken:!!authToken,authTokenLength:authToken?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a89f31ed-bb1b-47a2-9c8c-c03467b63bbc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'use-live-transcripts.ts:165',message:'WebSocket config fetch failed',data:{error:(error as Error)?.message||String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      // Fallback to default (runtime config should always be available)
      wsUrl = "ws://localhost:18056/ws";
    }

    // Append auth token as query parameter if available
    // Vexa uses X-API-Key header for REST, but browsers can't set WS headers
    // So we pass it as api_key query parameter
    if (authToken) {
      const separator = wsUrl.includes("?") ? "&" : "?";
      wsUrl = `${wsUrl}${separator}api_key=${encodeURIComponent(authToken)}`;
    }
    console.log("[LiveTranscripts] Connecting to:", wsUrl.replace(/api_key=([^&]+)/, "api_key=***"));
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/a89f31ed-bb1b-47a2-9c8c-c03467b63bbc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'use-live-transcripts.ts:175',message:'Creating WebSocket connection',data:{wsUrl:wsUrl.replace(/api_key=[^&]+/,'api_key=***'),hasAuthToken:!!authToken,platform,nativeId,meetingId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;

        console.log("[LiveTranscripts] Connected");
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a89f31ed-bb1b-47a2-9c8c-c03467b63bbc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'use-live-transcripts.ts:181',message:'WebSocket opened',data:{platform,nativeId,meetingId,readyState:ws.readyState},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        setIsConnecting(false);
        setIsConnected(true);
        setReconnectAttempts(0);
        reconnectAttemptsRef.current = 0;
        setConnectionError(null);

        // Step 3: Subscribe to meeting for live transcript updates
        const subscribeMessage = {
          action: "subscribe",
          meetings: [{ platform, native_id: nativeId }],
        };
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a89f31ed-bb1b-47a2-9c8c-c03467b63bbc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'use-live-transcripts.ts:193',message:'Sending subscribe message',data:subscribeMessage,timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        ws.send(JSON.stringify(subscribeMessage));

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
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/a89f31ed-bb1b-47a2-9c8c-c03467b63bbc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'use-live-transcripts.ts:207',message:'WebSocket message received',data:{type:message.type,hasSegments:!!(message as any).payload?.segments,segmentCount:(message as any).payload?.segments?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
          // #endregion

          switch (message.type) {
            case "transcript.mutable":
            case "transcript.finalized":
              // Step 4: Process transcript events (mutable and finalized)
              // Deduplication by absolute_start_time is handled in upsertTranscriptSegments
              if (message.payload?.segments) {
                const segments: TranscriptSegment[] = [];
                for (const seg of message.payload.segments) {
                  // Skip empty segments or those missing required fields
                  if (!seg.text?.trim() || !seg.absolute_start_time) continue;

                  // Convert WebSocket segment to TranscriptSegment format
                  segments.push(convertWebSocketSegment(seg));
                }

                if (segments.length > 0) {
                  upsertTranscriptSegments(segments);
                  // #region agent log
                  try {
                    const uids = Array.from(new Set(segments.map((s) => s.session_uid).filter(Boolean)));
                    const unknownCount = segments.reduce((acc, s) => acc + (s.speaker === "Unknown" ? 1 : 0), 0);
                    fetch('http://127.0.0.1:7242/ingest/a89f31ed-bb1b-47a2-9c8c-c03467b63bbc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'use-live-transcripts.ts:250',message:'Segments processed (speaker/uid stats)',data:{segmentCount:segments.length,unknownSpeakerCount:unknownCount,uniqueSessionUidPrefixes:uids.map((u)=>u.slice(0,8)),platform,nativeId,meetingId},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'S1'})}).catch(()=>{});
                  } catch {}
                  // #endregion
                  console.log(
                    `[LiveTranscripts] ${message.type}: ${segments.length} segments processed`
                  );
                }
              }
              break;

            case "meeting.status":
              // Update meeting status in the store (status is in payload)
              const status = message.payload?.status;
              if (status) {
                updateMeetingStatus(meetingId, status);
                onStatusChangeRef.current?.(status);

                // If meeting ended, disconnect WebSocket
                if (status === "completed" || status === "failed") {
                  console.log("[LiveTranscripts] Meeting ended, disconnecting");
                  shouldReconnectRef.current = false;
                  ws.close(1000, "Meeting ended");
                }
              }
              break;

            case "subscribed":
              console.log("[LiveTranscripts] Successfully subscribed to meeting", message.meetings);
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a89f31ed-bb1b-47a2-9c8c-c03467b63bbc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'use-live-transcripts.ts:271',message:'WebSocket error event',data:{readyState:ws.readyState,url:ws.url?.replace(/api_key=[^&]+/,'api_key=***'),protocol:ws.protocol,extensions:ws.extensions,eventType:event.type,hasError:!!(event as any).error,errorMessage:(event as any).error?.message||null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
        // #endregion
        if (!mountedRef.current) return;
        setConnectionError("Connection error");
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;

        console.log("[LiveTranscripts] Disconnected:", event.code, event.reason);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a89f31ed-bb1b-47a2-9c8c-c03467b63bbc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'use-live-transcripts.ts:277',message:'WebSocket closed',data:{code:event.code,reason:event.reason,wasClean:event.wasClean,readyState:ws.readyState},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
        // #endregion
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
            console.log("[LiveTranscripts] Max reconnect attempts reached");
            setConnectionError("Connection lost. Max reconnect attempts reached.");
          }
        }
      };
    } catch (error) {
      console.error("[LiveTranscripts] Failed to create WebSocket:", error);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a89f31ed-bb1b-47a2-9c8c-c03467b63bbc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'use-live-transcripts.ts:311',message:'WebSocket creation failed',data:{error:(error as Error)?.message||String(error),errorName:(error as Error)?.name||'Unknown',stack:(error as Error)?.stack?.substring(0,200)||null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
      if (!mountedRef.current) return;

      setIsConnecting(false);
      setConnectionError((error as Error).message);
    }
  }, [
    platform,
    nativeId,
    meetingId,
    convertWebSocketSegment,
    upsertTranscriptSegments,
    updateMeetingStatus,
    getReconnectDelay,
    cleanup,
  ]);

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
      bootstrappedRef.current = false;
      return;
    }

    mountedRef.current = true;
    shouldReconnectRef.current = true;
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);

    // Step 1: Bootstrap from REST API first
    bootstrapFromRest().then(() => {
      // Step 2: Connect to WebSocket after bootstrap
      connect();
    });

    // Cleanup on unmount or when dependencies change
    return () => {
      mountedRef.current = false;
      shouldReconnectRef.current = false;
      cleanup();
      setIsConnecting(false);
      setIsConnected(false);
    };
  }, [isActive, platform, nativeId, bootstrapFromRest, connect, cleanup]);

  return {
    isConnecting,
    isConnected,
    connectionError,
    reconnectAttempts,
  };
}
