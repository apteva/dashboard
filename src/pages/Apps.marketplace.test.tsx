import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarketplaceView } from "./Apps";

afterEach(cleanup);

describe("MarketplaceView categories", () => {
  test("shows an all-category control and selects a category", () => {
    const onCategoryChange = mock(() => {});

    render(
      <MarketplaceView
        entries={[]}
        total={32}
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
    expect(screen.getByRole("button", { name: /^all\b/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /media/i }));
    expect(onCategoryChange).toHaveBeenCalledWith("media");

    fireEvent.click(screen.getByRole("button", { name: /^all\b/i }));
    expect(onCategoryChange).toHaveBeenCalledWith("");
  });

  test("marks all apps selected when no category filter is active", () => {
    render(
      <MarketplaceView
        entries={[]}
        total={32}
        page={1}
        pageSize={24}
        query=""
        category=""
        categories={{ business: 20, media: 12 }}
        registryURL=""
        loading={false}
        onQueryChange={() => {}}
        onCategoryChange={() => {}}
        onPageChange={() => {}}
        onInstall={() => {}}
        onOpenDetails={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /^all\b/i }).className).toContain("bg-accent");
  });
});
