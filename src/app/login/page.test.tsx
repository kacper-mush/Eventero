import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { signInWithOtp } = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithOtp,
    },
  }),
}));

import LoginPage from "./page";

describe("LoginPage", () => {
  beforeEach(() => {
    signInWithOtp.mockReset();
  });

  it("submits magic-link sign-in and shows the sent state", async () => {
    signInWithOtp.mockResolvedValue({ error: null });

    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "alice@example.com");
    await user.click(screen.getByRole("button", { name: "Send magic link" }));

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "alice@example.com",
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    expect(await screen.findByText("alice@example.com")).toBeDefined();
    expect(await screen.findByText(/for a sign-in link\./)).toBeDefined();
  });

  it("shows API error message when sign-in fails", async () => {
    signInWithOtp.mockResolvedValue({ error: { message: "Auth failed" } });

    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "alice@example.com");
    await user.click(screen.getByRole("button", { name: "Send magic link" }));

    expect(await screen.findByText("Auth failed")).toBeDefined();
  });
});
