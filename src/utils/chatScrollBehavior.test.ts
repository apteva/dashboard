import { describe, expect, test } from "bun:test";
import {
  nextChatBottomFollowState,
  shouldPinChatBottom,
} from "./chatScrollBehavior";

describe("chat bottom pinning", () => {
  test("opens newly selected conversation history at its newest message", () => {
    expect(shouldPinChatBottom("chat-b", true, "chat-a", false)).toBe(true);
  });

  test("does not force an incomplete history load", () => {
    expect(shouldPinChatBottom("chat-b", false, "chat-a", false)).toBe(false);
  });

  test("respects manual upward scrolling after the initial pin", () => {
    expect(shouldPinChatBottom("chat-b", true, "chat-b", false)).toBe(false);
  });

  test("continues following live content while the user remains at the bottom", () => {
    expect(shouldPinChatBottom("chat-b", true, "chat-b", true)).toBe(true);
  });

  test("keeps following when a lazy widget expands below the viewport", () => {
    // Reproduces a real chat reload: four 34px fallbacks became 667px cards.
    // Browser anchoring moved scrollTop forward, but left the viewport 633px
    // short of the new bottom.
    expect(nextChatBottomFollowState(true, 1115, 3013, 633)).toBe(true);
  });

  test("stops following when the user scrolls upward", () => {
    expect(nextChatBottomFollowState(true, 3013, 2450, 1196)).toBe(false);
  });

  test("does not resume merely because more content changes below", () => {
    expect(nextChatBottomFollowState(false, 2450, 2450, 1300)).toBe(false);
  });

  test("resumes after the user returns to the bottom", () => {
    expect(nextChatBottomFollowState(false, 2450, 3645, 0)).toBe(true);
  });
});
