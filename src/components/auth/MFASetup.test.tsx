import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { auth } from "../../api";
import { MFASetup } from "./MFASetup";

const originalBegin = auth.beginMFAEnrollment;
const originalConfirm = auth.confirmMFAEnrollment;

afterEach(() => {
  cleanup();
  auth.beginMFAEnrollment = originalBegin;
  auth.confirmMFAEnrollment = originalConfirm;
});

describe("MFASetup", () => {
  test("enrolls an authenticator and reveals recovery codes once", async () => {
    const begin = mock(async () => ({
      type: "totp" as const,
      secret: "JBSWY3DPEHPK3PXP",
      otpauth_uri: "otpauth://totp/Apteva:test?secret=JBSWY3DPEHPK3PXP&issuer=Apteva",
    }));
    const confirm = mock(async () => ({
      enabled: true as const,
      recovery_codes: ["AAAA-BBBB-CCCC-DDDD", "EEEE-FFFF-GGGG-HHHH"],
    }));
    auth.beginMFAEnrollment = begin as typeof auth.beginMFAEnrollment;
    auth.confirmMFAEnrollment = confirm as typeof auth.confirmMFAEnrollment;
    const onEnabled = mock(() => undefined);

    render(<MFASetup onEnabled={onEnabled} />);
    fireEvent.input(screen.getByLabelText("Confirm your current password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set up authenticator" }));

    await waitFor(() => expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeTruthy());
    expect(begin).toHaveBeenCalledWith("password123");
    fireEvent.input(screen.getByLabelText("Authentication code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify and enable" }));

    await waitFor(() => expect(screen.getByText("Two-factor authentication is enabled")).toBeTruthy());
    expect(confirm).toHaveBeenCalledWith("123456");
    expect(screen.getByText("AAAA-BBBB-CCCC-DDDD")).toBeTruthy();
    expect(screen.getByText("EEEE-FFFF-GGGG-HHHH")).toBeTruthy();
    expect(onEnabled).toHaveBeenCalledTimes(1);
  });
});
