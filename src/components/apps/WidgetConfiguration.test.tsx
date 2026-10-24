import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WidgetConfiguration } from "./WidgetConfiguration";
import { AppDiscoverySelect } from "./AppDiscoverySelect";
import { discoveryURL } from "./appDiscovery";
import type { WidgetSettingsUI } from "./widgetSettings";
const originalFetch = globalThis.fetch;
const originalLocation = window.location.href;
beforeEach(() => {
  window.location.href = "http://localhost/";
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  window.location.href = originalLocation;
});
const schema = {
  type: "object",
  required: ["app", "topic"],
  properties: {
    app: {
      type: "string",
      title: "Source",
      enum: ["crm", "tasks"],
      default: "crm",
    },
    topic: { type: "integer", title: "Event" },
    window: {
      type: "integer",
      title: "Window",
      minimum: 1,
      maximum: 30,
      default: 7,
    },
  },
};
const ui: WidgetSettingsUI = {
  order: ["app", "topic", "window"],
  advanced: ["window"],
  preview: true,
  fields: {
    topic: {
      discovery: {
        route: "/widget-options",
        query: { field: "topic", app: { setting: "app" } },
        response_path: "options",
        value_field: "value",
        label_field: "label",
      },
    },
  },
};
const options = (value: number, label = "Created") =>
  Response.json({ options: [{ value, label }] });
