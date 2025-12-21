import { create } from "zustand";
import type { Meeting, TranscriptSegment, Platform, MeetingStatus } from "@/types/vexa";
import { vexaAPI } from "@/lib/api";

interface MeetingDataUpdate {
  name?: string;
  notes?: string;
  participants?: string[];
  languages?: string[];
}

interface MeetingsState {
  // Data
  meetings: Meeting[];
  currentMeeting: Meeting | null;
  transcripts: TranscriptSegment[];

  // Loading states
  isLoadingMeetings: boolean;
  isLoadingMeeting: boolean;
  isLoadingTranscripts: boolean;
  isUpdatingMeeting: boolean;

  // Error states
  error: string | null;

  // Actions
  fetchMeetings: () => Promise<void>;
  fetchMeeting: (id: string, options?: { silent?: boolean }) => Promise<void>;
  refreshMeeting: (id: string) => Promise<void>;
  fetchTranscripts: (platform: Platform, nativeId: string) => Promise<void>;
  updateMeetingData: (platform: Platform, nativeId: string, data: MeetingDataUpdate) => Promise<void>;
  setCurrentMeeting: (meeting: Meeting | null) => void;
  clearCurrentMeeting: () => void;

  // Real-time updates
  bootstrapTranscripts: (segments: TranscriptSegment[]) => void;
  upsertTranscriptSegments: (segments: TranscriptSegment[]) => void;
  addTranscriptSegment: (segment: TranscriptSegment) => void;
  updateTranscriptSegment: (segment: TranscriptSegment) => void;
  updateMeetingStatus: (meetingId: string, status: MeetingStatus) => void;

  // Utilities
  clearError: () => void;
}

