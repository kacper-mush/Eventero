import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let clickCount = 0;

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => Promise.resolve({ count: clickCount, error: null }),
      insert: () => {
        clickCount += 1;
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

import Home from "./page";

describe("Home", () => {
  beforeEach(() => {
    clickCount = 0;
  });

  it("loads the initial click count and increments on click", async () => {
    const user = userEvent.setup();
    render(<Home />);

    expect(await screen.findByText("0 clicks worldwide")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Click" }));

    expect(await screen.findByText("1 clicks worldwide")).toBeDefined();
  });
});
