import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  // redirect() throws in production to unwind the request — mirror that here.
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));

const getClaimsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: getClaimsMock },
  }),
}));

import Home from "./page";

describe("Home redirect", () => {
  it("sends authenticated users to /dashboard", async () => {
    getClaimsMock.mockResolvedValueOnce({
      data: { claims: { sub: "u-1" } },
    });
    await expect(Home()).rejects.toThrow("__REDIRECT__:/dashboard");
  });

  it("sends unauthenticated users to /login", async () => {
    getClaimsMock.mockResolvedValueOnce({ data: null });
    await expect(Home()).rejects.toThrow("__REDIRECT__:/login");
  });
});
