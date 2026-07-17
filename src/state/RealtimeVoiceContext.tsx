import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { core, instances, type RealtimeAvailability, type TelemetryEvent } from "../api";
import { useTelemetryEvents } from "../hooks/useTelemetryBus";
import { RealtimeAudioClient, realtimeAudioURL, type RealtimeAudioState } from "../realtime/audio";

export type VoiceSessionState = "connecting" | "listening" | "speaking" | "reconnecting" | "ending" | "error";

export interface VoiceTranscriptLine {
  id: string;
  role: "user" | "agent";
  text: string;
  time: string;
}

export interface VoiceSession {
  agentId: number;
  agentName: string;
  threadId: string;
  startedAt: string;
  state: VoiceSessionState;
  muted: boolean;
  transcripts: VoiceTranscriptLine[];
  activeToolReason?: string;
  error?: string;
}

interface StartVoiceInput {
  agentId: number;
  agentName: string;
  availability: RealtimeAvailability;
}

interface RealtimeVoiceValue {
  session: VoiceSession | null;
  lastSession: VoiceSession | null;
  start: (input: StartVoiceInput) => Promise<void>;
  end: () => Promise<void>;
  toggleMute: () => void;
}

const RealtimeVoiceContext = createContext<RealtimeVoiceValue | null>(null);
const RECONNECT_DELAYS = [500, 1_000, 2_000, 4_000, 8_000];

