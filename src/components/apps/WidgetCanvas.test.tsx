import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  test("keeps editor controls in normal document flow and limits dragging to the handle", () => {
    const { container } = render(
      <WidgetCanvas
        projectId="default"
        slot="dashboard.home"
        definitions={definitions}
        defaults={[{ id: "native:test", component: "native:test", size: "half" }]}
        editing
        onEditingChange={() => undefined}
      />,
    );

    const frame = container.querySelector('[data-widget-id="native:test"]');
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

  test("exits edit mode from the persistent editor toolbar", () => {
    const onEditingChange = mock(() => undefined);
    render(
      <WidgetCanvas
        projectId="default"
        slot="dashboard.home"
        definitions={definitions}
        defaults={[{ id: "native:test", component: "native:test", size: "half" }]}
        editing
        onEditingChange={onEditingChange}
      />,
    );

    expect(screen.getByRole("toolbar", { name: "Layout editor" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onEditingChange).toHaveBeenCalledWith(false);
  });
});
