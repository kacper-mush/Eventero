import { test, expect } from "@playwright/test";

test("home page renders the Eventero heading", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Eventero" }),
  ).toBeVisible();
});
