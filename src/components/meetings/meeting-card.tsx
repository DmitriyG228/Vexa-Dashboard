"use client";

import Link from "next/link";
import Image from "next/image";
import { formatDistanceToNow, format } from "date-fns";
import { Clock, ChevronRight, Calendar, MessageSquare } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Meeting } from "@/types/vexa";
import { getDetailedStatus } from "@/types/vexa";
import { cn, parseUTCTimestamp } from "@/lib/utils";

interface MeetingCardProps {
  meeting: Meeting;
}

// Platform icons using actual icon files from public folder
function GoogleMeetIcon({ className }: { className?: string }) {
  return (
    <Image
      src="/icons/icons8-google-meet-96.png"
      alt="Google Meet"
      width={40}
      height={40}
      className={className}
    />
  );
}

function TeamsIcon({ className }: { className?: string }) {
  return (
    <Image
      src="/icons/icons8-teams-96.png"
      alt="Microsoft Teams"
      width={40}
      height={40}
      className={className}
    />
  );
}

export function MeetingCard({ meeting }: MeetingCardProps) {
  const statusConfig = getDetailedStatus(meeting.status, meeting.data);
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

  // Build detailed status info for tooltip
  const getStatusTooltipContent = () => {
    const lines: string[] = [];
    
    // Status description
    if (statusConfig.description) {
      lines.push(statusConfig.description);
    }
    
    // Completion reason details
    if (meeting.data?.completion_reason) {
      const reason = meeting.data.completion_reason;
      if (reason !== "stopped" && reason !== "meeting_ended") {
        const formattedReason = reason
          .split("_")
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
        lines.push(`Reason: ${formattedReason}`);
      }
    }
    
    // Status transitions summary
    if (meeting.data?.status_transition && meeting.data.status_transition.length > 0) {
      const transitions = meeting.data.status_transition;
      const lastTransition = transitions[transitions.length - 1];
      
      if (lastTransition.timestamp) {
        try {
          const timestamp = parseUTCTimestamp(lastTransition.timestamp);
          lines.push(`Last updated: ${formatDistanceToNow(timestamp, { addSuffix: true })}`);
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Show transition count if more than 1
      if (transitions.length > 1) {
        lines.push(`${transitions.length} status changes`);
      }
    }
    
    // Start/end times if available
    if (meeting.start_time) {
      try {
        const startTime = parseUTCTimestamp(meeting.start_time);
        lines.push(`Started: ${format(startTime, "MMM d, HH:mm")}`);
      } catch (e) {
        // Ignore parsing errors
      }
    }
    
    if (meeting.end_time) {
      try {
        const endTime = parseUTCTimestamp(meeting.end_time);
        lines.push(`Ended: ${format(endTime, "MMM d, HH:mm")}`);
      } catch (e) {
        // Ignore parsing errors
      }
    }
    
    return lines;
  };

  const tooltipContent = getStatusTooltipContent();

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

        <div className="py-3 px-4">
          <div className="flex items-center gap-3">
            {/* Platform Icon */}
            <div className={cn(
              "flex-shrink-0 relative",
              "transition-transform duration-300 group-hover:scale-110"
            )}>
              {isGoogleMeet ? (
                <GoogleMeetIcon className="h-10 w-10 rounded-lg" />
              ) : (
                <TeamsIcon className="h-10 w-10 rounded-lg" />
              )}
              {/* Active indicator */}
              {isActive && (
                <div className="absolute -top-1 -right-1">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500 border-2 border-white dark:border-gray-900" />
                  </span>
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 space-y-1">
              {/* Header row */}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className={cn(
                    "font-semibold text-base truncate",
                    "transition-colors duration-200",
                    "group-hover:text-primary"
                  )}>
                    {displayTitle || `Meeting ${meeting.platform_specific_id}`}
                  </h3>
                  {meeting.data?.participants && meeting.data.participants.length > 0 ? (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      With {meeting.data.participants.slice(0, 3).join(", ")}
                      {meeting.data.participants.length > 3 && ` +${meeting.data.participants.length - 3}`}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
                      {meeting.platform_specific_id}
                    </p>
                  )}
                </div>

                {/* Status badge with tooltip */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "flex-shrink-0 text-xs font-medium px-2 py-0.5 cursor-help",
                          statusConfig.bgColor,
                          statusConfig.color,
                          isActive && "animate-pulse"
                        )}
                      >
                        {statusConfig.label}
                      </Badge>
                    </div>
                  </TooltipTrigger>
                  {tooltipContent.length > 0 && (
                    <TooltipContent side="top" className="max-w-xs">
                      <div className="space-y-1">
                        {tooltipContent.map((line, index) => (
                          <div key={index} className="text-xs">
                            {line}
                          </div>
                        ))}
                      </div>
                    </TooltipContent>
                  )}
                </Tooltip>
              </div>

              {/* Status description */}
              {statusConfig.description && (
                <div className="text-xs text-muted-foreground">
                  {statusConfig.description}
                </div>
              )}

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
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
              "p-1.5 rounded-full",
              "transition-all duration-300",
              "group-hover:bg-primary/10",
              "group-hover:translate-x-1"
            )}>
              <ChevronRight className={cn(
                "h-4 w-4 text-muted-foreground",
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
