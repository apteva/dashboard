import { beforeAll, describe, expect, test } from "bun:test";

let renderSafeMarkdown: (source: string) => string;

beforeAll(async () => {
  // Dynamic import ensures happy-dom's preload has installed `window` before
  // DOMPurify initializes its browser capability checks.
  ({ renderSafeMarkdown } = await import("./safeMarkdown"));
});

describe("renderSafeMarkdown", () => {
  test("keeps normal markdown formatting", () => {
    const html = renderSafeMarkdown("**safe** [link](https://example.com)");
    expect(html).toContain("<strong>safe</strong>");
    expect(html).toContain('href="https://example.com"');
  });

  test("removes active HTML and unsafe URL schemes", () => {
    const html = renderSafeMarkdown(
      '<img src=x onerror="alert(1)"><svg onload="alert(2)"></svg>' +
      '[click](javascript:alert(3))<iframe srcdoc="bad"></iframe>',
    );
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("onload");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("iframe");
    expect(html).not.toContain("srcdoc");
  });
});
