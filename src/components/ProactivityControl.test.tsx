import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { ProactivityControl } from "./ProactivityControl";
import { defaultProactivity } from "../agentBehavior";

afterEach(cleanup);

test("defaults to Conservative and supports zero without losing it", () => {
  function Fixture() {
    const [value, setValue] = useState(defaultProactivity);
    return <ProactivityControl value={value} onChange={setValue} />;
  }
  const view = render(<Fixture />);
  const slider = view.getByRole("slider", { name: "Proactivity" });
  expect(slider.getAttribute("aria-valuetext")).toBe("25% Conservative");
  fireEvent.change(slider, { target: { value: "0" } });
  expect(slider.getAttribute("aria-valuetext")).toBe("0% Reactive");
  expect(view.getByText(/including recurring responsibilities/)).toBeTruthy();
  fireEvent.change(slider, { target: { value: "100" } });
  expect(slider.getAttribute("aria-valuetext")).toBe("100% Highly proactive");
  expect(view.getByText(/Independent of conversations and apps/)).toBeTruthy();
  expect(view.getByText(/does not invent busywork/)).toBeTruthy();
});
