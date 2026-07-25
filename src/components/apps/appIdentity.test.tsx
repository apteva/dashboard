import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppIcon } from "@apteva/ui-kit";

describe("shared app identity", () => {
  test("renders monochrome icons as theme-colored masks", () => {
    const html = renderToStaticMarkup(
      <AppIcon
        src="/api/apps/computer/ui/icon.svg?install_id=34"
        iconStyle="monochrome"
        name="Computer"
        className="text-accent"
      />,
    );

    expect(html).toContain("text-accent");
    expect(html).toContain("mask-image");
    expect(html).toContain("computer/ui/icon.svg?install_id=34");
  });

  test("matches the gallery spacing for framed app tiles", () => {
    const html = renderToStaticMarkup(
      <AppIcon
        src="/api/apps/computer/ui/icon.svg"
        iconStyle="monochrome"
        name="Computer"
        size="lg"
      />,
    );

    expect(html).toContain("h-12 w-12");
    expect(html).toContain("h-8 w-8");
    expect(html).not.toContain("h-10 w-10");
  });

  test("keeps unframed utility icons visually present", () => {
    const html = renderToStaticMarkup(
      <AppIcon
        src="/api/apps/computer/ui/icon.svg"
        iconStyle="monochrome"
        name="Computer"
        size="sm"
        framed={false}
      />,
    );

    expect(html).toContain("h-6 w-6");
    expect(html).toContain("h-5 w-5");
  });
});
