"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  MessageSquare,
  Send,
  Loader2,
  Sparkles,
  Trash2,
  StopCircle,
  XCircle,
  X,
  Bot,
  User,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAIStore } from "@/stores/ai-store";
import { AISettingsDialog } from "./ai-settings-dialog";
import { cn } from "@/lib/utils";
import type { Meeting, TranscriptSegment } from "@/types/vexa";

interface AIChatPanelProps {
  meeting?: Meeting;
  transcripts?: TranscriptSegment[];
  trigger?: React.ReactNode;
}

function buildTranscriptContext(transcripts: TranscriptSegment[], meeting?: Meeting): string {
  if (!transcripts.length) {
    return "";
  }

  let context = "";

  if (meeting) {
    context += `Meeting: ${meeting.data?.title || meeting.platform_specific_id}\n`;
    context += `Platform: ${meeting.platform}\n`;
    if (meeting.data?.participants?.length) {
      context += `Participants: ${meeting.data.participants.join(", ")}\n`;
    }
    context += "\n---\n\n";
  }

  context += "TRANSCRIPT:\n\n";

  // Group by speaker for cleaner context
  let lastSpeaker = "";
  for (const segment of transcripts) {
    if (segment.speaker !== lastSpeaker) {
      context += `\n[${segment.speaker}]:\n`;
      lastSpeaker = segment.speaker;
    }
    context += `${segment.text} `;
  }

  return context.trim();
}

