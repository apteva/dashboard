import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  __installedAppsTestHelpers,
  useInstalledApps,
} from "./chatComponents";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  __installedAppsTestHelpers.cache.clear();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe("shared installed-app catalog", () => {
  test("coalesces many widget hosts onto one project request and refreshes after app changes", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify([{ name: "tasks", version: "1.0.0", status: "running" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = renderHook(() => useInstalledApps("project-cache"));
    const second = renderHook(() => useInstalledApps("project-cache"));
    await waitFor(() => expect(first.result.current).toHaveLength(1));
    expect(second.result.current).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new CustomEvent("apteva:apps-changed"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

