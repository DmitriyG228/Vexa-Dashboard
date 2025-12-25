"use client";

import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { Search, Download, FileText, FileJson, FileVideo, X, Users, MessageSquare, Wifi, WifiOff, Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { TranscriptSegment } from "./transcript-segment";
import type { Meeting, TranscriptSegment as TranscriptSegmentType } from "@/types/vexa";
import { getSpeakerColor } from "@/types/vexa";
import {
  exportToTxt,
  exportToJson,
  exportToSrt,
  exportToVtt,
  downloadFile,
  generateFilename,
} from "@/lib/export";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface TranscriptViewerProps {
  meeting: Meeting;
  segments: TranscriptSegmentType[];
  isLoading?: boolean;
  isLive?: boolean;
  // WebSocket connection state (only relevant when isLive=true)
  wsConnecting?: boolean;
  wsConnected?: boolean;
  wsError?: string | null;
  wsReconnectAttempts?: number;
}

export function TranscriptViewer({
  meeting,
  segments,
  isLoading,
  isLive,
  wsConnecting,
  wsConnected,
  wsError,
  wsReconnectAttempts,
}: TranscriptViewerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSpeakers, setSelectedSpeakers] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Auto-follow state (stick to bottom unless user scrolls away)
  const [autoFollow, setAutoFollow] = useState(true);
  const autoFollowRef = useRef(true);
  const resumeFollowTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isAutoScrollingRef = useRef(false);
  
  // Track newly added segments for highlight animation
  const [newSegmentIds, setNewSegmentIds] = useState<Set<string>>(new Set());
  const previousSegmentIdsRef = useRef<Set<string>>(new Set());
  const highlightTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  useEffect(() => {
    autoFollowRef.current = autoFollow;
  }, [autoFollow]);

  // Keyboard shortcut for search (Cmd/Ctrl + F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === searchInputRef.current) {
        setSearchQuery("");
        searchInputRef.current?.blur();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Split text into sentence chunks for readability (max chars per chunk)
  const splitTextIntoSentenceChunks = useCallback((text: string, maxLen: number): string[] => {
    const normalized = (text || "").trim().replace(/\s+/g, " ");
    if (normalized.length <= maxLen) return [normalized];

    // Split into sentences on punctuation boundaries. Keep punctuation.
    const sentences = normalized.split(/(?<=[.!?])\s+/);
    if (sentences.length === 1) {
      // Single long sentence: return as one chunk to avoid breaking the sentence
      return [normalized];
    }

    const chunks: string[] = [];
    let current = "";
    for (const sentence of sentences) {
      if (current.length === 0) {
        if (sentence.length > maxLen) {
          // Sentence itself exceeds limit: do not split it
          chunks.push(sentence);
        } else {
          current = sentence;
        }
      } else if (current.length + 1 + sentence.length <= maxLen) {
        current = current + " " + sentence;
      } else {
        chunks.push(current);
        if (sentence.length > maxLen) {
          // Sentence exceeds limit: push as is to avoid breaking
          chunks.push(sentence);
          current = "";
        } else {
          current = sentence;
        }
      }
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }, []);

  // Group consecutive segments by speaker and combine text
  const groupSegmentsBySpeaker = useCallback((segments: TranscriptSegmentType[]) => {
    if (!segments || segments.length === 0) return [];

    // Sort by absolute_start_time
    const sorted = [...segments].sort((a, b) =>
      a.absolute_start_time.localeCompare(b.absolute_start_time)
    );

    interface GroupedSegment {
      speaker: string;
      startTime: string;
      endTime: string;
      startTimeSeconds: number;
      endTimeSeconds: number;
      combinedText: string;
      segments: TranscriptSegmentType[];
    }

    const groups: GroupedSegment[] = [];
    let current: GroupedSegment | null = null;

    for (const seg of sorted) {
      const speaker = seg.speaker || "Unknown";
      const text = (seg.text || "").trim();
      const startTime = seg.absolute_start_time;
      const endTime = seg.absolute_end_time || seg.absolute_start_time;

      if (!text) continue;

      if (current && current.speaker === speaker) {
        // Merge with current group
        current.combinedText += " " + text;
        current.endTime = endTime;
        current.endTimeSeconds = seg.end_time;
        current.segments.push(seg);
      } else {
        // Start new group
        if (current) groups.push(current);
        current = {
          speaker,
          startTime,
          endTime,
          startTimeSeconds: seg.start_time,
          endTimeSeconds: seg.end_time,
          combinedText: text,
          segments: [seg],
        };
      }
    }

    if (current) groups.push(current);

    // Split long speaker-runs into chunks for readability, but keep correct timestamps
    // by chunking on underlying segments (so each chunk's time = first segment in that chunk).
    const MAX_CHARS = 512;
    const chunkedGroups: GroupedSegment[] = [];

    for (const g of groups) {
      if (!g.segments || g.segments.length === 0) continue;

      let chunkSegments: TranscriptSegmentType[] = [];
      let chunkText = "";

      const flushChunk = () => {
        if (chunkSegments.length === 0) return;
        const first = chunkSegments[0];
        const last = chunkSegments[chunkSegments.length - 1];
        chunkedGroups.push({
          speaker: g.speaker,
          startTime: first.absolute_start_time,
          endTime: last.absolute_end_time || last.absolute_start_time,
          startTimeSeconds: first.start_time,
          endTimeSeconds: last.end_time,
          combinedText: chunkText.trim(),
          segments: chunkSegments,
        });
        chunkSegments = [];
        chunkText = "";
      };

      for (const seg of g.segments) {
        const segText = (seg.text || "").trim();
        if (!segText) continue;

        const candidate = chunkText ? `${chunkText} ${segText}` : segText;

        // If adding this segment would exceed MAX_CHARS, flush current chunk first.
        // Then start a new chunk with this segment.
        if (chunkSegments.length > 0 && candidate.length > MAX_CHARS) {
          flushChunk();
        }

        chunkSegments.push(seg);
        chunkText = chunkText ? `${chunkText} ${segText}` : segText;
      }

      flushChunk();
    }

    return chunkedGroups;
  }, []);

  // Get unique speakers in order of appearance
  const speakerOrder = useMemo(() => {
    const speakers: string[] = [];
    for (const segment of segments) {
      if (!speakers.includes(segment.speaker)) {
        speakers.push(segment.speaker);
      }
    }
    return speakers;
  }, [segments]);

  // Group segments by speaker first, then filter
  // Use segments.length as part of the key to ensure re-computation when segments change
  const groupedSegments = useMemo(() => {
    return groupSegmentsBySpeaker(segments);
  }, [segments, segments.length, groupSegmentsBySpeaker]);

  // Filter grouped segments by search query and selected speakers
  const filteredSegments = useMemo(() => {
    let result = groupedSegments;

    // Filter by selected speakers
    if (selectedSpeakers.length > 0) {
      result = result.filter((g) => selectedSpeakers.includes(g.speaker));
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (g) =>
          g.combinedText.toLowerCase().includes(query) ||
          g.speaker.toLowerCase().includes(query)
      );
    }

    return result;
  }, [groupedSegments, searchQuery, selectedSpeakers]);

  // Toggle speaker selection
  const toggleSpeaker = useCallback((speaker: string) => {
    setSelectedSpeakers((prev) =>
      prev.includes(speaker)
        ? prev.filter((s) => s !== speaker)
        : [...prev, speaker]
    );
  }, []);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setSelectedSpeakers([]);
  }, []);

  const hasActiveFilters = searchQuery.trim() || selectedSpeakers.length > 0;

  const isNearBottom = useCallback((el: HTMLElement, threshold = 120) => {
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom <= threshold;
  }, []);

  const clearResumeTimer = useCallback(() => {
    if (resumeFollowTimeoutRef.current) {
      clearTimeout(resumeFollowTimeoutRef.current);
      resumeFollowTimeoutRef.current = null;
    }
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const el = scrollRef.current;
      if (!el) return;

      // While smooth-scrolling back down, ignore scroll events so we don't immediately disable follow.
      isAutoScrollingRef.current = behavior === "smooth";

      const top = el.scrollHeight;
      try {
        el.scrollTo({ top, behavior });
      } catch {
        // Fallback for very old browsers
        el.scrollTop = top;
      }

      if (behavior === "smooth") {
        window.setTimeout(() => {
          isAutoScrollingRef.current = false;
        }, 900);
      } else {
        isAutoScrollingRef.current = false;
      }
    },
    []
  );

  const scheduleResumeFollow = useCallback(() => {
    clearResumeTimer();
    resumeFollowTimeoutRef.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      // Only pull back down if user is still away from bottom.
      if (!isNearBottom(el)) {
        setAutoFollow(true);
        scrollToBottom("smooth");
      } else {
        setAutoFollow(true);
      }
      resumeFollowTimeoutRef.current = null;
    }, 5000);
  }, [clearResumeTimer, isNearBottom, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isAutoScrollingRef.current) return;

    const atBottom = isNearBottom(el);
    if (atBottom) {
      if (!autoFollowRef.current) setAutoFollow(true);
      clearResumeTimer();
    } else {
      if (autoFollowRef.current) setAutoFollow(false);
      scheduleResumeFollow();
    }
  }, [clearResumeTimer, isNearBottom, scheduleResumeFollow]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      clearResumeTimer();
    };
  }, [clearResumeTimer]);

  // Auto-follow: whenever segments update during a live meeting, keep us pinned to the bottom (unless user scrolled up).
  useLayoutEffect(() => {
    if (!isLive) return;
    if (!autoFollowRef.current) return;
    // Wait for DOM paint.
    requestAnimationFrame(() => {
      scrollToBottom("auto");
    });
  }, [isLive, segments, scrollToBottom]);

  // Export handlers
  const handleExport = (format: "txt" | "json" | "srt" | "vtt") => {
    let content: string;
    let mimeType: string;

    switch (format) {
      case "txt":
        content = exportToTxt(meeting, segments);
        mimeType = "text/plain";
        break;
      case "json":
        content = exportToJson(meeting, segments);
        mimeType = "application/json";
        break;
      case "srt":
        content = exportToSrt(segments);
        mimeType = "text/plain";
        break;
      case "vtt":
        content = exportToVtt(segments);
        mimeType = "text/vtt";
        break;
    }

    const filename = generateFilename(meeting, format);
    downloadFile(content, filename, mimeType);
  };

  // Format transcript for ChatGPT
  const formatTranscriptForChatGPT = useCallback(() => {
    let output = "Meeting Transcript\n\n";
    
    if (meeting.data?.name || meeting.data?.title) {
      output += `Title: ${meeting.data?.name || meeting.data?.title}\n`;
    }
    
    if (meeting.start_time) {
      output += `Date: ${format(new Date(meeting.start_time), "PPPp")}\n`;
    }
    
    if (meeting.data?.participants?.length) {
      output += `Participants: ${meeting.data.participants.join(", ")}\n`;
    }
    
    output += "\n---\n\n";
    
    for (const segment of segments) {
      // Use absolute timestamp if available
      let timestamp = "";
      if (segment.absolute_start_time) {
        try {
          const date = new Date(segment.absolute_start_time);
          timestamp = date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "").replace("Z", "");
        } catch {
          timestamp = segment.absolute_start_time;
        }
      } else if (segment.start_time !== undefined) {
        // Fallback to relative timestamp
        const minutes = Math.floor(segment.start_time / 60);
        const seconds = Math.floor(segment.start_time % 60);
        timestamp = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
      }
      
      if (timestamp) {
        output += `[${timestamp}] ${segment.speaker}: ${segment.text}\n\n`;
      } else {
        output += `${segment.speaker}: ${segment.text}\n\n`;
      }
    }
    
    return output;
  }, [meeting, segments]);

  // Handle sending transcript to ChatGPT
  const handleSendToChatGPT = useCallback(async () => {
    if (segments.length === 0) return;

    // Prefer link-based flow (server-generated short-lived URL)
    try {
      const response = await fetch(
        `/api/vexa/transcripts/${meeting.platform}/${meeting.platform_specific_id}/share?meeting_id=${encodeURIComponent(meeting.id)}`,
        { method: "POST" }
      );
      if (response.ok) {
        const share = (await response.json()) as { url: string; share_id?: string };
        if (share?.url) {
          const publicBase = process.env.NEXT_PUBLIC_TRANSCRIPT_SHARE_BASE_URL?.replace(/\/$/, "");
          const shareUrl =
            publicBase && share.share_id
              ? `${publicBase}/public/transcripts/${share.share_id}.txt`
              : share.url;

          const q = `Read from ${shareUrl} so I can ask questions about it.`;
          const chatgptUrl = `https://chatgpt.com/?hints=search&q=${encodeURIComponent(q)}`;
          window.open(chatgptUrl, "_blank", "noopener,noreferrer");
          return;
        }
      }
    } catch (err) {
      console.error("Failed to create transcript share link:", err);
    }

    // Fallback: clipboard flow
    try {
      const transcriptText = formatTranscriptForChatGPT();
      await navigator.clipboard.writeText(transcriptText);
      const q =
        "I've copied a meeting transcript to my clipboard. Please wait while I paste it, then I'll ask questions about it.";
      const chatgptUrl = `https://chatgpt.com/?hints=search&q=${encodeURIComponent(q)}`;
      setTimeout(() => window.open(chatgptUrl, "_blank", "noopener,noreferrer"), 100);
    } catch (error) {
      console.error("Failed to copy transcript to clipboard:", error);
    }
  }, [segments, formatTranscriptForChatGPT, meeting.id, meeting.platform, meeting.platform_specific_id]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="flex-shrink-0 space-y-2 lg:space-y-4 py-3 lg:py-6">
        {/* Compact header on mobile, full on desktop - hidden on mobile */}
        <div className="hidden lg:flex items-center gap-2 lg:gap-4 flex-wrap">
          <div className="flex items-center gap-1.5 lg:gap-3">
            <CardTitle className="text-sm lg:text-base">Transcript</CardTitle>
            {isLive && (
              <Badge variant="destructive" className="animate-pulse text-[10px] lg:text-xs h-4 lg:h-5 px-1.5 lg:px-2">
                <span className="relative flex h-1.5 w-1.5 lg:h-2 lg:w-2 mr-1 lg:mr-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex rounded-full h-full w-full bg-white" />
                </span>
                Live
              </Badge>
            )}
          </div>

          {/* ChatGPT and Export buttons */}
          <div className="flex items-center gap-2">
            {segments.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 lg:h-9 px-2 lg:px-3 text-xs lg:text-sm gap-1 lg:gap-2"
                onClick={handleSendToChatGPT}
                title="Send transcript to ChatGPT"
              >
                <MessageSquare className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
                <span className="hidden sm:inline">ChatGPT</span>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 lg:h-9 px-2 lg:px-3 text-xs lg:text-sm gap-1 lg:gap-2">
                  <Download className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
                  <span className="hidden sm:inline">Export</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport("txt")}>
                  <FileText className="h-4 w-4 mr-2" />
                  Text (.txt)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("json")}>
                  <FileJson className="h-4 w-4 mr-2" />
                  JSON (.json)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("srt")}>
                  <FileVideo className="h-4 w-4 mr-2" />
                  Subtitles (.srt)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("vtt")}>
                  <FileVideo className="h-4 w-4 mr-2" />
                  WebVTT (.vtt)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Search and Filter Bar - compact on mobile */}
        <div className="flex flex-wrap items-center gap-1.5 lg:gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[150px] lg:min-w-[200px]">
            <Search className="absolute left-2 lg:left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 lg:h-4 lg:w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search... (Cmd+F)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                "h-7 lg:h-9 pl-7 lg:pl-9 pr-7 lg:pr-9 text-xs lg:text-sm transition-all",
                searchQuery && "ring-2 ring-primary/20"
              )}
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0.5 lg:right-1 top-1/2 -translate-y-1/2 h-6 w-6 lg:h-7 lg:w-7"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-3 w-3 lg:h-4 lg:w-4" />
              </Button>
            )}
          </div>

          {/* Speaker Filter */}
          {speakerOrder.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-7 lg:h-9 px-2 lg:px-3 text-xs lg:text-sm gap-1 lg:gap-2",
                    selectedSpeakers.length > 0 && "border-primary text-primary"
                  )}
                >
                  <Users className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
                  <span className="hidden sm:inline">Speakers</span>
                  {selectedSpeakers.length > 0 && (
                    <Badge variant="secondary" className="ml-0.5 lg:ml-1 h-4 lg:h-5 px-1 lg:px-1.5 text-[10px] lg:text-xs">
                      {selectedSpeakers.length}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {speakerOrder.map((speaker) => {
                  const color = getSpeakerColor(speaker, speakerOrder);
                  return (
                    <DropdownMenuCheckboxItem
                      key={speaker}
                      checked={selectedSpeakers.includes(speaker)}
                      onCheckedChange={() => toggleSpeaker(speaker)}
                    >
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", color.avatar)} />
                        <span className="truncate">{speaker || "Unknown"}</span>
                      </div>
                    </DropdownMenuCheckboxItem>
                  );
                })}
                {selectedSpeakers.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setSelectedSpeakers([])}>
                      Clear selection
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Clear all filters */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4 mr-1" />
              Clear filters
            </Button>
          )}
        </div>

        {/* Filter results info */}
        {hasActiveFilters && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground animate-fade-in">
            <span>
              Showing {filteredSegments.length} of {groupedSegments.length} groups
              {segments.length !== groupedSegments.length && ` (${segments.length} segments)`}
            </span>
            {searchQuery && (
              <Badge variant="outline" className="font-normal">
                &quot;{searchQuery}&quot;
              </Badge>
            )}
            {selectedSpeakers.map((speaker) => (
              <Badge
                key={speaker}
                variant="secondary"
                className="font-normal cursor-pointer hover:bg-destructive/20"
                onClick={() => toggleSpeaker(speaker)}
              >
                {speaker}
                <X className="h-3 w-3 ml-1" />
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>

      <CardContent className="flex-1 min-h-0 flex flex-col">
        <div 
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 pr-4 overflow-y-auto"
        >
          {filteredSegments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
              {hasActiveFilters ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                    <Search className="h-8 w-8 text-muted-foreground/50" />
                  </div>
                  <h3 className="font-medium mb-1">No results found</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Try adjusting your search or filters
                  </p>
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear all filters
                  </Button>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                    <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
                  </div>
                  <h3 className="font-medium mb-1">No transcript yet</h3>
                  <p className="text-sm text-muted-foreground">
                    {isLive
                      ? "Waiting for speech to transcribe..."
                      : "No transcript available for this meeting"}
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredSegments.map((group, index) => {
                // Create a synthetic segment for the grouped segment
                const syntheticSegment: TranscriptSegmentType = {
                  id: `${group.startTime}-${index}`,
                  meeting_id: meeting.id,
                  start_time: group.startTimeSeconds,
                  end_time: group.endTimeSeconds,
                  absolute_start_time: group.startTime,
                  absolute_end_time: group.endTime,
                  text: group.combinedText,
                  speaker: group.speaker,
                  language: group.segments[0]?.language || "en",
                  session_uid: group.segments[0]?.session_uid || "",
                  created_at: group.startTime,
                };

                return (
                  <div
                    key={`${group.startTime}-${index}`}
                    className="animate-fade-in"
                    style={{
                      animationDelay: isLive ? "0ms" : `${Math.min(index * 20, 200)}ms`,
                      animationFillMode: "backwards",
                    }}
                  >
                    <TranscriptSegment
                      segment={syntheticSegment}
                      speakerColor={getSpeakerColor(group.speaker, speakerOrder)}
                      searchQuery={searchQuery}
                      isHighlighted={searchQuery.length > 0}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
