"use client";

import Link from "next/link";
import { formatDistanceToNow, format } from "date-fns";
import { Clock, ChevronRight, Calendar, MessageSquare } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Meeting } from "@/types/vexa";
import { MEETING_STATUS_CONFIG } from "@/types/vexa";
import { cn } from "@/lib/utils";

interface MeetingCardProps {
  meeting: Meeting;
}

// Platform icons as SVG components
function GoogleMeetIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="6" fill="#00AC47" />
      {/* Video camera body */}
      <rect x="5" y="8" width="10" height="8" rx="1.5" fill="white" />
      {/* Camera lens/play button */}
      <path d="M16 10l3-2v8l-3-2v-4z" fill="white" />
    </svg>
  );
}

function TeamsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="6" fill="#5059C9" />
      {/* T letter for Teams */}
      <path
        d="M8 7h8v2.5h-2.75v7.5h-2.5V9.5H8V7z"
        fill="white"
      />
    </svg>
  );
}

export function MeetingCard({ meeting }: MeetingCardProps) {
  const statusConfig = MEETING_STATUS_CONFIG[meeting.status];
  // Platform detection - check if it's Google Meet (not Teams)
  const isGoogleMeet = meeting.platform !== "teams";
  // Display title from API data (name or title field)
  const displayTitle = meeting.data?.name || meeting.data?.title;
  const isActive = meeting.status === "active";

  const duration = meeting.start_time && meeting.end_time
    ? Math.round(
        (new Date(meeting.end_time).getTime() - new Date(meeting.start_time).getTime()) / 60000
      )
    : null;

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  return (
    <Link href={`/meetings/${meeting.id}`} className="block group">
      <Card className={cn(
        "relative overflow-hidden transition-all duration-300 ease-out",
        "border-0 shadow-sm hover:shadow-lg",
        "bg-gradient-to-br from-card to-card/80",
        "hover:scale-[1.01] hover:-translate-y-0.5",
        isActive && "ring-2 ring-green-500/30 shadow-green-500/10"
      )}>
        {/* Platform color accent */}
        <div className={cn(
          "absolute top-0 left-0 w-1 h-full transition-all duration-300",
          isGoogleMeet ? "bg-green-500" : "bg-[#5059C9]",
          "group-hover:w-1.5"
        )} />

        {/* Active meeting glow effect */}
        {isActive && (
          <div className="absolute inset-0 bg-gradient-to-r from-green-500/5 to-transparent pointer-events-none" />
        )}

        <div className="p-5 pl-6">
          <div className="flex items-start gap-4">
            {/* Platform Icon */}
            <div className={cn(
              "flex-shrink-0 relative",
              "transition-transform duration-300 group-hover:scale-110"
            )}>
              {isGoogleMeet ? (
                <GoogleMeetIcon className="h-12 w-12 rounded-xl shadow-md" />
              ) : (
                <TeamsIcon className="h-12 w-12 rounded-xl shadow-md" />
              )}
              {/* Active indicator */}
              {isActive && (
                <div className="absolute -top-1 -right-1">
                  <span className="relative flex h-3.5 w-3.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-green-500 border-2 border-white dark:border-gray-900" />
                  </span>
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 space-y-2">
              {/* Header row */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className={cn(
                    "font-semibold text-base truncate",
                    "transition-colors duration-200",
                    "group-hover:text-primary"
                  )}>
                    {displayTitle || `Meeting ${meeting.platform_specific_id}`}
                  </h3>
                  {meeting.data?.participants && meeting.data.participants.length > 0 ? (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      With {meeting.data.participants.slice(0, 3).join(", ")}
                      {meeting.data.participants.length > 3 && ` +${meeting.data.participants.length - 3}`}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">
                      {meeting.platform_specific_id}
                    </p>
                  )}
                </div>

                {/* Status badge */}
                <Badge
                  variant="secondary"
                  className={cn(
                    "flex-shrink-0 text-xs font-medium px-2.5 py-1",
                    statusConfig.bgColor,
                    statusConfig.color,
                    isActive && "animate-pulse"
                  )}
                >
                  {statusConfig.label}
                </Badge>
              </div>

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {meeting.start_time && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>{format(new Date(meeting.start_time), "MMM d, yyyy")}</span>
                  </div>
                )}

                {meeting.start_time && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{formatDistanceToNow(new Date(meeting.start_time), { addSuffix: true })}</span>
                  </div>
                )}

                {duration && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted/50">
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">{formatDuration(duration)}</span>
                  </div>
                )}
              </div>

            </div>

            {/* Arrow */}
            <div className={cn(
              "flex-shrink-0 self-center",
              "p-2 rounded-full",
              "transition-all duration-300",
              "group-hover:bg-primary/10",
              "group-hover:translate-x-1"
            )}>
              <ChevronRight className={cn(
                "h-5 w-5 text-muted-foreground",
                "transition-colors duration-200",
                "group-hover:text-primary"
              )} />
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
