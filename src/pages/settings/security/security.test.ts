import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { SSHPolicy, SecurityEvent } from "../../../api";
import { describeUserAgent } from "../../../components/auth/OwnSessions";
import { CONTAINMENT_STATUS } from "./SecurityContainment";
import { describeActor } from "./SecurityEvents";
import { linesToList, policyForSave, type PolicyForm } from "./SecurityHost";

const form: PolicyForm = {
  sources: "10.0.0.0/8\n 192.0.2.4 ,\n\n",
  fingerprints: "SHA256:abc",
  rootAllowed: false,
  rootSources: "",
  burstThreshold: "5",
  burstWindow: "60",
  webhookURL: " https://alerts.example.test/hook ",
  webhookSecret: "",
};

describe("SSH policy form", () => {
  test("splits lists on newlines and commas, dropping blanks", () => {
    expect(linesToList("a\n b ,c\n\n,")).toEqual(["a", "b", "c"]);
    expect(linesToList("")).toEqual([]);
  });

  test("keeps the stored webhook secret when the field is left empty", () => {
    const body = policyForSave({ alert_webhook_secret_set: true, alert_webhook_secret: "should-not-round-trip" } as any, form);
    expect(body).toEqual({
      approved_sources: ["10.0.0.0/8", "192.0.2.4"],
      approved_fingerprints: ["SHA256:abc"],
      root_login_allowed: false,
      root_approved_sources: [],
      failure_burst_threshold: 5,
      failure_burst_window_seconds: 60,
      alert_webhook_url: "https://alerts.example.test/hook",
    });
    expect("alert_webhook_secret" in body).toBe(false);
    expect("alert_webhook_secret_set" in body).toBe(false);
  });

  test("sends a newly typed webhook secret", () => {
    expect(policyForSave({} as SSHPolicy, { ...form, webhookSecret: "  s3cret " }).alert_webhook_secret).toBe("s3cret");
  });

  test("non-numeric thresholds fall back to the server default", () => {
    const body = policyForSave({} as SSHPolicy, { ...form, burstThreshold: "", burstWindow: "abc" });
    expect(body.failure_burst_threshold).toBe(0);
    expect(body.failure_burst_window_seconds).toBe(0);
  });
});

describe("security event rows", () => {
  const base = { seq: 1, event_id: "e", occurred_at: "", category: "auth", action: "auth.login", result: "success", severity: "info" } as SecurityEvent;

  test("describes who acted and from where", () => {
    expect(describeActor({ ...base, principal_type: "user", principal_id: "3", source_ip: "192.0.2.1" })).toBe("user 3 from 192.0.2.1");
    expect(describeActor({ ...base, principal_type: "api_key", principal_id: "12" })).toBe("api_key 12");
    expect(describeActor(base)).toBe("anonymous");
  });
});

describe("containment outcomes", () => {
  test("has wording for every status the server reports", () => {
    for (const status of ["revoked", "disabled_locally", "already_inactive", "kept", "unsupported", "unconfirmed", "error"]) {
      expect(CONTAINMENT_STATUS[status]?.label).toBeTruthy();
    }
    expect(CONTAINMENT_STATUS.error.tone).toBe("bad");
    expect(CONTAINMENT_STATUS.unconfirmed.tone).toBe("warn");
  });
});

describe("own sessions", () => {
  test("labels devices from their user agent", () => {
    expect(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe("Safari on macOS");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge on Windows");
    expect(describeUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(describeUserAgent("curl/8.7.1")).toBe("Script");
    expect(describeUserAgent("")).toBe("Unknown device");
  });
});

describe("security screens follow dashboard UI rules", () => {
  const files = [
    "./SecurityOverview.tsx", "./SecurityEvents.tsx", "./SecurityContainment.tsx", "./SecurityHost.tsx", "./shared.tsx",
    "../SecuritySettings.tsx", "../../../components/auth/ReauthPrompt.tsx", "../../../components/auth/OwnSessions.tsx",
  ];
  test("use no emoji", () => {
    for (const file of files) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      expect({ file, emoji: text.match(/\p{Extended_Pictographic}/u)?.[0] }).toEqual({ file, emoji: undefined });
    }
  });
});
