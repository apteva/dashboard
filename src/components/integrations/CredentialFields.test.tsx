import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { useState } from "react";
import type { CredentialField } from "../../api";
import { CredentialValueInput } from "./CredentialFields";

const privateKeyField: CredentialField = {
  name: "private_key",
  label: "API Private Key (.p8)",
  type: "multiline_password",
};

describe("CredentialValueInput", () => {
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
