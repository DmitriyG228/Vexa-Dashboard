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
  
  // Smart scroll state management
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastScrollTopRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const hasScrolledOnceRef = useRef(false);

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

    // Split long combinedText into chunks for readability (max 512 chars)
    const MAX_CHARS = 512;
    const splitGroups: GroupedSegment[] = [];
    for (const g of groups) {
      const chunks = splitTextIntoSentenceChunks(g.combinedText, MAX_CHARS);
      if (chunks.length <= 1) {
        splitGroups.push(g);
      } else {
        for (const chunk of chunks) {
          splitGroups.push({
            ...g,
            combinedText: chunk,
          });
        }
      }
    }

    return splitGroups;
  }, [splitTextIntoSentenceChunks]);

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

  // Get the scroll container - use direct ref (like example client)
  const getScrollContainer = useCallback(() => {
    return scrollRef.current;
  }, []);

  // Check if scroll is near bottom (within threshold)
  const checkIfNearBottom = useCallback(() => {
    const scrollContainer = getScrollContainer();
    if (!scrollContainer) return false;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    const threshold = 100; // pixels from bottom
    return scrollHeight - scrollTop - clientHeight < threshold;
  }, [getScrollContainer]);

  // Handle scroll events to detect user scrolling
  const handleScroll = useCallback(() => {
    const scrollContainer = getScrollContainer();
    if (!scrollContainer) return;

    const currentScrollTop = scrollContainer.scrollTop;
    const isScrollingUp = currentScrollTop < lastScrollTopRef.current;
    const isNearBottom = checkIfNearBottom();

    // Update refs
    lastScrollTopRef.current = currentScrollTop;
    isNearBottomRef.current = isNearBottom;

    // Clear existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }

    // Mark that user has scrolled manually
    hasScrolledOnceRef.current = true;
    
    // If user is scrolling up or not near bottom, mark as user scrolling
    if (isScrollingUp || !isNearBottom) {
      setIsUserScrolling(true);

      // Set timeout to reset user scrolling after 5 seconds of inactivity (only if near bottom)
      scrollTimeoutRef.current = setTimeout(() => {
        // Check again if near bottom before resetting
        if (checkIfNearBottom()) {
          setIsUserScrolling(false);
        }
        scrollTimeoutRef.current = null;
      }, 5000);
    } else {
      // User scrolled back to bottom - reset immediately
      setIsUserScrolling(false);
    }
  }, [getScrollContainer, checkIfNearBottom]);

  // Scroll to bottom (only if not user scrolling)
  const scrollToBottom = useCallback(() => {
    if (isUserScrolling) return;
    
    const scrollContainer = getScrollContainer();
    if (!scrollContainer) return;
    
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    
    // Update ref to reflect we're at bottom
    lastScrollTopRef.current = scrollContainer.scrollTop;
    isNearBottomRef.current = true;
  }, [getScrollContainer, isUserScrolling]);


  // Add scroll event listener (with retry to ensure viewport is available)
  useEffect(() => {
    let scrollContainer: HTMLElement | null = null;
    let retryTimeout: NodeJS.Timeout | null = null;

    const setupScrollListener = () => {
      scrollContainer = getScrollContainer();
      if (!scrollContainer) {
        // Retry after a short delay if viewport not found (max 10 retries)
        let retries = 0;
        const maxRetries = 10;
        retryTimeout = setTimeout(() => {
          retries++;
          if (retries < maxRetries) {
            setupScrollListener();
          }
        }, 100);
        return;
      }

      scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    };

    setupScrollListener();

    return () => {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", handleScroll);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, [getScrollContainer, handleScroll]);

  // Auto-scroll to bottom when live and new segments/groups arrive (only if not user scrolling)
  // Trigger immediately when segments change
  useEffect(() => {
    if (!isLive) return; // Only scroll when meeting is active
    
    // Scroll when segments change
    if (groupedSegments.length > 0) {
      const container = scrollRef.current;
      if (!container) return;
      
      // Always scroll on first load or if user hasn't scrolled manually
      // Only respect isUserScrolling after user has interacted
      const shouldScroll = !hasScrolledOnceRef.current || !isUserScrolling;
      
      if (shouldScroll) {
        // Use multiple requestAnimationFrame calls to ensure DOM is fully updated and painted
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // Check if content is scrollable
            const canScroll = container.scrollHeight > container.clientHeight;
            if (!canScroll) return; // Nothing to scroll yet
            
            // Scroll to bottom
            container.scrollTop = container.scrollHeight;
            lastScrollTopRef.current = container.scrollTop;
            isNearBottomRef.current = true;
          });
        });
      }
    }
  }, [segments.length, groupedSegments.length, isLive, isUserScrolling]); // Depend on segments.length to trigger on any change

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
      <CardHeader className="flex-shrink-0 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CardTitle>Transcript</CardTitle>
            {isLive && (
              <Badge variant="destructive" className="animate-pulse">
                <span className="relative flex h-2 w-2 mr-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                </span>
                Live
              </Badge>
            )}
          </div>

          {/* Export */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
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

        {/* Search and Filter Bar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search transcript... (Cmd+F)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                "pl-9 pr-9 transition-all",
                searchQuery && "ring-2 ring-primary/20"
              )}
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-4 w-4" />
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
                    "gap-2",
                    selectedSpeakers.length > 0 && "border-primary text-primary"
                  )}
                >
                  <Users className="h-4 w-4" />
                  Speakers
                  {selectedSpeakers.length > 0 && (
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5">
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

      <CardContent className="flex-1 min-h-0">
        <div 
          ref={scrollRef}
          className="h-[500px] pr-4 overflow-y-auto"
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