export function AIChatPanel({ meeting, transcripts = [], trigger }: AIChatPanelProps) {
  const { settings, isConfigured } = useAIStore();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Build context from transcripts
  const context = buildTranscriptContext(transcripts, meeting);

  // Memoize the transport to avoid recreation on every render
  const transport = useMemo(() => {
    return new DefaultChatTransport({
      api: "/api/ai/chat",
      body: {
        context,
        settings: {
          provider: settings.provider,
          apiKey: settings.apiKey,
          model: settings.model,
          customBaseUrl: settings.customBaseUrl,
          customModel: settings.customModel,
        },
      },
    });
  }, [context, settings]);

  const {
    messages,
    status,
    error,
    setMessages,
    sendMessage,
    stop,
    clearError,
  } = useChat({
    transport,
  });

  const isLoading = status === "streaming" || status === "submitted";

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [messages, status]);

  // Focus textarea when opened
  useEffect(() => {
    if (open && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open]);

  const handleClear = useCallback(() => {
    setMessages([]);
    clearError();
  }, [setMessages, clearError]);

  const doSendMessage = useCallback((text: string) => {
    if (text.trim() && !isLoading) {
      clearError();
      sendMessage({
        parts: [{ type: "text" as const, text: text.trim() }],
      });
    }
  }, [isLoading, sendMessage, clearError]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      doSendMessage(input);
      setInput("");
    },
    [input, doSendMessage]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doSendMessage(input);
        setInput("");
      }
    },
    [input, doSendMessage]
  );

  // Send suggested prompt immediately
  const handleSuggestedPrompt = useCallback((prompt: string) => {
    doSendMessage(prompt);
  }, [doSendMessage]);

  const suggestedPrompts = [
    "Summarize this meeting in key points",
    "What were the main decisions made?",
    "List all action items and who is responsible",
    "What topics were discussed?",
    "Are there any unresolved questions?",
    "What are the next steps?",
  ];

  // Get text content from message parts
  const getMessageContent = (message: typeof messages[0]): string => {
    const parts = message.parts;
    if (Array.isArray(parts)) {
      return parts
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map(part => part.text)
        .join("");
    }
    return "";
  };

  // Get user-friendly error message
  const getErrorMessage = (err: Error): string => {
    const msg = err.message.toLowerCase();
    if (msg.includes("invalid api key") || msg.includes("incorrect api key") || msg.includes("401")) {
      return "Invalid API key. Please check your API key in settings.";
    }
    if (msg.includes("rate limit") || msg.includes("429")) {
      return "Rate limit exceeded. Please wait a moment and try again.";
    }
    if (msg.includes("insufficient") || msg.includes("quota")) {
      return "API quota exceeded. Please check your account balance.";
    }
    if (msg.includes("network") || msg.includes("fetch")) {
      return "Network error. Please check your connection.";
    }
    return err.message;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" className="gap-2">
            <Sparkles className="h-4 w-4" />
            Ask AI
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl w-[95vw] h-[85vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold">AI Assistant</DialogTitle>
                {meeting && (
                  <p className="text-sm text-muted-foreground">
                    {meeting.data?.title || meeting.platform_specific_id}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                  className="gap-2 text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear
                </Button>
              )}
              <AISettingsDialog />
            </div>
          </div>
        </DialogHeader>

        {/* Error Banner */}
        {error && (
          <div className="mx-6 mt-4 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-destructive">Something went wrong</p>
                <p className="text-sm text-destructive/80 mt-1">{getErrorMessage(error)}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={clearError}
                className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Messages Area */}
        <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
          <div className="p-6">
            {!isConfigured ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-16">
                <div className="h-20 w-20 rounded-2xl bg-muted flex items-center justify-center mb-6">
                  <Sparkles className="h-10 w-10 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Configure AI Provider</h3>
                <p className="text-muted-foreground mb-6 max-w-md">
                  Add your API key to start analyzing your meeting transcripts with AI
                </p>
                <AISettingsDialog />
              </div>
            ) : messages.length === 0 && !error ? (
              <div className="flex flex-col items-center justify-center text-center py-8">
                <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-600/10 flex items-center justify-center mb-6">
                  <MessageSquare className="h-10 w-10 text-violet-500" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Ask anything about your meeting</h3>
                <p className="text-muted-foreground mb-8 max-w-md">
                  {transcripts.length > 0
                    ? `${transcripts.length} transcript segments loaded and ready to analyze`
                    : "No transcript loaded. Start a meeting to get AI insights."}
                </p>
                {transcripts.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
                    {suggestedPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => handleSuggestedPrompt(prompt)}
                        disabled={isLoading}
                        className="text-left text-sm px-4 py-3 rounded-xl border bg-card hover:bg-accent hover:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="text-muted-foreground mr-2">→</span>
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-6 max-w-3xl mx-auto">
                {messages.map((message) => (
                  <div key={message.id} className="flex gap-4">
                    {/* Avatar */}
                    <div className={cn(
                      "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-gradient-to-br from-violet-500 to-purple-600 text-white"
                    )}>
                      {message.role === "user" ? (
                        <User className="h-5 w-5" />
                      ) : (
                        <Bot className="h-5 w-5" />
                      )}
                    </div>

                    {/* Message Content */}
                    <div className="flex-1 min-w-0 pt-1">
                      <p className="text-sm font-medium mb-2 text-muted-foreground">
                        {message.role === "user" ? "You" : "AI Assistant"}
                      </p>
                      {message.role === "user" ? (
                        <p className="text-foreground whitespace-pre-wrap">
                          {getMessageContent(message)}
                        </p>
                      ) : (
                        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-muted prose-pre:border prose-code:text-violet-600 dark:prose-code:text-violet-400 prose-headings:font-semibold prose-ul:my-2 prose-li:my-0">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {getMessageContent(message)}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Loading indicator */}
                {isLoading && (
                  <div className="flex gap-4">
                    <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shrink-0">
                      <Bot className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex-1 pt-1">
                      <p className="text-sm font-medium mb-2 text-muted-foreground">AI Assistant</p>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input Area */}
        {isConfigured && (
          <div className="px-6 py-4 border-t bg-muted/30 shrink-0">
            <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
              <div className="flex gap-3">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask a question about your meeting..."
                  className="min-h-[52px] max-h-40 resize-none bg-background"
                  rows={1}
                  disabled={isLoading}
                />
                {isLoading ? (
                  <Button
                    type="button"
                    size="lg"
                    variant="destructive"
                    onClick={stop}
                    className="shrink-0 px-4"
                  >
                    <StopCircle className="h-5 w-5" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="lg"
                    disabled={!input.trim()}
                    className="shrink-0 px-4 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
                  >
                    <Send className="h-5 w-5" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Press Enter to send, Shift+Enter for new line
              </p>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
