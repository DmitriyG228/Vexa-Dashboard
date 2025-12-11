// Vexa API Types

export type Platform = "google_meet" | "teams";

export type MeetingStatus =
  | "requested"
  | "joining"
  | "awaiting_admission"
  | "active"
  | "completed"
  | "failed";

export interface Meeting {
  id: string;
  platform: Platform;
  platform_specific_id: string;
  status: MeetingStatus;
  start_time: string | null;
  end_time: string | null;
  bot_container_id: string | null;
  data: MeetingData;
  created_at: string;
  updated_at?: string;
}

// Status transition record from Vexa API
export interface StatusTransition {
  from: MeetingStatus | string;
  to: MeetingStatus | string;
  timestamp: string;
  source?: string;
  reason?: string;
  completion_reason?: string;
  container_id?: string;
  finalized_by?: string;
}

export interface MeetingData {
  name?: string;
  title?: string;
  notes?: string;
  participants?: string[];
  languages?: string[];
  // Bot status details (may be populated by Vexa API)
  error?: string;
  error_code?: string;
  status_message?: string;
  failure_reason?: string;
  // Completion details
  completion_reason?: string;
  // Status history
  status_transition?: StatusTransition[];
  [key: string]: unknown;
}

export interface TranscriptSegment {
  id: string;
  meeting_id: string;
  start_time: number;
  end_time: number;
  absolute_start_time: string;
  absolute_end_time: string;
  text: string;
  speaker: string;
  language: string;
  session_uid: string;
  created_at: string;
  updated_at?: string;
}

export interface CreateBotRequest {
  platform: Platform;
  native_meeting_id: string;
  passcode?: string;
  bot_name?: string;
  language?: string;
}

export interface BotConfigUpdate {
  language?: string;
  task?: "transcribe" | "translate";
  bot_name?: string;
}

// WebSocket Types
export type WebSocketMessageType =
  | "transcript.mutable"
  | "meeting.status"
  | "subscribed"
  | "pong"
  | "error";

export interface WebSocketSubscribeMessage {
  action: "subscribe";
  meetings: Array<{
    platform: Platform;
    native_id: string;
  }>;
}

export interface WebSocketPingMessage {
  action: "ping";
}

// Raw segment from WebSocket (different from stored TranscriptSegment)
export interface WebSocketSegment {
  text: string;
  speaker: string | null;
  language?: string;
  session_uid?: string;
  start?: number;
  end_time?: number;
  absolute_start_time: string;
  absolute_end_time: string;
  updated_at?: string;
}

export interface WebSocketTranscriptMessage {
  type: "transcript.mutable";
  meeting: { id: number };
  payload: {
    segments: WebSocketSegment[];
  };
  ts: string;
}

export interface WebSocketStatusMessage {
  type: "meeting.status";
  meeting: { platform: Platform; native_id: string };
  payload: {
    status: MeetingStatus;
  };
  ts: string;
}

export interface WebSocketSubscribedMessage {
  type: "subscribed";
  meetings: number[];  // Array of meeting IDs
}

export interface WebSocketPongMessage {
  type: "pong";
}

export interface WebSocketErrorMessage {
  type: "error";
  message: string;
}

export type WebSocketIncomingMessage =
  | WebSocketTranscriptMessage
  | WebSocketStatusMessage
  | WebSocketSubscribedMessage
  | WebSocketPongMessage
  | WebSocketErrorMessage;

// API Response Types
export interface MeetingsResponse {
  meetings: Meeting[];
}

export interface TranscriptsResponse {
  segments: TranscriptSegment[];
}

// UI Types
export interface SpeakerColor {
  bg: string;
  text: string;
  border: string;
  avatar: string;
}

