export type RealtimeAudioState = "connecting" | "listening" | "speaking" | "closed" | "error";

export interface RealtimeAudioCallbacks {
  onState?: (state: RealtimeAudioState) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (message: string) => void;
}

const TARGET_SAMPLE_RATE = 24_000;
const CAPTURE_WORKLET_URL = "/realtime-capture-worklet.js?v=20260716a";

export class RealtimeAudioClient {
  private readonly callbacks: RealtimeAudioCallbacks;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private socket: WebSocket | null = null;
  private muted = false;
  private intentionalClose = false;
  private playbackCursor = 0;
  private playbackSources = new Set<AudioBufferSourceNode>();

  constructor(callbacks: RealtimeAudioCallbacks = {}) {
    this.callbacks = callbacks;
  }

  async prepare(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is not supported by this browser.");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.context = new AudioContext({ latencyHint: "interactive" });
    if (this.context.state === "suspended") await this.context.resume();
    // Keep the processor on the dashboard origin. Blob-backed worklet modules
    // are rejected by Safari and by stricter script-src CSP implementations,
    // even when worker-src permits blob workers.
    await this.context.audioWorklet.addModule(CAPTURE_WORKLET_URL);
    this.source = this.context.createMediaStreamSource(this.stream);
    this.capture = new AudioWorkletNode(this.context, "apteva-pcm-capture", {
      numberOfInputs: 1,
      // A silent connected output keeps the worklet in the browser's active
      // audio graph. With zero outputs Safari may stop pulling the microphone
      // node even though its MessagePort remains alive.
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
    });
    this.capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.muted || this.socket?.readyState !== WebSocket.OPEN) return;
      this.socket.send(event.data);
    };
    this.source.connect(this.capture);
    this.capture.connect(this.context.destination);
  }

  async connect(url: string): Promise<void> {
    if (!this.context || !this.stream) throw new Error("Microphone is not prepared.");
    this.intentionalClose = false;
    this.callbacks.onState?.("connecting");
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close(1000, "reconnect");
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const fail = () => reject(new Error("Could not connect the realtime audio stream."));
      socket.addEventListener("open", () => {
        this.callbacks.onState?.("listening");
        resolve();
      }, { once: true });
      socket.addEventListener("error", fail, { once: true });
    });
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const control = JSON.parse(event.data);
          if (control?.type === "interrupt") {
            this.clearPlayback();
            this.callbacks.onState?.("listening");
          }
        } catch {
          // Unknown text controls are intentionally ignored for forwards compatibility.
        }
        return;
      }
      if (event.data instanceof ArrayBuffer) this.playPCM(event.data);
    };
    socket.onerror = () => this.callbacks.onError?.("Realtime audio connection failed.");
    socket.onclose = (event) => {
      if (this.socket === socket) this.socket = null;
      if (this.intentionalClose) this.callbacks.onState?.("closed");
      this.callbacks.onClose?.(event);
    };
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const track of this.stream?.getAudioTracks() || []) track.enabled = !muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  close(): void {
    this.intentionalClose = true;
    this.socket?.close(1000, "session ended");
    this.socket = null;
    this.clearPlayback();
    this.capture?.disconnect();
    this.source?.disconnect();
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.stream = null;
    this.capture = null;
    this.source = null;
    if (this.context) void this.context.close();
    this.context = null;
    this.callbacks.onState?.("closed");
  }

  private playPCM(buffer: ArrayBuffer): void {
    const context = this.context;
    if (!context || context.state === "closed") return;
    const pcm = new Int16Array(buffer);
    if (pcm.length === 0) return;
    const audio = context.createBuffer(1, pcm.length, TARGET_SAMPLE_RATE);
    const channel = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i += 1) channel[i] = pcm[i] / 32768;
    const source = context.createBufferSource();
    source.buffer = audio;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.015, this.playbackCursor);
    this.playbackCursor = startAt + audio.duration;
    this.playbackSources.add(source);
    source.onended = () => {
      this.playbackSources.delete(source);
      if (this.playbackSources.size === 0) this.callbacks.onState?.("listening");
    };
    this.callbacks.onState?.("speaking");
    source.start(startAt);
  }

  private clearPlayback(): void {
    for (const source of this.playbackSources) {
      try { source.stop(); } catch {}
    }
    this.playbackSources.clear();
    this.playbackCursor = this.context?.currentTime || 0;
  }
}

export function realtimeAudioURL(agentId: number, threadId: string, token: string): string {
  const url = new URL("/api/realtime/audio", window.location.origin);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("agent_id", String(agentId));
  url.searchParams.set("thread", threadId);
  url.searchParams.set("token", token);
  return url.toString();
}
