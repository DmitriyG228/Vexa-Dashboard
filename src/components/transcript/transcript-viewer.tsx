"use client";

import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { Search, Download, FileText, FileJson, FileVideo, X, Users, MessageSquare, Wifi, WifiOff, Loader2, AlertCircle, Sparkles, Settings, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import Image from "next/image";
import { AIChatPanel } from "@/components/ai";
import { getCookie, setCookie } from "@/lib/cookies";
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false); // Track if user has manually scrolled away from bottom
  const lastScrollTopRef = useRef(0);
  const previousSegmentsLengthRef = useRef(0);

  // ChatGPT prompt state
  const [chatgptPrompt, setChatgptPrompt] = useState(() => {
    if (typeof window !== "undefined") {
      return getCookie("vexa-chatgpt-prompt") || "Read from {url} so I can ask questions about it.";
    }
    return "Read from {url} so I can ask questions about it.";
  });
  const [isChatgptPromptExpanded, setIsChatgptPromptExpanded] = useState(false);
  const [editedChatgptPrompt, setEditedChatgptPrompt] = useState(chatgptPrompt);
  const chatgptPromptTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Measure scroll container for auto-follow
  const isNearBottom = useCallback((el: HTMLElement) => {
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom <= 50; // Allow some tolerance
  }, []);
  
  // Track only the most recently updated segment with appended text
  const [mostRecentUpdatedSegment, setMostRecentUpdatedSegment] = useState<{ id: string; appendedText: string } | null>(null);
  const previousSegmentIdsRef = useRef<Set<string>>(new Set());
  const previousSegmentTextsRef = useRef<Map<string, string>>(new Map());
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  // Handle scroll events to detect when user scrolls up
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const currentScrollTop = el.scrollTop;
    const prevScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = currentScrollTop;

    // If user scrolled up, mark them as having scrolled away from bottom
    if (currentScrollTop < prevScrollTop) {
      userScrolledUpRef.current = true;
    }

    // If user is back at bottom, resume auto-scrolling
    if (isNearBottom(el)) {
      userScrolledUpRef.current = false;
    }
  }, [isNearBottom]);

  // Track only the most recently updated segment with appended text
  useEffect(() => {
    if (!isLive || segments.length === 0) {
      previousSegmentIdsRef.current = new Set();
      previousSegmentTextsRef.current.clear();
      return;
    }

    // Create a set of current segment IDs and track text changes
    const currentSegmentIds = new Set<string>();
    const currentSegmentTexts = new Map<string, string>();
    
    segments.forEach((seg) => {
      const id = seg.id || `${seg.absolute_start_time}-${seg.start_time}`;
      currentSegmentIds.add(id);
      currentSegmentTexts.set(id, seg.text || "");
    });

    // Find the most recently updated segment (check from end of array)
    let mostRecentUpdate: { id: string; appendedText: string } | null = null;

    // Check segments from the end (most recent first)
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      const id = seg.id || `${seg.absolute_start_time}-${seg.start_time}`;
      const currentText = seg.text || "";
      
      // Check if this is a new segment
      if (!previousSegmentIdsRef.current.has(id)) {
        // For new segments, highlight the entire text initially
        mostRecentUpdate = { id, appendedText: currentText };
        break; // Found the most recent update, stop looking
      } else {
        // Check if text was appended to an existing segment
        const previousText = previousSegmentTextsRef.current.get(id) || "";
        if (currentText.length > previousText.length && currentText.startsWith(previousText)) {
          const appendedText = currentText.slice(previousText.length);
          mostRecentUpdate = { id, appendedText };
          break; // Found the most recent update, stop looking
        }
      }
    }

    // Update state with only the most recent update
    if (mostRecentUpdate) {
      // Clear any existing timeout
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }

      setMostRecentUpdatedSegment(mostRecentUpdate);

      // Set up timeout to remove highlight after 3 seconds
      highlightTimeoutRef.current = setTimeout(() => {
        setMostRecentUpdatedSegment(null);
        highlightTimeoutRef.current = null;
      }, 3000); // 3 seconds
    }

    // Update previous segment IDs and texts
    previousSegmentIdsRef.current = currentSegmentIds;
    previousSegmentTextsRef.current = currentSegmentTexts;
  }, [segments, isLive]);

  // Cleanup highlight timeout on unmount
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);


  // Auto-scroll to bottom when new segments arrive, unless user has scrolled up
  useLayoutEffect(() => {
    if (!isLive) return;

    const el = scrollRef.current;
    if (!el) return;

    // Only auto-scroll when new segments are actually added (not initial load)
    const hasNewSegments = segments.length > previousSegmentsLengthRef.current;
    previousSegmentsLengthRef.current = segments.length;

    if (!hasNewSegments) return;

    // Don't auto-scroll if user has manually scrolled up
    if (userScrolledUpRef.current) return;

    // Only scroll if we're actually near the bottom
    // This prevents scrolling when user is reading older content
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const shouldScroll = distanceFromBottom <= 100; // Allow more tolerance

    if (!shouldScroll) return;

    // Small delay to ensure DOM has updated
    requestAnimationFrame(() => {
      // Double-check element still exists and we're still in live mode
      if (!el || !isLive) return;

      // Scroll to bottom by default (like a chat app)
      bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
    });
  }, [isLive, segments.length]);

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

  // Handle sending transcript to an AI provider (ChatGPT or Perplexity)
  const handleOpenInProvider = useCallback(async (provider: "chatgpt" | "perplexity") => {
    if (segments.length === 0) return;

    // Prefer link-based flow
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

          // Use custom prompt, replacing {url} placeholder
          const prompt = chatgptPrompt.replace(/{url}/g, shareUrl);
          
          let providerUrl: string;
          if (provider === "chatgpt") {
            providerUrl = `https://chatgpt.com/?hints=search&q=${encodeURIComponent(prompt)}`;
          } else {
            providerUrl = `https://www.perplexity.ai/search?q=${encodeURIComponent(prompt)}`;
          }
          
          window.open(providerUrl, "_blank", "noopener,noreferrer");
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
      const q = "I've copied a meeting transcript to my clipboard. Please wait while I paste it, then I'll ask questions about it.";
      let providerUrl: string;
      if (provider === "chatgpt") {
        providerUrl = `https://chatgpt.com/?hints=search&q=${encodeURIComponent(q)}`;
      } else {
        providerUrl = `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`;
      }
      setTimeout(() => window.open(providerUrl, "_blank", "noopener,noreferrer"), 100);
    } catch (error) {
      console.error("Failed to copy transcript to clipboard:", error);
    }
  }, [segments, formatTranscriptForChatGPT, meeting.id, meeting.platform, meeting.platform_specific_id, chatgptPrompt]);

  // Handle saving ChatGPT prompt to cookie
  const handleChatgptPromptBlur = useCallback(() => {
    const trimmed = editedChatgptPrompt.trim();
    if (trimmed && trimmed !== chatgptPrompt) {
      setChatgptPrompt(trimmed);
      setCookie("vexa-chatgpt-prompt", trimmed);
    }
  }, [editedChatgptPrompt, chatgptPrompt]);

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
    <Card className="flex flex-col h-full flex-1 min-h-0">
      <CardHeader className="flex-shrink-0 space-y-2 py-2 lg:py-3">
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

      {/* Collapsible ChatGPT Prompt Section */}
      {isChatgptPromptExpanded && (
        <div className="px-6 pb-4 animate-in slide-in-from-top-2 duration-200">
          <div className="bg-muted/30 rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-2">
                <Settings className="h-4 w-4" />
                AI Prompt
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setIsChatgptPromptExpanded(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2">
              <Input
                ref={chatgptPromptTextareaRef as any}
                value={editedChatgptPrompt}
                onChange={(e) => setEditedChatgptPrompt(e.target.value)}
                onBlur={handleChatgptPromptBlur}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setEditedChatgptPrompt(chatgptPrompt);
                    setIsChatgptPromptExpanded(false);
                  }
                }}
                placeholder="AI prompt (use {url} for the transcript URL)"
                className="text-sm"
                autoFocus
              />
              <p className="text-[10px] text-muted-foreground">
                Use <code className="px-1 py-0.5 bg-muted rounded">{"{url}"}</code> as a placeholder for the transcript link.
              </p>
            </div>
          </div>
        </div>
      )}

      <CardContent className="flex-1 min-h-0 flex flex-col overflow-hidden">
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

                // Check if this group contains the most recently updated segment
                let textToHighlight: string | null = null;
                
                if (mostRecentUpdatedSegment) {
                  // Find the segment in this group that matches the most recent update
                  const matchingSegment = group.segments.find((seg) => {
                    const id = seg.id || `${seg.absolute_start_time}-${seg.start_time}`;
                    return mostRecentUpdatedSegment.id === id;
                  });
                  
                  if (matchingSegment) {
                    // For grouped segments, we need to find where this appended text appears in the combined text
                    // Check if the appended text appears at the end (if it's from the last segment in the group)
                    const isLastSegmentInGroup = 
                      group.segments[group.segments.length - 1]?.id === matchingSegment.id ||
                      (group.segments[group.segments.length - 1]?.absolute_start_time === matchingSegment.absolute_start_time &&
                       group.segments[group.segments.length - 1]?.start_time === matchingSegment.start_time);
                    
                    if (isLastSegmentInGroup && group.combinedText.endsWith(mostRecentUpdatedSegment.appendedText)) {
                      // The appended text is at the end of the combined text
                      textToHighlight = mostRecentUpdatedSegment.appendedText;
                    } else {
                      // Try to find the appended text in the combined text more carefully
                      // Only highlight if we can find it at the end of the matching segment's text within the combined text
                      const segmentIndex = group.segments.indexOf(matchingSegment);
                      if (segmentIndex >= 0) {
                        // Calculate where this segment's text ends in the combined text
                        let textBeforeThisSegment = "";
                        for (let i = 0; i < segmentIndex; i++) {
                          textBeforeThisSegment += (group.segments[i].text || "").trim() + " ";
                        }
                        const segmentStartInCombined = textBeforeThisSegment.length;
                        const segmentEndInCombined = segmentStartInCombined + (matchingSegment.text || "").trim().length;
                        
                        // Check if the appended text is at the end of this segment's portion in the combined text
                        const segmentTextInCombined = group.combinedText.slice(segmentStartInCombined, segmentEndInCombined);
                        if (segmentTextInCombined.endsWith(mostRecentUpdatedSegment.appendedText)) {
                          textToHighlight = mostRecentUpdatedSegment.appendedText;
                        }
                      }
                    }
                  }
                }

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
                      appendedText={textToHighlight}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {/* Bottom sentinel for reliable auto-follow scrolling */}
          <div ref={bottomRef} />
        </div>
      </CardContent>
    </Card>
  );
}
