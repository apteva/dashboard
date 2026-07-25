import { describe, expect, test } from "bun:test";
import type { AppDetail } from "../api";
import {
  defaultIntegrationAuthType,
  visibleCredentialFields,
} from "./integrationAuth";

function app(auth: AppDetail["auth"]): AppDetail {
  return {
    slug: "fixture",
    name: "Fixture",
    description: "",
    logo: null,
    categories: [],
    auth_types: auth.types,
    tool_count: 0,
    has_webhooks: false,
    base_url: "https://example.test",
    auth,
    tools: [],
  };
}

describe("mixed OAuth credentials", () => {
  test("prefers OAuth while showing only user-supplied supplemental fields", () => {
    const googleAds = app({
      types: ["bearer", "oauth2"],
      oauth2: {},
      credential_fields: [
        { name: "token", label: "Token", source: "oauth", hidden: true },
        {
          name: "developer_token",
          label: "Developer token",
          source: "user",
          type: "password",
          required: true,
        },
        {
          name: "manager_customer_id",
          label: "Manager customer ID",
          source: "user",
          type: "text",
          required: false,
        },
        { name: "refresh_token", label: "Refresh token", source: "oauth", hidden: true },
      ],
    });

    expect(defaultIntegrationAuthType(googleAds)).toBe("oauth2");
    expect(
      visibleCredentialFields(googleAds, "oauth2").map((field) => field.name),
    ).toEqual(["developer_token", "manager_customer_id"]);
  });

  test("retains legacy token-only OAuth preference", () => {
    const legacy = app({
      types: ["bearer", "oauth2"],
      oauth2: {},
      credential_fields: [
        { name: "token", label: "Token" },
        { name: "refresh_token", label: "Refresh token" },
      ],
    });
    expect(defaultIntegrationAuthType(legacy)).toBe("oauth2");
    expect(visibleCredentialFields(legacy, "oauth2")).toEqual([]);
  });

  test("retains a genuine non-OAuth credential default without metadata", () => {
    const apiKey = app({
      types: ["api_key", "oauth2"],
      oauth2: {},
      credential_fields: [{ name: "api_key", label: "API key" }],
    });
    expect(defaultIntegrationAuthType(apiKey)).toBe("api_key");
  });
});
