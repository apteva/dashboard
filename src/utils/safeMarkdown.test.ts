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

  test("preserves section boundaries for chat typography", () => {
    const html = renderSafeMarkdown(
      "## CRM health summary\n\n**Needs attention**\n\n- Follow up\n\n**Pipeline**",
    );
    // Happy DOM's DOMPurify adapter unwraps headings even though browser
    // DOMPurify preserves them. Keep this structural assertion portable; the
    // browser-facing heading spacing contract lives in themeTokens.test.ts.
    expect(html).toContain("CRM health summary");
    expect(html).toContain("<p><strong>Needs attention</strong></p>");
    expect(html).toContain("<ul>");
    expect(html).toContain("</ul>\n<p><strong>Pipeline</strong></p>");
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
