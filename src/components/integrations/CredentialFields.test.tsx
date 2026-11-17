import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { useState } from "react";
import type { AppDetail, CredentialField } from "../../api";
import { CredentialFields, CredentialValueInput } from "./CredentialFields";
import { defaultIntegrationAuthType } from "../../utils/integrationAuth";

const privateKeyField: CredentialField = {
  name: "private_key",
  label: "API Private Key (.p8)",
  type: "multiline_password",
};

describe("CredentialValueInput", () => {
  test("YouTube catalog opens OAuth setup without asking for issued tokens", () => {
    // YouTube's legacy catalog entry has unannotated OAuth response fields.
    const detail: AppDetail = {
      slug: "youtube-api", name: "YouTube", description: "", logo: null,
      categories: [], auth_types: ["bearer", "oauth2"], tool_count: 0,
      has_webhooks: false, base_url: "https://www.googleapis.com/youtube/v3", tools: [],
      auth: {
        types: ["bearer", "oauth2"], oauth2: {},
        credential_fields: [
          { name: "token", label: "access_token" },
          { name: "refresh_token", label: "refresh_token" },
          { name: "expires_in", label: "expires_in" },
          { name: "expires_at", label: "expires_at" },
          { name: "token_type", label: "token_type" },
        ],
      },
    };
    expect(defaultIntegrationAuthType(detail)).toBe("oauth2");
    const html = renderToStaticMarkup(
      <CredentialFields
        detail={detail}
        credentials={{}}
        setCredentials={() => {}}
        oauthClientID=""
        setOAuthClientID={() => {}}
        oauthClientSecret=""
        setOAuthClientSecret={() => {}}
        oauthClientResolved={false}
      />,
    );
    expect(html).toContain("OAuth client ID");
    expect(html).toContain("OAuth client secret");
    for (const name of ["access_token", "refresh_token", "expires_in", "expires_at", "token_type"]) {
      expect(html).not.toContain(name);
    }
  });

  test("renders closed credential choices as a select with its catalog default", () => {
    const html = renderToStaticMarkup(
      <CredentialValueInput
        field={{
          name: "api_host",
          label: "API environment",
          type: "select",
          options: ["api.pinterest.com", "api-sandbox.pinterest.com"],
          default: "api.pinterest.com",
        }}
        value=""
        onChange={() => {}}
        className="credential"
        required
      />,
    );

    expect(html).toContain("<select");
    expect(html).toContain('value="api.pinterest.com" selected=""');
    expect(html).toContain("api-sandbox.pinterest.com");
    expect(html).not.toContain('type="password"');
  });

  test("preserves multiline private keys in a masked textarea", () => {
    const value =
      "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----";
    const html = renderToStaticMarkup(
      <CredentialValueInput
        field={privateKeyField}
        value={value}
        onChange={() => {}}
        className="credential"
        required
      />,
    );

    expect(html).toContain("<textarea");
    expect(html).toContain("-----BEGIN PRIVATE KEY-----\nabc123\n");
    expect(html).toContain("-webkit-text-security:disc");
    expect(html).toContain('aria-label="Show API Private Key (.p8)"');
  });

  test("keeps pasted .p8 contents unchanged through the input handler", () => {
    const pasted =
      "-----BEGIN PRIVATE KEY-----\nline-one\nline-two\n-----END PRIVATE KEY-----\n";

    function Harness() {
      const [value, setValue] = useState("");
      return (
        <CredentialValueInput
          field={privateKeyField}
          value={value}
          onChange={setValue}
          className="credential"
          required
        />
      );
    }

    const { container } = render(<Harness />);
    const input = container.querySelector("textarea");
    if (!input) {
      throw new Error("multiline credential textarea was not rendered");
    }
    fireEvent.input(input, { target: { value: pasted } });

    expect((input as HTMLTextAreaElement).value).toBe(pasted);
  });
});
