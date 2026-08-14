import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { integrations, type ConnectionInfo } from "../../api";
import { URLPropertiesPanel } from "./URLPropertiesPanel";

const originalURLProperties = integrations.urlProperties;

afterEach(() => {
  integrations.urlProperties = originalURLProperties;
  cleanup();
});

describe("URLPropertiesPanel", () => {
  test("shows provider verification readiness for an eligible connection", async () => {
    integrations.urlProperties = mock(async () => ({
      integration: "tiktok-api",
      properties: [
        {
          definition: {
            id: "content_delivery",
            label: "Media delivery URL",
            purpose: "Lets TikTok fetch media.",
            types: ["url_prefix"],
            verification_methods: ["file"],
            setup_url: "https://developers.tiktok.com/apps/",
          },
          ready: false,
          fingerprint: "abc",
          configured_prefix: "https://agents.example/api/relay/",
          state: { hosting_status: "configured", relay_status: "ready", verification_filename: "verify.txt" },
        },
      ],
    })) as typeof integrations.urlProperties;

    const connection = {
      id: 42,
      app_slug: "tiktok-api",
      app_name: "TikTok",
      name: "Brand account",
      auth_type: "oauth2",
      status: "active",
      source: "local",
      tool_count: 3,
      created_at: "2026-08-14T00:00:00Z",
    } satisfies ConnectionInfo;

    render(<URLPropertiesPanel connections={[connection]} />);
    expect(await screen.findByText("Media delivery URL")).toBeTruthy();
    expect(screen.getByText("Setup required")).toBeTruthy();
    expect(screen.getByText("https://agents.example/api/relay/")).toBeTruthy();
    expect(screen.getByText("Upload TikTok's verification file")).toBeTruthy();
    expect(screen.getByText("Check the public URL")).toBeTruthy();
    expect(screen.getByText("Verify it with TikTok")).toBeTruthy();
    expect(screen.queryByText(/relay not configured/i)).toBeNull();
    expect(screen.getByRole("link", { name: /open tiktok setup/i }).getAttribute("href")).toBe("https://developers.tiktok.com/apps/");
  });

  test("stays hidden when connected apps declare no URL properties", async () => {
    integrations.urlProperties = mock(async () => ({ integration: "github", properties: [] })) as typeof integrations.urlProperties;
    const connection = {
      id: 7,
      app_slug: "github",
      app_name: "GitHub",
      name: "GitHub",
      auth_type: "oauth2",
      status: "active",
      source: "local",
      tool_count: 10,
      created_at: "2026-08-14T00:00:00Z",
    } satisfies ConnectionInfo;
    const { container } = render(<URLPropertiesPanel connections={[connection]} />);
    await waitFor(() => expect(integrations.urlProperties).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
