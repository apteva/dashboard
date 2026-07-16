import { describe, expect, test } from "bun:test";
import { formatContextResetResult } from "./ThreadDetailModal";

describe("formatContextResetResult", () => {
  test("reports the verified cleanup metrics", () => {
    expect(formatContextResetResult({
      status: "reset",
      id: "main",
      before_count: 8,
      after_count: 1,
      removed_count: 7,
      before_chars: 12_000,
      after_chars: 800,
      removed_chars: 11_200,
    })).toBe("Removed 7 conversation messages (11.2k chars). 1 message remains in the live context.");
  });

  test("makes a successful no-op explicit", () => {
    expect(formatContextResetResult({
      status: "reset",
      id: "main",
      before_count: 1,
      after_count: 1,
      removed_count: 0,
      before_chars: 800,
      after_chars: 800,
      removed_chars: 0,
    })).toBe("The conversation context was already clean. 1 message remains in the live context.");
  });
});
