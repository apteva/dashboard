import { afterEach, expect, mock, test } from "bun:test";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { auth, type InterfaceLevel } from "../api";
import { AuthProvider } from "./useAuth";
import { AudienceProvider, useAudience } from "./useAudience";

const originals = { ...auth };
afterEach(() => { cleanup(); Object.assign(auth, originals); });

function Probe() {
  const { audience, saving, setAudience } = useAudience();
  const [error, setError] = useState("");
  return <>
    <div>Current: {audience}</div>
    <div>{saving ? "Preparing" : "Idle"}</div>
    {error && <div role="alert">{error}</div>}
    {(["personal", "business"] as const).map((level) => <button key={level} disabled={saving} onClick={() => {
      setError("");
      void setAudience(level).catch((error) => setError(error.message));
    }}>{level}</button>)}
  </>;
}

for (const target of ["personal", "business"] as const) {
  test(`${target} stays on the current interface until preparation succeeds and supports retry`, async () => {
    let level: InterfaceLevel = "developer";
    auth.me = mock(async () => ({ user_id: 1, email: "user@test.local", role: "user" as const, created_at: "", onboarded: true, interface_level: level }));
    let reject!: (error: Error) => void;
    auth.updatePreferences = mock(() => new Promise<Awaited<ReturnType<typeof auth.updatePreferences>>>((_, fail) => { reject = fail; }));
    const changed = mock(() => {});
    window.addEventListener("apteva:apps-changed", changed);
    try {
      render(<AuthProvider><AudienceProvider><Probe /></AudienceProvider></AuthProvider>);
      await waitFor(() => expect(auth.me).toHaveBeenCalled());
      fireEvent.click(screen.getByRole("button", { name: target }));
      await screen.findByText("Preparing");
      expect(screen.getByText("Current: developer")).toBeTruthy();
      expect(changed).not.toHaveBeenCalled();
      reject(new Error("Workspace preparation failed"));
      await screen.findByRole("alert");
      expect(screen.getByText("Current: developer")).toBeTruthy();
      expect((screen.getByRole("button", { name: target }) as HTMLButtonElement).disabled).toBe(false);
      let resolve!: () => void;
      auth.updatePreferences = mock(async () => {
        await new Promise<void>((done) => { resolve = done; });
        level = target;
        return { language: "en", interface_level: target, ui_layout: {}, ui_layout_revision: 0 };
      });
      fireEvent.click(screen.getByRole("button", { name: target }));
      await screen.findByText("Preparing");
      expect(screen.getByText("Current: developer")).toBeTruthy();
      resolve();
      await screen.findByText(`Current: ${target}`);
      await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
      expect(auth.updatePreferences).toHaveBeenCalledWith({ interface_level: target });
    } finally {
      window.removeEventListener("apteva:apps-changed", changed);
    }
  });
}
