import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { auth } from "../../api";
import { WidgetCanvas, type WidgetDefinition } from "./WidgetCanvas";
const originalPatch = auth.patchUILayoutSurface;
const originalFetch = globalThis.fetch;
const originalLocation = window.location.href;
let revision = 0;
beforeEach(() => {
  window.location.href = "http://localhost/";
  auth.patchUILayoutSurface = mock(async (project, surface, value) => ({
    value,
    revision: ++revision,
    ui_layout: { projects: { [project]: { slots: { [surface]: value } } } },
  }));
});
afterEach(() => {
  cleanup();
  auth.patchUILayoutSurface = originalPatch;
  globalThis.fetch = originalFetch;
  window.location.href = originalLocation;
});
const definition: WidgetDefinition = {
  key: "native:config-test",
  label: "Config test",
  supportedSizes: ["half", "full"],
  defaultSize: "half",
  sourceApp: "analytics",
  sourceInstallId: 42,
  settingsSchema: {
    type: "object",
    required: ["count"],
    properties: {
      count: { type: "integer", title: "Count", minimum: 1, default: 2 },
    },
  },
  settingsUI: { preview: true },
  render: (widget, context) => (
    <div
      data-testid={
        context?.context.configurationPreview ? "draft-preview" : "saved-widget"
      }
    >
      {String(widget.settings?.count)}
    </div>
  ),
};
function canvas(
  projectId = "p",
  extra: Partial<Parameters<typeof WidgetCanvas>[0]> = {},
) {
  return (
    <WidgetCanvas
      projectId={projectId}
      slot="dashboard.home"
      definitions={[definition]}
      editing
      onEditingChange={() => {}}
      galleryRequest={1}
      {...extra}
    />
  );
}
test("Add configures before persistence; cancel and edit cancel do not change the saved widget", async () => {
  const view = render(canvas());
  fireEvent.click(
    await screen.findByRole("button", { name: "Add Config test" }),
  );
  expect(screen.getByRole("dialog", { name: "Add Config test" })).toBeTruthy();
  expect(auth.patchUILayoutSurface).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Count"), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(screen.getByTestId("draft-preview").textContent).toBe("4");
  expect(auth.patchUILayoutSurface).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(auth.patchUILayoutSurface).not.toHaveBeenCalled();
  view.rerender(canvas("p", { galleryRequest: 2 }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Add Config test" }),
  );
  fireEvent.change(screen.getByLabelText("Count"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await screen.findByTestId("saved-widget");
  await waitFor(() =>
    expect(auth.patchUILayoutSurface).toHaveBeenCalledTimes(1),
  );
  expect(screen.getByTestId("saved-widget").textContent).toBe("3");
  fireEvent.click(
    screen.getByRole("button", { name: "Configure Config test" }),
  );
  fireEvent.change(screen.getByLabelText("Count"), { target: { value: "9" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(auth.patchUILayoutSurface).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("saved-widget").textContent).toBe("3");
  fireEvent.click(
    screen.getByRole("button", { name: "Configure Config test" }),
  );
  fireEvent.change(screen.getByLabelText("Count"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(auth.patchUILayoutSurface).toHaveBeenCalledTimes(2),
  );
  expect(screen.getByTestId("saved-widget").textContent).toBe("5");
});
test("switching project or installation discards the old configuration and aborts its discovery", async () => {
  let signal: AbortSignal | undefined;
  globalThis.fetch = mock((_input, init) => {
    signal = init?.signal as AbortSignal;
    return new Promise<Response>(() => {});
  }) as unknown as typeof fetch;
  const dynamic: WidgetDefinition = {
    ...definition,
    settingsUI: {
      fields: {
        count: { discovery: { route: "/options", value_field: "value" } },
      },
    },
  };
  const view = render(canvas("p", { definitions: [dynamic] }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Add Config test" }),
  );
  await waitFor(() => expect(signal).toBeDefined());
  view.rerender(canvas("other", { definitions: [dynamic] }));
  expect(screen.queryByRole("dialog", { name: "Add Config test" })).toBeNull();
  expect(signal?.aborted).toBe(true);
  expect(auth.patchUILayoutSurface).not.toHaveBeenCalled();
  // A provider installation switch has the same lifetime boundary as project navigation.
  view.rerender(
    canvas("p", {
      definitions: [{ ...dynamic, sourceInstallId: 99 }],
      galleryRequest: 2,
    }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Add Config test" }),
  );
  await waitFor(() => expect(signal?.aborted).toBe(false));
  view.rerender(
    canvas("p", {
      definitions: [{ ...dynamic, sourceInstallId: 100 }],
      galleryRequest: 2,
    }),
  );
  expect(screen.queryByRole("dialog", { name: "Add Config test" })).toBeNull();
  expect(signal?.aborted).toBe(true);
});

test("a failed Add rolls back the layout and keeps its draft available for retry", async () => {
  auth.patchUILayoutSurface = mock(async () => {
    throw new Error("Save unavailable");
  });
  render(canvas());
  fireEvent.click(
    await screen.findByRole("button", { name: "Add Config test" }),
  );
  fireEvent.change(screen.getByLabelText("Count"), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await screen.findByText("Save unavailable");
  expect(screen.queryByTestId("saved-widget")).toBeNull();
  expect((screen.getByLabelText("Count") as HTMLInputElement).value).toBe("8");
  auth.patchUILayoutSurface = originalPatch;
  auth.patchUILayoutSurface = mock(async (project, surface, value) => ({
    value,
    revision: ++revision,
    ui_layout: { projects: { [project]: { slots: { [surface]: value } } } },
  }));
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await screen.findByTestId("saved-widget");
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Add Config test" }),
    ).toBeNull(),
  );
  expect(screen.getByTestId("saved-widget").textContent).toBe("8");
});
