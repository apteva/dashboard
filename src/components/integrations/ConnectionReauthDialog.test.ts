import { describe, expect, test } from "bun:test";
import { isConnectionReauthable } from "./ConnectionReauthDialog";

describe("connection reauthentication", () => {
  test("supports browser and device-code OAuth connections", () => {
    expect(isConnectionReauthable("oauth1")).toBe(true);
    expect(isConnectionReauthable("oauth2")).toBe(true);
    expect(isConnectionReauthable("oauth_device_code")).toBe(true);
  });

  test("does not mislabel pasted credentials as an OAuth flow", () => {
    expect(isConnectionReauthable("api_key")).toBe(false);
    expect(isConnectionReauthable("bearer")).toBe(false);
    expect(isConnectionReauthable("")).toBe(false);
  });
});
