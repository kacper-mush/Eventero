import { test, expect } from "@playwright/test";

// E2E smoke for the Kanban tasks view inside a group. Mirrors the chat spec:
// signed-in session + workspace/group URL. Run locally only.
//
// Required env vars (skip otherwise):
//   E2E_GROUP_URL    full path like /dashboard/<wsId>/groups/<groupId>
//   E2E_STORAGE_STATE  path to a Playwright storageState JSON
//
// The test user MUST be a Group Manager or Workspace Admin/Owner of the
// target group, because only those roles can create tasks.

const groupUrl = process.env.E2E_GROUP_URL;
const storageState = process.env.E2E_STORAGE_STATE;

test.describe("group tasks", () => {
  test.skip(
    !groupUrl || !storageState,
    "Set E2E_GROUP_URL and E2E_STORAGE_STATE to run tasks e2e",
  );

  test.use({ storageState });

  test("creates a task and renders it in the TODO column", async ({ page }) => {
    await page.goto(`${groupUrl}?view=tasks`);

    // Switch via the tab if we didn't deep-link.
    const tasksTab = page.getByRole("tab", { name: /tasks/i });
    if (await tasksTab.isVisible()) {
      await tasksTab.click();
    }

    // Wait for the kanban surface (the column headers are enough).
    await expect(page.getByText("To do", { exact: false })).toBeVisible({
      timeout: 5000,
    });

    await page.getByRole("button", { name: /new task/i }).click();

    const title = `e2e task ${Date.now()}`;
    await page.getByLabel(/title/i).fill(title);
    await page.getByRole("button", { name: /^create$/i }).click();

    // The new card should appear inside the TODO column.
    const todoColumn = page
      .locator("div", { hasText: "To do" })
      .filter({ has: page.getByText(title) })
      .first();
    await expect(todoColumn).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(title)).toBeVisible();
  });
});
