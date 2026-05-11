import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        exchangeCodeForSession,
      },
    }),
}));

import { GET } from "./route";

describe("auth callback route", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    exchangeCodeForSession.mockResolvedValue({ error: null });
  });

  it("redirects to safe next path after successful exchange", async () => {
    const response = await GET(
      new Request("https://eventero.test/auth/callback?code=ok&next=%2Fevent") as never,
    );

    expect(response.headers.get("location")).toBe("https://eventero.test/event");
  });

  it("falls back to / when next is invalid", async () => {
    const response = await GET(
      new Request(
        "https://eventero.test/auth/callback?code=ok&next=%2F%2Fevil.example",
      ) as never,
    );

    expect(response.headers.get("location")).toBe("https://eventero.test/");
  });

  it("redirects to login with error when exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "nope" } });

    const response = await GET(
      new Request("https://eventero.test/auth/callback?code=bad") as never,
    );

    expect(response.headers.get("location")).toBe(
      "https://eventero.test/login?error=auth_callback_failed",
    );
  });
});
