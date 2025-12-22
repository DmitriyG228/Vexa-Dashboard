"use client";

import { useEffect, useState, useRef, useCallback, use } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
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
  Loader2,
  FileText,
  StopCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/ui/error-state";
import { TranscriptViewer } from "@/components/transcript/transcript-viewer";
import { BotStatusIndicator, BotFailedIndicator } from "@/components/meetings/bot-status-indicator";
import { AIChatPanel } from "@/components/ai";
import { useMeetingsStore } from "@/stores/meetings-store";
import { useLiveTranscripts } from "@/hooks/use-live-transcripts";
import { PLATFORM_CONFIG, getDetailedStatus } from "@/types/vexa";
import type { MeetingStatus } from "@/types/vexa";
import { StatusHistory } from "@/components/meetings/status-history";
import { cn } from "@/lib/utils";
import { vexaAPI } from "@/lib/api";
import { toast } from "sonner";

export default function MeetingDetailPage() {
  const params = useParams();
  const router = useRouter();
  // Unwrap params if it's a Promise (Next.js 15+ compatibility)
  // In Next.js 15+, params can be a Promise and must be unwrapped with React.use()
  // Check if params is a Promise by checking if it has 'then' method and doesn't have 'id' property
  const isPromise = params && typeof params === 'object' && 
    'then' in params && 
    typeof (params as any).then === 'function' && 
    !('id' in params);
  const resolvedParams = isPromise 
    ? use(params as Promise<{ id: string }>)
    : (params as { id: string });
  const meetingId = resolvedParams.id as string;

  const {
    currentMeeting,
    transcripts,
    isLoadingMeeting,
    isLoadingTranscripts,
    isUpdatingMeeting,
    error,
    fetchMeeting,
    refreshMeeting,
    fetchTranscripts,
    updateMeetingData,
    clearCurrentMeeting,
  } = useMeetingsStore();

  // Title editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  // Notes editing state
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [editedNotes, setEditedNotes] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  // Bot control state
  const [isStoppingBot, setIsStoppingBot] = useState(false);

  // Track if initial load is complete to prevent animation replays
  const hasLoadedRef = useRef(false);

  // Handle meeting status change from WebSocket
  const handleStatusChange = useCallback((status: MeetingStatus) => {
    // If meeting ended, refresh to get final data
    if (status === "completed" || status === "failed") {
      fetchMeeting(meetingId);
    }
  }, [fetchMeeting, meetingId]);

  // Handle stopping the bot
  const handleStopBot = useCallback(async () => {
    if (!currentMeeting) return;
    setIsStoppingBot(true);
    try {
      await vexaAPI.stopBot(currentMeeting.platform, currentMeeting.platform_specific_id);
      toast.success("Bot stopped", {
        description: "The transcription has been stopped.",
      });
      fetchMeeting(meetingId);
    } catch (error) {
      toast.error("Failed to stop bot", {
        description: (error as Error).message,
      });
    } finally {
      setIsStoppingBot(false);
    }
  }, [currentMeeting, fetchMeeting, meetingId]);

  // Live transcripts and status updates via WebSocket (for active and early states)
  const isEarlyState = currentMeeting?.status === "requested" || 
                       currentMeeting?.status === "joining" || 
                       currentMeeting?.status === "awaiting_admission";
  const shouldUseWebSocket = currentMeeting?.status === "active" || isEarlyState;
  
  const {
    isConnecting: wsConnecting,
    isConnected: wsConnected,
    connectionError: wsError,
    reconnectAttempts,
  } = useLiveTranscripts({
    platform: currentMeeting?.platform ?? "google_meet",
    nativeId: currentMeeting?.platform_specific_id ?? "",
    meetingId: meetingId,
    isActive: shouldUseWebSocket,
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

  // No longer need polling - WebSocket handles status updates for early states
  // Removed auto-refresh polling since WebSocket provides real-time updates

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
  const statusConfig = getDetailedStatus(currentMeeting.status, currentMeeting.data);

  // Safety check: ensure statusConfig is always defined
  if (!statusConfig) {
    console.error("statusConfig is undefined for status:", currentMeeting.status);
    return <MeetingDetailSkeleton />;
  }

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
                  disabled={isSavingTitle}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && editedTitle.trim()) {
                      setIsSavingTitle(true);
                      try {
                        await updateMeetingData(currentMeeting.platform, currentMeeting.platform_specific_id, {
                          name: editedTitle.trim(),
                        });
                        setIsEditingTitle(false);
                        toast.success("Title updated");
                      } catch (err) {
                        toast.error("Failed to update title");
                      } finally {
                        setIsSavingTitle(false);
                      }
                    } else if (e.key === "Escape") {
                      setIsEditingTitle(false);
                    }
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-green-600"
                  disabled={isSavingTitle || !editedTitle.trim()}
                  onClick={async () => {
                    if (!editedTitle.trim()) return;
                    setIsSavingTitle(true);
                    try {
                      await updateMeetingData(currentMeeting.platform, currentMeeting.platform_specific_id, {
                        name: editedTitle.trim(),
                      });
                      setIsEditingTitle(false);
                      toast.success("Title updated");
                    } catch (err) {
                      toast.error("Failed to update title");
                    } finally {
                      setIsSavingTitle(false);
                    }
                  }}
                >
                  {isSavingTitle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground"
                  disabled={isSavingTitle}
                  onClick={() => setIsEditingTitle(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <h1 className="text-2xl font-bold tracking-tight truncate">
                  {currentMeeting.data?.name || currentMeeting.data?.title || currentMeeting.platform_specific_id}
                </h1>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => {
                    setEditedTitle(currentMeeting.data?.name || currentMeeting.data?.title || "");
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
              <Badge className={cn(statusConfig.bgColor, statusConfig.color)}>
                {statusConfig.label}
              </Badge>
            </div>
          </div>
          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Stop Bot Button - only when active */}
            {currentMeeting.status === "active" && (
              <Button
                variant="outline"
                className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={handleStopBot}
                disabled={isStoppingBot}
              >
                {isStoppingBot ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <StopCircle className="h-4 w-4" />
                )}
                Stop
              </Button>
            )}
            {/* AI Chat Button */}
            {(currentMeeting.status === "active" || currentMeeting.status === "completed") && transcripts.length > 0 && (
              <AIChatPanel
                meeting={currentMeeting}
                transcripts={transcripts}
                trigger={
                  <Button className="gap-2">
                    <Sparkles className="h-4 w-4" />
                    Ask AI
                  </Button>
                }
              />
            )}
          </div>
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
              updatedAt={currentMeeting.updated_at}
              onStopped={() => {
                // Refresh meeting data after stopping
                fetchMeeting(meetingId);
              }}
            />
          )}

          {/* Show failed indicator */}
          {currentMeeting.status === "failed" && (
            <BotFailedIndicator
              status={currentMeeting.status}
              errorMessage={currentMeeting.data?.error || currentMeeting.data?.failure_reason || currentMeeting.data?.status_message}
              errorCode={currentMeeting.data?.error_code}
            />
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
              {/* Platform & Meeting ID */}
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg flex items-center justify-center overflow-hidden bg-background">
                  <Image
                    src={currentMeeting.platform === "google_meet" 
                      ? "/icons/icons8-google-meet-96.png" 
                      : "/icons/icons8-teams-96.png"}
                    alt={platformConfig.name}
                    width={32}
                    height={32}
                    className="object-contain"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium">{platformConfig.name}</p>
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

          {/* Details */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Status with description */}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <div className="text-right">
                  <span className={cn("font-medium", statusConfig.color)}>
                    {statusConfig.label}
                  </span>
                  {statusConfig.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {statusConfig.description}
                    </p>
                  )}
                </div>
              </div>
              <Separator />
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

              {/* Status History */}
              {currentMeeting.data?.status_transition && currentMeeting.data.status_transition.length > 0 && (
                <>
                  <Separator />
                  <StatusHistory transitions={currentMeeting.data.status_transition} />
                </>
              )}
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Notes
                </CardTitle>
                {!isEditingNotes && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground"
                    onClick={() => {
                      setEditedNotes(currentMeeting.data?.notes || "");
                      setIsEditingNotes(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    {currentMeeting.data?.notes ? "Edit" : "Add"}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {isEditingNotes ? (
                <div className="space-y-3">
                  <Textarea
                    value={editedNotes}
                    onChange={(e) => setEditedNotes(e.target.value)}
                    placeholder="Add notes about this meeting..."
                    className="min-h-[120px] resize-none"
                    disabled={isSavingNotes}
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isSavingNotes}
                      onClick={() => setIsEditingNotes(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={isSavingNotes}
                      onClick={async () => {
                        setIsSavingNotes(true);
                        try {
                          await updateMeetingData(currentMeeting.platform, currentMeeting.platform_specific_id, {
                            notes: editedNotes.trim(),
                          });
                          setIsEditingNotes(false);
                          toast.success("Notes saved");
                        } catch (err) {
                          toast.error("Failed to save notes");
                        } finally {
                          setIsSavingNotes(false);
                        }
                      }}
                    >
                      {isSavingNotes ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        "Save"
                      )}
                    </Button>
                  </div>
                </div>
              ) : currentMeeting.data?.notes ? (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {currentMeeting.data.notes}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No notes yet. Click "Add" to add notes.
                </p>
              )}
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