export const useMeetingsStore = create<MeetingsState>((set, get) => ({
  // Initial state
  meetings: [],
  currentMeeting: null,
  transcripts: [],
  isLoadingMeetings: false,
  isLoadingMeeting: false,
  isLoadingTranscripts: false,
  isUpdatingMeeting: false,
  error: null,

  // Fetch all meetings
  fetchMeetings: async () => {
    set({ isLoadingMeetings: true, error: null });
    try {
      const meetings = await vexaAPI.getMeetings();
      // Sort by created_at descending (most recent first)
      meetings.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      set({ meetings, isLoadingMeetings: false });
    } catch (error) {
      set({
        error: (error as Error).message,
        isLoadingMeetings: false
      });
    }
  },

  // Fetch single meeting (from list since API doesn't support /meetings/{id})
  // Use silent: true to avoid showing loading state (for polling/refresh)
  fetchMeeting: async (id: string, options?: { silent?: boolean }) => {
    const { silent = false } = options || {};

    // Only show loading state on initial load (when no currentMeeting exists)
    if (!silent) {
      set({ isLoadingMeeting: true, error: null });
    }

    try {
      // Always fetch fresh data from the API to ensure we have the latest meeting state
      const meetings = await vexaAPI.getMeetings();
      meetings.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      set({ meetings });

      const meeting = meetings.find((m) => m.id.toString() === id);

      if (meeting) {
        set({ currentMeeting: meeting, isLoadingMeeting: false });
      } else {
        set({
          error: `Meeting with ID ${id} not found`,
          isLoadingMeeting: false
        });
      }
    } catch (error) {
      set({
        error: (error as Error).message,
        isLoadingMeeting: false
      });
    }
  },

  // Silently refresh meeting data (for polling without UI flicker)
  refreshMeeting: async (id: string) => {
    try {
      const meetings = await vexaAPI.getMeetings();
      meetings.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      const meeting = meetings.find((m) => m.id.toString() === id);

      if (meeting) {
        // Only update if something changed
        const { currentMeeting } = get();
        if (currentMeeting?.status !== meeting.status ||
            currentMeeting?.updated_at !== meeting.updated_at) {
          set({ meetings, currentMeeting: meeting });
        } else {
          set({ meetings });
        }
      }
    } catch (error) {
      // Silent refresh - don't show errors for polling failures
      console.error("Failed to refresh meeting:", error);
    }
  },

  // Fetch transcripts for a meeting
  fetchTranscripts: async (platform: Platform, nativeId: string) => {
    set({ isLoadingTranscripts: true, error: null });
    try {
      const transcripts = await vexaAPI.getTranscripts(platform, nativeId);
      // Sort by start_time
      transcripts.sort((a, b) => a.start_time - b.start_time);
      set({ transcripts, isLoadingTranscripts: false });
    } catch (error) {
      set({
        error: (error as Error).message,
        isLoadingTranscripts: false
      });
    }
  },

  // Update meeting data (title, notes, etc.)
  updateMeetingData: async (platform: Platform, nativeId: string, data: MeetingDataUpdate) => {
    set({ isUpdatingMeeting: true });
    try {
      const updatedMeeting = await vexaAPI.updateMeetingData(platform, nativeId, data);

      // Update current meeting if it matches
      const { currentMeeting, meetings } = get();
      if (currentMeeting?.platform_specific_id === nativeId) {
        set({ currentMeeting: updatedMeeting });
      }

      // Update in meetings list
      const updatedMeetings = meetings.map((m) =>
        m.platform_specific_id === nativeId ? updatedMeeting : m
      );
      set({ meetings: updatedMeetings, isUpdatingMeeting: false });
    } catch (error) {
      set({ isUpdatingMeeting: false });
      throw error; // Re-throw so UI can handle it
    }
  },

  setCurrentMeeting: (meeting: Meeting | null) => {
    set({ currentMeeting: meeting });
  },

  clearCurrentMeeting: () => {
    set({ currentMeeting: null, transcripts: [] });
  },

  // Bootstrap transcripts from REST API (Step 1 of algorithm)
  // Seeds the in-memory map keyed by absolute_start_time
  bootstrapTranscripts: (segments: TranscriptSegment[]) => {
    // Filter out segments without absolute_start_time or empty text
    const validSegments = segments.filter(
      (seg) => seg.absolute_start_time && seg.text?.trim()
    );

    // Create a map keyed by absolute_start_time (deduplication key)
    const transcriptMap = new Map<string, TranscriptSegment>();
    for (const segment of validSegments) {
      transcriptMap.set(segment.absolute_start_time, segment);
    }

    // Convert map to array and sort by absolute_start_time
    const sortedTranscripts = Array.from(transcriptMap.values()).sort(
      (a, b) => a.absolute_start_time.localeCompare(b.absolute_start_time)
    );

    set({ transcripts: sortedTranscripts });
  },

  // Upsert segments from WebSocket (Step 2 of algorithm)
  // Implements deduplication by absolute_start_time with updated_at comparison
  upsertTranscriptSegments: (segments: TranscriptSegment[]) => {
    const { transcripts } = get();

    if (!segments || segments.length === 0) return;

    // Convert current transcripts to a map keyed by absolute_start_time
    const transcriptMap = new Map<string, TranscriptSegment>();
    for (const seg of transcripts) {
      if (seg.absolute_start_time) {
        transcriptMap.set(seg.absolute_start_time, seg);
      }
    }

    // Upsert new segments with deduplication logic
    let hasUpdates = false;
    for (const segment of segments) {
      const absStart = segment.absolute_start_time;
      if (!absStart || !segment.text?.trim()) continue;

      const existing = transcriptMap.get(absStart);

      // Deduplication: keep segment with newer updated_at timestamp
      if (existing && existing.updated_at && segment.updated_at) {
        // If existing is newer, skip this segment
        if (existing.updated_at >= segment.updated_at) {
          continue;
        }
      }

      // Update the map with new/updated segment
      transcriptMap.set(absStart, segment);
      hasUpdates = true;
    }

    // Always update store to ensure React detects changes (even if no new segments, content may have updated)
    // Convert map to array and sort by absolute_start_time
    const sortedTranscripts = Array.from(transcriptMap.values()).sort(
      (a, b) => a.absolute_start_time.localeCompare(b.absolute_start_time)
    );
    
    // Update store immediately - Zustand's set() is synchronous, ensuring immediate UI updates
    // Always set to ensure React detects changes (new array reference)
    set({ transcripts: sortedTranscripts });
  },

  // Real-time: Add new transcript segment (legacy method, kept for compatibility)
  addTranscriptSegment: (segment: TranscriptSegment) => {
    get().upsertTranscriptSegments([segment]);
  },

  // Real-time: Update existing transcript segment
  updateTranscriptSegment: (segment: TranscriptSegment) => {
    const { transcripts } = get();
    const updated = transcripts.map((t) =>
      t.absolute_start_time === segment.absolute_start_time ? segment : t
    );
    set({ transcripts: updated });
  },

  // Update meeting status from WebSocket
  updateMeetingStatus: (meetingId: string, status: MeetingStatus) => {
    const { meetings, currentMeeting } = get();

    // Update in meetings list
    const updatedMeetings = meetings.map((m) =>
      m.id === meetingId ? { ...m, status } : m
    );
    set({ meetings: updatedMeetings });

    // Update current meeting if it matches
    if (currentMeeting?.id === meetingId) {
      set({ currentMeeting: { ...currentMeeting, status } });
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));
