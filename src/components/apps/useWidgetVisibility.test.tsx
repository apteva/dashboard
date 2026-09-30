import { afterEach, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { useWidgetVisibility } from "./useWidgetVisibility";
afterEach(cleanup);
const widgets = ["native:helper", "native:system-map"];
function Canvas({ report, ready }: { report: (keys: string[]) => void; ready: boolean }) {
  useEffect(() => { if (ready) report(widgets); }, [report, ready]);
  return null;
}
function Page({ scope, ready = true }: { scope: string; ready?: boolean }) {
  const visibility = useWidgetVisibility(scope);
  return <><Canvas report={visibility.onVisibleChange} ready={ready} /><output>{visibility.reported ? visibility.components.join(",") : "Waiting for layout"}</output></>;
}
test("a cached canvas report survives initial parent mount", () => {
  render(<Page scope="project-one/build" />);
  expect(screen.getByRole("status").textContent).toBe(widgets.join(","));
});
test("scope changes drop old widgets until the new canvas reports, then republish identical layouts", () => {
  const view = render(<Page scope="project-one/build" />);
  view.rerender(<Page scope="project-two/build" ready={false} />);
  expect(screen.getByRole("status").textContent).toBe("Waiting for layout");
  view.rerender(<Page scope="project-two/build" />);
  expect(screen.getByRole("status").textContent).toBe(widgets.join(","));
  view.rerender(<Page scope="project-two/another-page" />);
  expect(screen.getByRole("status").textContent).toBe(widgets.join(","));
});