function mount(props: Partial<Parameters<typeof WidgetConfiguration>[0]> = {}) {
  const save = mock(async (_settings: Record<string, unknown>) => {});
  const close = mock(() => {});
  const view = render(
    <WidgetConfiguration
      label="Metric"
      schema={schema}
      ui={ui}
      settings={{ app: "crm", topic: 0, window: 7 }}
      app="analytics"
      installId={42}
      projectId="p"
      onSave={save}
      onClose={close}
      {...props}
    />,
  );
  return { ...view, save, close };
}
test("scoped dependent discovery preserves zero as a number, preview uses a draft, Cancel writes nothing", async () => {
  const urls: string[] = [];
  globalThis.fetch = mock(async (input) => {
    urls.push(String(input));
    return options(0);
  }) as unknown as typeof fetch;
  const previews = mock((settings: any, context: any) => (
    <p>{JSON.stringify({ settings, context: context.context })}</p>
  ));
  const { save, close } = mount({ renderPreview: previews });
  await screen.findByRole("option", { name: "Created" });
  const url = new URL(urls[0], "http://localhost");
  expect(url.pathname).toBe("/api/apps/analytics/widget-options");
  expect(url.searchParams.get("install_id")).toBe("42");
  expect(url.searchParams.get("project_id")).toBe("p");
  expect(url.searchParams.get("app")).toBe("crm");
  fireEvent.change(screen.getByLabelText("Window"), {
    target: { value: "12" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(previews.mock.calls.at(-1)?.[0]).toMatchObject({
    topic: 0,
    window: 12,
  });
  expect(previews.mock.calls.at(-1)?.[1].context).toMatchObject({
    configurationPreview: true,
    hostForeground: false,
    projectId: "p",
  });
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
test("upstream changes revalidate selection, block invalid values and save the replacement with its schema type", async () => {
  globalThis.fetch = mock(async (input) =>
    String(input).includes("app=tasks")
      ? options(2, "Task created")
      : options(0),
  ) as unknown as typeof fetch;
  const { save } = mount();
  await screen.findByRole("option", { name: "Created" });
  fireEvent.change(screen.getByLabelText("Source"), { target: { value: "1" } });
  await screen.findByRole("option", { name: "Task created" });
  expect(screen.getByText(/current value is unavailable/)).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Event"), { target: { value: "0" } });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({ app: "tasks", topic: 2, window: 7 }),
  );
});
test("failed lookup preserves the saved value and can be retried", async () => {
  let failed = true;
  globalThis.fetch = mock(async () =>
    failed ? new Response("unavailable", { status: 503 }) : options(0),
  ) as unknown as typeof fetch;
  const { save } = mount();
  await screen.findByText(/HTTP 503/);
  expect(screen.getByRole("option", { name: "Current: 0" })).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  failed = false;
  fireEvent.click(screen.getByRole("button", { name: "Refresh options" }));
  await screen.findByRole("option", { name: "Created" });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({ app: "crm", topic: 0, window: 7 }),
  );
});
test("stale option responses cannot overwrite the newest dependency lookup", async () => {
  let resolveFirst!: (response: Response) => void;
  globalThis.fetch = mock((input) =>
    String(input).includes("app=crm")
      ? new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        })
      : Promise.resolve(options(2, "New option")),
  ) as unknown as typeof fetch;
  mount();
  fireEvent.change(screen.getByLabelText("Source"), { target: { value: "1" } });
  await screen.findByRole("option", { name: "New option" });
  resolveFirst(options(0, "Stale option"));
  await waitFor(() =>
    expect(screen.queryByRole("option", { name: "Stale option" })).toBeNull(),
  );
  expect(screen.getByRole("option", { name: "New option" })).toBeTruthy();
});
test("steps and Advanced grouping retain unlisted schema fields and validate bounds", async () => {
  const save = mock(async () => {});
  mount({
    ui: {
      steps: [
        { id: "data", title: "Choose data", fields: ["app"] },
        { id: "display", title: "Display", fields: ["topic"] },
      ],
      advanced: ["window"],
    },
    onSave: save,
  });
  expect(screen.getByText(/Choose data/)).toBeTruthy();
  expect(screen.getByLabelText("Window").closest("details")?.hidden).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText(/Display/)).toBeTruthy();
  expect(screen.getByLabelText("Window")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Window"), {
    target: { value: "50" },
  });
  expect(
    (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Window"), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({ app: "crm", topic: 0, window: 8 }),
  );
});
test("save errors keep the configuration and draft open", async () => {
  const save = mock(async () => {
    throw new Error("Layout changed; reload and retry");
  });
  const { close } = mount({ ui: undefined, onSave: save });
  fireEvent.change(screen.getByLabelText("Window"), {
    target: { value: "12" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert", { name: "" });
  expect(screen.getByText(/Layout changed/)).toBeTruthy();
  expect((screen.getByLabelText("Window") as HTMLInputElement).value).toBe(
    "12",
  );
  expect(close).not.toHaveBeenCalled();
});
test("legacy app discovery remains string-valued", async () => {
  globalThis.fetch = mock(async () =>
    options(2, "Two"),
  ) as unknown as typeof fetch;
  const change = mock(() => {});
  render(
    <AppDiscoverySelect
      field={{
        app: "tables",
        discovery: {
          route: "/options",
          response_path: "options",
          value_field: "value",
          label_field: "label",
        },
      }}
      value=""
      onChange={change}
      installId={9}
      projectId="p"
    />,
  );
  await screen.findByRole("option", { name: "Two" });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
  expect(change).toHaveBeenCalledWith("2");
});
test("discovery cannot escape its provider or override scope", () => {
  for (const route of [
    "https://example.invalid/options",
    "//example.invalid/options",
    "/../other",
    "/foo?project_id=other",
    "/%2e%2e/options",
  ]) {
    expect(() => discoveryURL("analytics", route, 42, "p")).toThrow();
  }
  expect(() =>
    discoveryURL("analytics", "/options", 42, "p", { project_id: "other" }),
  ).toThrow();
  expect(
    discoveryURL("analytics", "/options", 42, undefined, {
      enabled: false,
      count: 0,
    }),
  ).toContain("count=0");
});

test("dynamic selections on earlier steps are revalidated when a later dependency changes", async () => {
  globalThis.fetch = mock(async (input) =>
    String(input).includes("app=tasks")
      ? options(2, "Task created")
      : options(0),
  ) as unknown as typeof fetch;
  mount({
    ui: {
      ...ui,
      steps: [
        { id: "event", title: "Choose event", fields: ["topic"] },
        { id: "source", title: "Choose source", fields: ["app"] },
      ],
    },
  });
  await screen.findByRole("option", { name: "Created" });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByLabelText("Source"), { target: { value: "1" } });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByRole("option", { name: "Task created" });
  expect(screen.getByText(/current value is unavailable/)).toBeTruthy();
});
