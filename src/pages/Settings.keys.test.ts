import { describe, expect, test } from "bun:test";
import { type Key, visibleUserManagedKeys } from "./Settings";

const now = Date.parse("2026-08-25T12:00:00Z");

function key(id: number, kind: Key["kind"], overrides: Partial<Key> = {}): Key {
  return {
    id,
    name: `key-${id}`,
    key_prefix: `prefix-${id}`,
    kind,
    created_at: "2026-08-25T10:00:00Z",
    ...overrides,
  };
}

describe("visibleUserManagedKeys", () => {
  test("keeps only active private and public-client credentials", () => {
    const visible = visibleUserManagedKeys([
      key(1, "private"),
      key(2, "public_client", { expires_at: "2026-08-25T13:00:00Z" }),
      key(3, "delegated_user", { expires_at: "2026-08-25T13:00:00Z" }),
      key(4, "private", { revoked_at: "2026-08-25T11:00:00Z" }),
      key(5, "public_client", { expires_at: "2026-08-25T11:00:00Z" }),
      key(6, "unexpected"),
    ], now);

    expect(visible.map((item) => item.id)).toEqual([1, 2]);
  });

  test("keeps legacy keys with no kind as private", () => {
    expect(visibleUserManagedKeys([key(1, undefined)], now).map((item) => item.id)).toEqual([1]);
  });
});
