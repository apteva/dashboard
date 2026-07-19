import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
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
let sources: FakeEventSource[];

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");

beforeEach(() => {
  sources = [];
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: new MemoryStorage() });
  chat.stream = (() => {
    source = new FakeEventSource();
    sources.push(source);
    return source as unknown as EventSource;
  }) as typeof chat.stream;
  chat.presence = (() => Promise.resolve({ status: "ok", thread_id: "main" })) as typeof chat.presence;
});

afterEach(() => {
  jest.useRealTimers();
  chat.stream = originalStream;
  chat.presence = originalPresence;
  if (originalSessionStorage) Object.defineProperty(globalThis, "sessionStorage", originalSessionStorage);
  else delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
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

  test("clears a completed stream when duplicate suppression produces no durable row", () => {
    jest.useFakeTimers();
    const manager = new ChatConnectionsManager();
    const frames: Array<string | null> = [];
    manager.subscribeStream("default-286", (frame) => frames.push(frame?.text ?? null));
    manager.connect("default-286", 286);

    source.stream({
      type: "stream",
      chat_id: "default-286",
      thread_id: "main",
      call_id: "duplicate-call",
      text: "Understood — I’ll wait.",
    });
    source.stream({
      type: "stream",
      chat_id: "default-286",
      thread_id: "main",
      call_id: "duplicate-call",
      text: "",
      done: true,
    });

    expect(frames).toEqual(["Understood — I’ll wait."]);
    jest.advanceTimersByTime(1500);
    expect(frames).toEqual(["Understood — I’ll wait.", null]);
  });

  test("does not resurrect a stream frame after its durable message wins the SSE race", () => {
    const manager = new ChatConnectionsManager();
    const frames: Array<string | null> = [];
    manager.subscribeStream("conv-race", (frame) => frames.push(frame?.text ?? null));
    manager.connect("conv-race", 1);

    source.message({
      id: 701,
      chat_id: "conv-race",
      role: "agent",
      content: "The installed apps are Ads, Analytics, and Billing.",
      thread_id: "chat-conv-race",
      status: "final",
      created_at: "2026-07-19T09:04:16Z",
    });
    // stream and message are independent server channels. This partial frame
    // may be selected after the durable row even though it was produced first.
    source.stream({
      type: "stream",
      chat_id: "conv-race",
      thread_id: "chat-conv-race",
      call_id: "late-call",
      text: "The installed apps are Ads, Analytics",
    });
    source.stream({
      type: "stream",
      chat_id: "conv-race",
      thread_id: "chat-conv-race",
      call_id: "late-call",
      text: "",
      done: true,
    });

    expect(frames).toEqual([]);
  });

  test("settles the active stream call when its durable message arrives", () => {
    const manager = new ChatConnectionsManager();
    const frames: Array<string | null> = [];
    manager.subscribeStream("conv-active", (frame) => frames.push(frame?.text ?? null));
    manager.connect("conv-active", 1);

    source.stream({
      type: "stream",
      chat_id: "conv-active",
      thread_id: "chat-conv-active",
      call_id: "active-call",
      text: "Final answer",
    });
    source.message({
      id: 702,
      chat_id: "conv-active",
      role: "agent",
      content: "Final answer",
      thread_id: "chat-conv-active",
      status: "final",
      created_at: "2026-07-19T09:04:17Z",
    });
    source.stream({
      type: "stream",
      chat_id: "conv-active",
      thread_id: "chat-conv-active",
      call_id: "active-call",
      text: "Final answer",
    });

    expect(frames).toEqual(["Final answer", null]);
  });

  test("does not hide an unrelated stream after settling the previous answer", () => {
    const manager = new ChatConnectionsManager();
    const frames: Array<string | null> = [];
    manager.subscribeStream("conv-next", (frame) => frames.push(frame?.text ?? null));
    manager.connect("conv-next", 1);

    source.message({
      id: 703,
      chat_id: "conv-next",
      role: "agent",
      content: "The first answer is complete.",
      thread_id: "chat-conv-next",
      status: "final",
      created_at: "2026-07-19T09:04:18Z",
    });
    source.stream({
      type: "stream",
      chat_id: "conv-next",
      thread_id: "chat-conv-next",
      call_id: "genuine-next-call",
      text: "A genuinely different next response",
    });

    expect(frames).toEqual(["A genuinely different next response"]);
  });

  test("restores one primary connection after refresh and remembers explicit disconnect", () => {
    const beforeRefresh = new ChatConnectionsManager();
    beforeRefresh.connect("default-286", 286);
    expect(beforeRefresh.isConnected("default-286")).toBe(true);

    const afterRefresh = new ChatConnectionsManager();
    afterRefresh.resumeSession();
    expect(afterRefresh.isConnected("default-286")).toBe(true);
    expect(sources).toHaveLength(2);

    afterRefresh.disconnect("default-286", 286);
    const afterDisconnect = new ChatConnectionsManager();
    expect(afterDisconnect.shouldConnect("default-286", true)).toBe(false);
  });

  test("keeps restored conversation intent connected until the validated panel reopens its stream", () => {
    const beforeRefresh = new ChatConnectionsManager();
    beforeRefresh.connect("conv-refresh", 286);

    // A generic conversation is deliberately not opened at dashboard boot:
    // its owning page validates that the row still exists first. Its stored
    // intent must nevertheless remain connected from the panel's first render
    // so refresh never flashes Disconnect -> Connect -> Disconnect.
    const afterRefresh = new ChatConnectionsManager();
    expect(afterRefresh.shouldConnect("conv-refresh", false)).toBe(true);
    expect(afterRefresh.isConnected("conv-refresh")).toBe(true);

    const states: boolean[] = [];
    const unsubscribe = afterRefresh.subscribeState("conv-refresh", () => {
      states.push(afterRefresh.isConnected("conv-refresh"));
    });
    afterRefresh.connect("conv-refresh", 286);
    source.open();

    expect(states.length).toBeGreaterThan(0);
    expect(states.every(Boolean)).toBe(true);
    expect(afterRefresh.isOpen("conv-refresh")).toBe(true);
    unsubscribe();
    afterRefresh.stopAll();
  });

  test("keeps one stream alive while the chat panel unmounts and remounts during navigation", () => {
    const manager = new ChatConnectionsManager();
    manager.connect("conv-navigation", 327);
    source.open();
    const liveSource = source;

    const firstUnmount = manager.subscribeMessages("conv-navigation", 0, () => {});
    firstUnmount();
    expect(liveSource.closed).toBe(false);
    expect(manager.isConnected("conv-navigation")).toBe(true);
    expect(manager.isOpen("conv-navigation")).toBe(true);

    const messages: number[] = [];
    manager.subscribeMessages("conv-navigation", 0, (row) => messages.push(row.id));
    liveSource.message({
      id: 704,
      chat_id: "conv-navigation",
      role: "agent",
      content: "Still connected after navigation.",
      thread_id: "chat-conv-navigation",
      status: "final",
      created_at: "2026-07-19T10:00:00Z",
    });

    expect(sources).toHaveLength(1);
    expect(messages).toEqual([704]);
    manager.stopAll();
  });

  test("moves the tab connection instead of leaking one stream per conversation", () => {
    const manager = new ChatConnectionsManager();
    manager.connect("conv-1", 286);
    const first = source;
    manager.connect("conv-2", 327);

    expect(first.closed).toBe(true);
    expect(manager.isConnected("conv-1")).toBe(false);
    expect(manager.isConnected("conv-2")).toBe(true);
    expect(sources).toHaveLength(2);
  });

  test("permanently forgets a deleted conversation and its retry intent", () => {
    const manager = new ChatConnectionsManager();
    manager.connect("conv-deleted", 1);
    const deletedSource = source;

    manager.forgetChat("conv-deleted");

    expect(deletedSource.closed).toBe(true);
    expect(manager.isConnected("conv-deleted")).toBe(false);
    const afterDelete = new ChatConnectionsManager();
    afterDelete.resumeSession();
    expect(sources).toHaveLength(1);
  });

  test("drops generic restored intent without a noisy existence probe or SSE", () => {
    const beforeRefresh = new ChatConnectionsManager();
    beforeRefresh.connect("conv-missing", 1);
    const countBeforeRestore = sources.length;

    const restored = new ChatConnectionsManager();
    restored.resumeSession();

    expect(restored.isConnected("conv-missing")).toBe(false);
    expect(sources).toHaveLength(countBeforeRestore);
  });
});
