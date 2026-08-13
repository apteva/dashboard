import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarketplaceView } from "./Apps";

afterEach(cleanup);

describe("MarketplaceView categories", () => {
  test("shows one selected category and no all-category control", () => {
    const onCategoryChange = mock(() => {});

    render(
      <MarketplaceView
        entries={[]}
        total={0}
        page={1}
        pageSize={24}
        query=""
        category="business"
        categories={{ business: 20, media: 12 }}
        registryURL=""
        loading={false}
        onQueryChange={() => {}}
        onCategoryChange={onCategoryChange}
        onPageChange={() => {}}
        onInstall={() => {}}
        onOpenDetails={() => {}}
      />,
    );

    const selected = screen.getByRole("button", { name: /business/i });
    expect(selected.className).toContain("bg-accent");
    expect(screen.queryByRole("button", { name: /^all\b/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /media/i }));
    expect(onCategoryChange).toHaveBeenCalledWith("media");
  });
});
