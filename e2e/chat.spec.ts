import { test, expect } from "@playwright/test";

// End-to-end smoke for the group chat view. This relies on a signed-in
// session pointing at a workspace + group that the test user belongs to.
// CI doesn't gate on the e2e suite yet — these are local-only.
//
// Required env vars (skip otherwise):
//   E2E_GROUP_URL    full path like /dashboard/<wsId>/groups/<groupId>
//   E2E_SESSION_COOKIE  base64 JSON of the Supabase auth cookie payload, OR
//   E2E_STORAGE_STATE   path to a Playwright storageState JSON
//
// The simplest local setup is to sign in once with `npx playwright codegen`,
// save storage state, then export E2E_STORAGE_STATE before running this.

const groupUrl = process.env.E2E_GROUP_URL;
const storageState = process.env.E2E_STORAGE_STATE;

test.describe("group chat", () => {
  test.skip(
    !groupUrl || !storageState,
    "Set E2E_GROUP_URL and E2E_STORAGE_STATE to run chat e2e",
  );

  test.use({ storageState });

  test("sends a message and renders it in the chat", async ({ page }) => {
    await page.goto(groupUrl!);

    const composer = page.getByPlaceholder(/Message/i);
    await composer.waitFor({ state: "visible" });

    const body = `e2e hello ${Date.now()}`;
    await composer.fill(body);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText(body, { exact: false })).toBeVisible({
      timeout: 5000,
    });
  });
});