function newThreadID(): string {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `dashboard-voice-${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function RealtimeVoiceProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [lastSession, setLastSession] = useState<VoiceSession | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);
  const clientRef = useRef<RealtimeAudioClient | null>(null);
  const closingRef = useRef(false);
  const reconnectingRef = useRef(false);
  const seenTranscriptRef = useRef(new Set<string>());

  useEffect(() => { sessionRef.current = session; }, [session]);

  const patchSession = useCallback((patch: Partial<VoiceSession>) => {
    setSession((current) => current ? { ...current, ...patch } : current);
  }, []);

  const reconnect = useCallback(async () => {
    if (closingRef.current || reconnectingRef.current) return;
    const current = sessionRef.current;
    const client = clientRef.current;
    if (!current || !client) return;
    reconnectingRef.current = true;
    patchSession({ state: "reconnecting", error: undefined });
    let lastError: unknown;
    for (let attempt = 0; attempt < RECONNECT_DELAYS.length; attempt += 1) {
      if (closingRef.current || sessionRef.current?.threadId !== current.threadId) break;
      if (attempt > 0) await wait(RECONNECT_DELAYS[attempt]);
      try {
        const response = await core.renewRealtimeAudioToken(current.agentId, current.threadId);
        await client.connect(realtimeAudioURL(current.agentId, current.threadId, response.audio_token));
        patchSession({ state: "listening", error: undefined });
        reconnectingRef.current = false;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    reconnectingRef.current = false;
    patchSession({
      state: "error",
      error: lastError instanceof Error ? lastError.message : "Voice connection was lost.",
    });
  }, [patchSession]);

  const start = useCallback(async ({ agentId, agentName, availability }: StartVoiceInput) => {
    if (!availability.enabled || !availability.available) {
      throw new Error("Realtime voice is not available for this agent.");
    }
    if (sessionRef.current) throw new Error("End the current voice session before starting another one.");
    closingRef.current = false;
    reconnectingRef.current = false;
    seenTranscriptRef.current.clear();
    const threadId = newThreadID();
    const client = new RealtimeAudioClient({
      onState: (state: RealtimeAudioState) => {
        if (clientRef.current !== client) return;
        if (state === "listening") patchSession({ state: "listening", error: undefined });
        if (state === "speaking") patchSession({ state: "speaking", error: undefined });
      },
      onClose: () => {
        if (clientRef.current === client && !closingRef.current) void reconnect();
      },
      onError: (message) => {
        if (clientRef.current === client) patchSession({ error: message });
      },
    });
    clientRef.current = client;
    const initial: VoiceSession = {
      agentId,
      agentName,
      threadId,
      startedAt: new Date().toISOString(),
      state: "connecting",
      muted: false,
      transcripts: [],
    };
    setSession(initial);
    sessionRef.current = initial;
    try {
      // Ask for microphone permission before allocating a provider session so
      // a declined permission never leaves a silent realtime worker behind.
      await client.prepare();
      const response = await core.spawnRealtimeThread(agentId, threadId, {
        voice: availability.voice,
        provider: availability.provider,
        mcp: availability.mcp,
      });
      if (!response.audio_token) throw new Error("Core did not return an audio token.");
      await client.connect(realtimeAudioURL(agentId, threadId, response.audio_token));
      patchSession({ state: "listening" });
    } catch (error) {
      closingRef.current = true;
      client.close();
      clientRef.current = null;
      setSession(null);
      sessionRef.current = null;
      // The thread may have been created before the WebSocket failed.
      void core.killThread(agentId, threadId).catch(() => {});
      throw error;
    }
  }, [patchSession, reconnect]);

  const end = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || closingRef.current) return;
    closingRef.current = true;
    patchSession({ state: "ending", activeToolReason: undefined });
    // Give the realtime worker a deterministic handoff request. It has a few
    // seconds to send a concise summary to main before normal thread cleanup.
    void instances.sendEvent(
      current.agentId,
      "[dashboard voice session ending] Send main one concise handoff with decisions, completed actions, and pending work. Then call done now.",
      current.threadId,
    ).catch(() => {});
    clientRef.current?.close();
    clientRef.current = null;
    setLastSession({ ...current, state: "ending", activeToolReason: undefined });
    setSession(null);
    sessionRef.current = null;
    await wait(4_000);
    await core.killThread(current.agentId, current.threadId).catch(() => {});
    closingRef.current = false;
  }, [patchSession]);

  const toggleMute = useCallback(() => {
    const current = sessionRef.current;
    const client = clientRef.current;
    if (!current || !client) return;
    const muted = !current.muted;
    client.setMuted(muted);
    patchSession({ muted });
  }, [patchSession]);

  useTelemetryEvents(session?.agentId, (event: TelemetryEvent) => {
    const current = sessionRef.current;
    if (!current || event.thread_id !== current.threadId) return;
    if (event.type === "realtime.user" || event.type === "realtime.assistant") {
      const text = String(event.data?.text || "").trim();
      if (!text) return;
      const key = `${event.type}|${event.time || ""}|${text}`;
      if (seenTranscriptRef.current.has(key)) return;
      seenTranscriptRef.current.add(key);
      const line: VoiceTranscriptLine = {
        id: event.id || key,
        role: event.type === "realtime.user" ? "user" : "agent",
        text,
        time: event.time || new Date().toISOString(),
      };
      setSession((value) => value && value.threadId === current.threadId
        ? { ...value, transcripts: [...value.transcripts, line].slice(-100) }
        : value);
      return;
    }
    if (event.type === "tool.call") {
      patchSession({ activeToolReason: String(event.data?.reason || "Using a capability…") });
    } else if (event.type === "tool.result") {
      patchSession({ activeToolReason: undefined });
    } else if (event.type === "realtime.error") {
      patchSession({ state: "error", error: String(event.data?.error || "Realtime provider error") });
    }
  });

  useEffect(() => () => {
    closingRef.current = true;
    clientRef.current?.close();
  }, []);

  const value = useMemo<RealtimeVoiceValue>(() => ({
    session, lastSession, start, end, toggleMute,
  }), [session, lastSession, start, end, toggleMute]);

  return <RealtimeVoiceContext.Provider value={value}>{children}</RealtimeVoiceContext.Provider>;
}

export function useRealtimeVoice(): RealtimeVoiceValue {
  const value = useContext(RealtimeVoiceContext);
  if (!value) throw new Error("useRealtimeVoice must be used inside RealtimeVoiceProvider");
  return value;
}

export function RealtimeVoiceDock() {
  const { session, end, toggleMute } = useRealtimeVoice();
  const [expanded, setExpanded] = useState(false);
  if (!session) return null;
  const recent = session.transcripts.slice(expanded ? -8 : -2);
  const stateLabel = session.state === "speaking"
    ? "Agent speaking"
    : session.state === "reconnecting"
      ? "Reconnecting"
      : session.state === "connecting"
        ? "Connecting"
        : session.state === "error"
          ? "Connection issue"
          : "Listening";

  return (
    <aside className="fixed bottom-20 right-3 z-[70] w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-xl border border-border bg-bg-card shadow-2xl sm:bottom-5 sm:right-20" aria-live="polite">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent ${session.state === "speaking" ? "animate-pulse" : ""}`}>
          <MicrophoneIcon muted={session.muted} />
        </span>
        <button type="button" onClick={() => setExpanded((value) => !value)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-xs font-semibold text-text">{session.agentName}</span>
          <span className="block text-[10px] text-text-muted">{stateLabel}{session.activeToolReason ? ` · ${session.activeToolReason}` : ""}</span>
        </button>
        <button type="button" onClick={toggleMute} className={`h-8 rounded-md border px-2 text-[10px] ${session.muted ? "border-accent text-accent" : "border-border text-text-muted hover:text-text"}`}>
          {session.muted ? "Unmute" : "Mute"}
        </button>
        <button type="button" onClick={() => void end()} className="h-8 rounded-md border border-red/60 px-2 text-[10px] text-red hover:bg-red/10">End</button>
      </div>
      {(recent.length > 0 || session.error) && (
        <div className="max-h-56 space-y-2 overflow-y-auto border-t border-border/70 px-3 py-2.5">
          {recent.map((line) => (
            <p key={line.id} className={`text-[11px] leading-relaxed ${line.role === "user" ? "text-text-muted" : "text-text"}`}>
              <span className="mr-2 text-[9px] font-bold uppercase text-text-dim">{line.role === "user" ? "You" : "Agent"}</span>{line.text}
            </p>
          ))}
          {session.error && <p className="text-[10px] text-red">{session.error}</p>}
        </div>
      )}
    </aside>
  );
}

export function MicrophoneIcon({ muted = false }: { muted?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="7" y="2.5" width="6" height="10" rx="3" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M7.5 17.5h5" />
      {muted && <path d="M3 3l14 14" />}
    </svg>
  );
}
