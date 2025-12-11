"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Users,
  Globe,
  Video,
  Pencil,
  Check,
  X,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/error-state";
import { TranscriptViewer } from "@/components/transcript/transcript-viewer";
import { BotStatusIndicator, BotFailedIndicator } from "@/components/meetings/bot-status-indicator";
import { AIChatPanel } from "@/components/ai";
import { useMeetingsStore } from "@/stores/meetings-store";
import { useMeetingTitlesStore } from "@/stores/meeting-titles-store";
import { useLiveTranscripts } from "@/hooks/use-live-transcripts";
import { PLATFORM_CONFIG, MEETING_STATUS_CONFIG } from "@/types/vexa";
import type { MeetingStatus } from "@/types/vexa";
import { cn } from "@/lib/utils";

export default function MeetingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const meetingId = params.id as string;

  const {
    currentMeeting,
    transcripts,
    isLoadingMeeting,
    isLoadingTranscripts,
    error,
    fetchMeeting,
    refreshMeeting,
    fetchTranscripts,
    clearCurrentMeeting,
  } = useMeetingsStore();

  const { setTitle, getTitle } = useMeetingTitlesStore();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");

  // Track if initial load is complete to prevent animation replays
  const hasLoadedRef = useRef(false);

  // Handle meeting status change from WebSocket
  const handleStatusChange = useCallback((status: MeetingStatus) => {
    // If meeting ended, refresh to get final data
    if (status === "completed" || status === "failed") {
      fetchMeeting(meetingId);
    }
  }, [fetchMeeting, meetingId]);

  // Live transcripts via WebSocket (only when meeting is active)
  const {
    isConnecting: wsConnecting,
    isConnected: wsConnected,
    connectionError: wsError,
    reconnectAttempts,
  } = useLiveTranscripts({
    platform: currentMeeting?.platform ?? "google_meet",
    nativeId: currentMeeting?.platform_specific_id ?? "",
    meetingId: meetingId,
    isActive: currentMeeting?.status === "active",
    onStatusChange: handleStatusChange,
  });

  useEffect(() => {
    if (meetingId) {
      fetchMeeting(meetingId);
    }

    return () => {
      clearCurrentMeeting();
      hasLoadedRef.current = false;
    };
  }, [meetingId, fetchMeeting, clearCurrentMeeting]);

  // Mark as loaded once we have data
  useEffect(() => {
    if (currentMeeting && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
    }
  }, [currentMeeting]);

  // Auto-refresh for early states (requested, joining, awaiting_admission)
  // Uses refreshMeeting for silent updates without UI flicker
  useEffect(() => {
    const isEarlyState =
      currentMeeting?.status === "requested" ||
      currentMeeting?.status === "joining" ||
      currentMeeting?.status === "awaiting_admission";

    if (!isEarlyState || !meetingId) return;

    const interval = setInterval(() => {
      refreshMeeting(meetingId);
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
  }, [currentMeeting?.status, meetingId, refreshMeeting]);

  // Fetch transcripts when meeting is loaded
  // Use specific properties as dependencies to avoid unnecessary refetches
  const meetingPlatform = currentMeeting?.platform;
  const meetingNativeId = currentMeeting?.platform_specific_id;

  useEffect(() => {
    if (meetingPlatform && meetingNativeId) {
      fetchTranscripts(meetingPlatform, meetingNativeId);
    }
  }, [meetingPlatform, meetingNativeId, fetchTranscripts]);

  if (error) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <ErrorState
          error={error}
          onRetry={() => fetchMeeting(meetingId)}
        />
      </div>
    );
  }

  if (isLoadingMeeting || !currentMeeting) {
    return <MeetingDetailSkeleton />;
  }

  const platformConfig = PLATFORM_CONFIG[currentMeeting.platform];
  const statusConfig = MEETING_STATUS_CONFIG[currentMeeting.status];

  const duration =
    currentMeeting.start_time && currentMeeting.end_time
      ? Math.round(
          (new Date(currentMeeting.end_time).getTime() -
            new Date(currentMeeting.start_time).getTime()) /
            60000
        )
      : null;

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Button variant="ghost" asChild>
        <Link href="/meetings">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Meetings
        </Link>
      </Button>

      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  className="text-2xl font-bold h-10 max-w-md"
                  placeholder="Meeting title..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setTitle(meetingId, editedTitle);
                      setIsEditingTitle(false);
                    } else if (e.key === "Escape") {
                      setIsEditingTitle(false);
                    }
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-green-600"
                  onClick={() => {
                    setTitle(meetingId, editedTitle);
                    setIsEditingTitle(false);
                  }}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground"
                  onClick={() => setIsEditingTitle(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <h1 className="text-2xl font-bold tracking-tight truncate">
                  {getTitle(meetingId) || currentMeeting.data?.title || currentMeeting.platform_specific_id}
                </h1>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => {
                    setEditedTitle(getTitle(meetingId) || currentMeeting.data?.title || "");
                    setIsEditingTitle(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            )}
            {currentMeeting.data?.participants && currentMeeting.data.participants.length > 0 && (
              <p className="text-sm text-muted-foreground mt-1">
                With {currentMeeting.data.participants.slice(0, 4).join(", ")}
                {currentMeeting.data.participants.length > 4 && ` +${currentMeeting.data.participants.length - 4} more`}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Badge
                variant="outline"
                className={cn(platformConfig.bgColor, platformConfig.textColor)}
              >
                {platformConfig.name}
              </Badge>
              <Badge className={cn(statusConfig.bgColor, statusConfig.color)}>
                {statusConfig.label}
              </Badge>
            </div>
          </div>
          {/* AI Chat Button */}
          {(currentMeeting.status === "active" || currentMeeting.status === "completed") && transcripts.length > 0 && (
            <AIChatPanel
              meeting={currentMeeting}
              transcripts={transcripts}
              trigger={
                <Button className="gap-2 shrink-0">
                  <Sparkles className="h-4 w-4" />
                  Ask AI
                </Button>
              }
            />
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Transcript or Status Indicator */}
        <div className="lg:col-span-2 order-2 lg:order-1">
          {/* Show bot status for early states */}
          {(currentMeeting.status === "requested" ||
            currentMeeting.status === "joining" ||
            currentMeeting.status === "awaiting_admission") && (
            <BotStatusIndicator
              status={currentMeeting.status}
              platform={currentMeeting.platform}
              meetingId={currentMeeting.platform_specific_id}
              createdAt={currentMeeting.created_at}
              onStopped={() => {
                // Refresh meeting data after stopping
                fetchMeeting(meetingId);
              }}
            />
          )}

          {/* Show failed indicator */}
          {currentMeeting.status === "failed" && (
            <BotFailedIndicator status={currentMeeting.status} />
          )}

          {/* Show transcript viewer for active/completed */}
          {(currentMeeting.status === "active" ||
            currentMeeting.status === "completed") && (
            <TranscriptViewer
              meeting={currentMeeting}
              segments={transcripts}
              isLoading={isLoadingTranscripts}
              isLive={currentMeeting.status === "active"}
              wsConnecting={wsConnecting}
              wsConnected={wsConnected}
              wsError={wsError}
              wsReconnectAttempts={reconnectAttempts}
            />
          )}
        </div>

        {/* Sidebar - sticky on desktop */}
        <div className="order-1 lg:order-2">
          <div className="lg:sticky lg:top-6 space-y-6">
          {/* Meeting Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Video className="h-4 w-4" />
                Meeting Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Meeting ID */}
              <div className="flex items-center gap-3">
                <Video className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Meeting ID</p>
                  <p className="text-sm text-muted-foreground font-mono">
                    {currentMeeting.platform_specific_id}
                  </p>
                </div>
              </div>

              {/* Date */}
              {currentMeeting.start_time && (
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Date</p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(currentMeeting.start_time), "PPPp")}
                    </p>
                  </div>
                </div>
              )}

              {/* Duration */}
              {duration && (
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Duration</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDuration(duration)}
                    </p>
                  </div>
                </div>
              )}

              {/* Languages */}
              {currentMeeting.data?.languages &&
                currentMeeting.data.languages.length > 0 && (
                  <div className="flex items-center gap-3">
                    <Globe className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Languages</p>
                      <p className="text-sm text-muted-foreground">
                        {currentMeeting.data.languages.join(", ").toUpperCase()}
                      </p>
                    </div>
                  </div>
                )}
            </CardContent>
          </Card>

          {/* Participants */}
          {currentMeeting.data?.participants &&
            currentMeeting.data.participants.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Participants ({currentMeeting.data.participants.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {currentMeeting.data.participants.map((participant, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 text-sm group"
                      >
                        <div className="h-2 w-2 rounded-full bg-primary transition-transform group-hover:scale-125" />
                        <span className="group-hover:text-primary transition-colors">{participant}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle>Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Segments</span>
                <span className="font-medium">{transcripts.length}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Speakers</span>
                <span className="font-medium">
                  {new Set(transcripts.map((t) => t.speaker)).size}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Words</span>
                <span className="font-medium">
                  {transcripts.reduce(
                    (acc, t) => acc + t.text.split(/\s+/).length,
                    0
                  )}
                </span>
              </div>
            </CardContent>
          </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function MeetingDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-40" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-20" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Skeleton className="h-[600px]" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-48" />
          <Skeleton className="h-40" />
        </div>
      </div>
    </div>
  );
}
