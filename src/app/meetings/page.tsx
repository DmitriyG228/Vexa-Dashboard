"use client";

import { useEffect, useState, useMemo } from "react";
import { Plus, Search, Filter, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MeetingList } from "@/components/meetings/meeting-list";
import { ErrorState } from "@/components/ui/error-state";
import { useMeetingsStore } from "@/stores/meetings-store";
import { useJoinModalStore } from "@/stores/join-modal-store";
import type { Platform, MeetingStatus } from "@/types/vexa";

export default function MeetingsPage() {
  const { meetings, isLoadingMeetings, fetchMeetings, error } = useMeetingsStore();
  const openJoinModal = useJoinModalStore((state) => state.openModal);

  const [searchQuery, setSearchQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const [statusFilter, setStatusFilter] = useState<MeetingStatus | "all">("all");

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  // Filter meetings
  const filteredMeetings = useMemo(() => {
    return meetings.filter((meeting) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesId = meeting.platform_specific_id.toLowerCase().includes(query);
        const matchesName = meeting.data?.name?.toLowerCase().includes(query);
        const matchesTitle = meeting.data?.title?.toLowerCase().includes(query);
        const matchesParticipants = meeting.data?.participants?.some(
          (p) => p.toLowerCase().includes(query)
        );
        if (!matchesId && !matchesName && !matchesTitle && !matchesParticipants) {
          return false;
        }
      }

      // Platform filter
      if (platformFilter !== "all" && meeting.platform !== platformFilter) {
        return false;
      }

      // Status filter
      if (statusFilter !== "all" && meeting.status !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [meetings, searchQuery, platformFilter, statusFilter]);

  const handleRefresh = () => {
    fetchMeetings();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Meetings</h1>
          <p className="text-muted-foreground">
            Browse and search your meeting transcriptions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={handleRefresh} disabled={isLoadingMeetings}>
            <RefreshCw className={`h-4 w-4 ${isLoadingMeetings ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={openJoinModal}>
            <Plus className="mr-2 h-4 w-4" />
            Join Meeting
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search meetings..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Platform filter */}
            <Select value={platformFilter} onValueChange={(v) => setPlatformFilter(v as Platform | "all")}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                <SelectItem value="google_meet">Google Meet</SelectItem>
                <SelectItem value="teams">Microsoft Teams</SelectItem>
              </SelectContent>
            </Select>

            {/* Status filter */}
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as MeetingStatus | "all")}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="joining">Joining</SelectItem>
                <SelectItem value="awaiting_admission">Waiting</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Results count */}
          <div className="mt-4 text-sm text-muted-foreground">
            Showing {filteredMeetings.length} of {meetings.length} meetings
          </div>
        </CardContent>
      </Card>

      {/* Meetings List */}
      {error ? (
        <ErrorState error={error} onRetry={fetchMeetings} />
      ) : (
        <MeetingList
          meetings={filteredMeetings}
          isLoading={isLoadingMeetings}
          emptyMessage={
            searchQuery || platformFilter !== "all" || statusFilter !== "all"
              ? "No meetings match your filters"
              : "No meetings yet. Join your first meeting to get started!"
          }
        />
      )}
    </div>
  );
}
