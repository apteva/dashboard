import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chat, type ChatMessageRow } from "../api";
import { ChatConnectionsManager, type StreamFrame } from "./chatConnections";

class FakeEventSource {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  close() {
    this.closed = true;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const fn = listener as (event: MessageEvent) => void;
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(fn);
    this.listeners.set(type, listeners);
  }

  open() {
    this.onopen?.(new Event("open"));
  }

  message(row: ChatMessageRow) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(row) }));
  }

  stream(frame: StreamFrame) {
    const event = new MessageEvent("stream", { data: JSON.stringify(frame) });
    for (const listener of this.listeners.get("stream") ?? []) listener(event);
  }
}

const originalStream = chat.stream;
const originalPresence = chat.presence;
let source: FakeEventSource;

beforeEach(() => {
  source = new FakeEventSource();
  chat.stream = (() => source as unknown as EventSource) as typeof chat.stream;
  chat.presence = (() => Promise.resolve({ status: "ok", thread_id: "main" })) as typeof chat.presence;
});

afterEach(() => {
  chat.stream = originalStream;
  chat.presence = originalPresence;
});

describe("ChatConnectionsManager", () => {
  test("delivers default SSE messages and named streaming frames on one live connection", () => {
    const manager = new ChatConnectionsManager();
    const messages: number[] = [];
    const frames: Array<string | null> = [];

    manager.subscribeStream("default-286", (frame) => frames.push(frame?.text ?? null));
    manager.connect("default-286", 286);
    manager.subscribeMessages("default-286", 0, (row) => messages.push(row.id));
    source.open();

    source.stream({
      type: "stream",
      chat_id: "default-286",
      thread_id: "main",
      call_id: "call-1",
      text: "Hello in pro",
    });
    source.stream({
      type: "stream",
      chat_id: "default-286",
      thread_id: "main",
      call_id: "call-1",
      text: "",
      done: true,
    });
    expect(frames).toEqual(["Hello in pro"]);
    source.message({
      id: 650,
      chat_id: "default-286",
      role: "agent",
      content: "Hello in production",
      thread_id: "main",
      status: "final",
      created_at: "2026-07-10T09:36:48Z",
    });

    expect(manager.isOpen("default-286")).toBe(true);
    expect(frames).toEqual(["Hello in pro", null]);
    expect(messages).toEqual([650]);
    manager.stopAll();
  });
});
