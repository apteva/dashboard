import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { auth } from "../api";
import { APIKeysTab } from "./Settings";

const originals = { ...auth };
afterEach(() => { cleanup(); Object.assign(auth, originals); });

test("private keys default to read only and submit the selected permission", async () => {
  auth.listKeys = mock(async () => []);
  auth.createKey = mock(async (_name, options) => ({
    id: 1, key: "sk-test", prefix: "sk-test", kind: "private" as const,
    access: options?.access || "read_write" as const,
  }));
  render(<APIKeysTab />);
  const permissions = screen.getByLabelText("Permissions") as HTMLSelectElement;
  expect(permissions.value).toBe("read_only");
  fireEvent.change(screen.getByPlaceholderText("Key name"), { target: { value: "Inspection" } });
  fireEvent.click(screen.getByRole("button", { name: "New Key" }));
  await waitFor(() => expect(auth.createKey).toHaveBeenCalledWith("Inspection", { kind: "private", access: "read_only" }));
  await screen.findByText(/Save this read-only private key/);
  fireEvent.change(permissions, { target: { value: "read_write" } });
  fireEvent.change(screen.getByPlaceholderText("Key name"), { target: { value: "Automation" } });
  fireEvent.click(screen.getByRole("button", { name: "New Key" }));
  await waitFor(() => expect(auth.createKey).toHaveBeenCalledWith("Automation", { kind: "private", access: "read_write" }));
  await screen.findByText(/Save this read-write private key/);
});

test("key list distinguishes restricted and legacy keys and surfaces create failures", async () => {
  auth.listKeys = mock(async () => [
    { id: 1, name: "Monitor", key_prefix: "sk-ro", access: "read_only" as const, created_at: new Date().toISOString() },
    { id: 2, name: "Legacy", key_prefix: "sk-rw", created_at: new Date().toISOString() },
  ]);
  auth.createKey = mock(async () => { throw new Error("Creation denied"); });
  render(<APIKeysTab />);
  await screen.findByText("Read only · Your user permissions apply");
  await screen.findByText("Read & write · Your user permissions apply");
  fireEvent.change(screen.getByPlaceholderText("Key name"), { target: { value: "Denied" } });
  fireEvent.click(screen.getByRole("button", { name: "New Key" }));
  await screen.findByText("Creation denied");
  fireEvent.click(screen.getByRole("button", { name: "Scoped client" }));
  expect(screen.queryByLabelText("Permissions")).toBeNull();
});
