import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WidgetCanvas, type WidgetDefinition } from "./WidgetCanvas";

afterEach(cleanup);

const definitions: WidgetDefinition[] = [{
  key: "native:test",
  label: "Test widget",
  supportedSizes: ["half", "full"],
  defaultSize: "half",
  render: () => <section data-testid="widget-content">Widget content</section>,
}];

describe("WidgetCanvas editing", () => {
  async function renderConfigured(editing = true, onEditingChange = () => undefined) {
    const view = render(
      <WidgetCanvas
        projectId="default"
        slot="dashboard.home"
        definitions={definitions}
        editing={false}
        onEditingChange={onEditingChange}
        galleryRequest={1}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    await screen.findByTestId("widget-content");
    view.rerender(
      <WidgetCanvas
        projectId="default"
        slot="dashboard.home"
        definitions={definitions}
        editing={editing}
        onEditingChange={onEditingChange}
        galleryRequest={1}
      />,
    );
    return view;
  }

  test("keeps a missing Home layout blank while retaining gallery definitions", async () => {
    const onVisibleComponentsChange = mock(() => undefined);
    const { container } = render(
      <WidgetCanvas
        projectId="default"
        slot="dashboard.home"
        definitions={definitions}
        editing={false}
        onEditingChange={() => undefined}
        onVisibleComponentsChange={onVisibleComponentsChange}
        galleryRequest={1}
      />,
    );

    expect(container.querySelector("[data-widget-canvas]")).toBeNull();
    expect(screen.queryByText("Add your first widget")).toBeNull();
    expect(await screen.findByText("Built-in")).toBeTruthy();
    expect(screen.getByText("Test widget")).toBeTruthy();
    await waitFor(() => expect(onVisibleComponentsChange).toHaveBeenCalledWith([]));
  });

  test("keeps editor controls in normal document flow and limits dragging to the handle", async () => {
    const { container } = await renderConfigured();

    const frame = container.querySelector('[data-widget-id^="native:test:"]');
    const controls = container.querySelector("[data-widget-editor-controls]");
    const content = screen.getByTestId("widget-content");
    const dragHandle = screen.getByRole("button", { name: "Drag Test widget to reorder" });

    expect(frame?.className).toContain("border-dashed");
    expect(frame?.className).not.toContain("outline");
    expect(frame?.hasAttribute("draggable")).toBe(false);
    expect(dragHandle.getAttribute("draggable")).toBe("true");
    expect(controls).toBeTruthy();
    expect(controls?.className).not.toContain("absolute");
    expect(controls!.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Half" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("exits edit mode from the persistent editor toolbar", async () => {
    const onEditingChange = mock(() => undefined);
    await renderConfigured(true, onEditingChange);

    expect(screen.getByRole("toolbar", { name: "Layout editor" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onEditingChange).toHaveBeenCalledWith(false);
  });
});