export const SPEAKER_COLORS: SpeakerColor[] = [
  { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", avatar: "bg-blue-500" },
  { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", avatar: "bg-emerald-500" },
  { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", avatar: "bg-purple-500" },
  { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", avatar: "bg-amber-500" },
  { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", avatar: "bg-rose-500" },
  { bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200", avatar: "bg-cyan-500" },
  { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", avatar: "bg-indigo-500" },
  { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", avatar: "bg-teal-500" },
];

export function getSpeakerColor(speaker: string, speakerList: string[]): SpeakerColor {
  const index = speakerList.indexOf(speaker);
  if (index === -1) {
    return SPEAKER_COLORS[0];
  }
  return SPEAKER_COLORS[index % SPEAKER_COLORS.length];
}

// Platform display helpers
export const PLATFORM_CONFIG = {
  google_meet: {
    name: "Google Meet",
    color: "bg-green-500",
    textColor: "text-green-700",
    bgColor: "bg-green-50",
    icon: "video",
    pattern: /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/,
    placeholder: "abc-defg-hij",
  },
  teams: {
    name: "Microsoft Teams",
    color: "bg-blue-600",
    textColor: "text-blue-700",
    bgColor: "bg-blue-50",
    icon: "users",
    pattern: /^\d+$/,
    placeholder: "123456789",
  },
} as const;

export const MEETING_STATUS_CONFIG: Record<MeetingStatus, { label: string; color: string; bgColor: string }> = {
  requested: { label: "Requested", color: "text-gray-600", bgColor: "bg-gray-100" },
  joining: { label: "Joining", color: "text-yellow-600", bgColor: "bg-yellow-100" },
  awaiting_admission: { label: "Waiting", color: "text-orange-600", bgColor: "bg-orange-100" },
  active: { label: "Active", color: "text-green-600", bgColor: "bg-green-100" },
  completed: { label: "Completed", color: "text-blue-600", bgColor: "bg-blue-100" },
  failed: { label: "Failed", color: "text-red-600", bgColor: "bg-red-100" },
};

// Get detailed status info based on meeting data
export interface DetailedStatusInfo {
  label: string;
  color: string;
  bgColor: string;
  description?: string;
}

export function getDetailedStatus(status: MeetingStatus, data?: MeetingData): DetailedStatusInfo {
  const baseConfig = MEETING_STATUS_CONFIG[status];

  // For completed meetings, check completion reason
  if (status === "completed" && data?.completion_reason) {
    switch (data.completion_reason) {
      case "stopped":
        return {
          label: "Stopped",
          color: "text-red-600 dark:text-red-400",
          bgColor: "bg-red-100 dark:bg-red-950/50",
          description: "Manually stopped by user",
        };
      case "meeting_ended":
        return {
          label: "Ended",
          color: "text-emerald-600 dark:text-emerald-400",
          bgColor: "bg-emerald-100 dark:bg-emerald-950/50",
          description: "Meeting ended naturally",
        };
      case "kicked":
      case "removed":
        return {
          label: "Removed",
          color: "text-orange-600 dark:text-orange-400",
          bgColor: "bg-orange-100 dark:bg-orange-950/50",
          description: "Bot was removed from meeting",
        };
      default:
        return {
          ...baseConfig,
          color: "text-blue-600 dark:text-blue-400",
          bgColor: "bg-blue-100 dark:bg-blue-950/50",
          description: "Transcription completed"
        };
    }
  }

  // For failed meetings, add description based on error
  if (status === "failed") {
    let description = "Transcription failed";
    if (data?.error_code) {
      switch (data.error_code.toLowerCase()) {
        case "admission_timeout":
        case "not_admitted":
          description = "Bot was not admitted to meeting";
          break;
        case "meeting_ended":
          description = "Meeting ended before bot could join";
          break;
        case "connection_failed":
          description = "Failed to connect to meeting";
          break;
      }
    }
    return {
      label: "Failed",
      color: "text-red-600 dark:text-red-400",
      bgColor: "bg-red-100 dark:bg-red-950/50",
      description
    };
  }

  // For active meetings
  if (status === "active") {
    return {
      label: "Active",
      color: "text-green-600 dark:text-green-400",
      bgColor: "bg-green-100 dark:bg-green-950/50",
      description: "Recording in progress"
    };
  }

  // For joining states
  if (status === "joining") {
    return {
      label: "Joining",
      color: "text-yellow-600 dark:text-yellow-400",
      bgColor: "bg-yellow-100 dark:bg-yellow-950/50",
      description: "Connecting to meeting"
    };
  }

  if (status === "awaiting_admission") {
    return {
      label: "Waiting",
      color: "text-amber-600 dark:text-amber-400",
      bgColor: "bg-amber-100 dark:bg-amber-950/50",
      description: "Waiting in lobby"
    };
  }

  if (status === "requested") {
    return {
      label: "Requested",
      color: "text-gray-600 dark:text-gray-400",
      bgColor: "bg-gray-100 dark:bg-gray-800/50",
      description: "Starting bot"
    };
  }

  return baseConfig;
}

// Languages supported by Whisper
export const SUPPORTED_LANGUAGES = [
  { code: "auto", name: "Auto-detect" },
  { code: "en", name: "English" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "ru", name: "Russian" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "tr", name: "Turkish" },
  { code: "vi", name: "Vietnamese" },
  { code: "th", name: "Thai" },
  { code: "sv", name: "Swedish" },
  { code: "da", name: "Danish" },
  { code: "fi", name: "Finnish" },
  { code: "no", name: "Norwegian" },
] as const;

// ==========================================
// Admin API Types
// ==========================================

export interface VexaUser {
  id: string;
  email: string;
  name: string;
  image_url?: string;
  max_concurrent_bots: number;
  data?: Record<string, unknown>;
  created_at: string;
}

export interface VexaUserWithTokens extends VexaUser {
  api_tokens: APIToken[];
}

export interface APIToken {
  id: string;
  token: string; // Only visible once at creation
  user_id: string;
  created_at: string;
}

export interface CreateUserRequest {
  email: string;
  name?: string;
  max_concurrent_bots?: number;
}

export interface UpdateUserRequest {
  name?: string;
  max_concurrent_bots?: number;
  image_url?: string;
  data?: Record<string, unknown>;
}

export interface UsersListResponse {
  users: VexaUser[];
  total: number;
  skip: number;
  limit: number;
}

export interface CreateTokenResponse {
  id: string;
  token: string; // Save immediately - cannot be retrieved later!
  user_id: string;
  created_at: string;
}
