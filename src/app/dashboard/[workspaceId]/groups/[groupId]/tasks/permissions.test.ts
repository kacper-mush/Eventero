import { describe, expect, it } from "vitest";

import {
  canChangeReporter,
  canCreateTask,
  canEditMeta,
  canSetAssignee,
} from "./permissions";
import type { TaskRow } from "./actions";

const MEMBER = "u-member";
const OTHER = "u-other";
const MANAGER = "u-manager";
const ADMIN = "u-admin";

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "t-1",
    group_id: "g-1",
    title: "Task",
    description: null,
    status: "TODO",
    assignee_id: null,
    reporter_id: MANAGER,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const memberViewer = {
  userId: MEMBER,
  isGroupManager: false,
  isWorkspaceAdmin: false,
};
const managerViewer = {
  userId: MANAGER,
  isGroupManager: true,
  isWorkspaceAdmin: false,
};
const adminViewer = {
  userId: ADMIN,
  isGroupManager: false,
  isWorkspaceAdmin: true,
};

describe("canCreateTask", () => {
  it("allows managers and workspace admins", () => {
    expect(canCreateTask(managerViewer)).toBe(true);
    expect(canCreateTask(adminViewer)).toBe(true);
  });
  it("blocks plain members", () => {
    expect(canCreateTask(memberViewer)).toBe(false);
  });
});

describe("canSetAssignee", () => {
  it("lets a member self-assign into an empty slot", () => {
    const task = makeTask({ assignee_id: null });
    expect(canSetAssignee(task, memberViewer, MEMBER)).toBe(true);
  });

  it("blocks a member from assigning someone else", () => {
    const task = makeTask({ assignee_id: null });
    expect(canSetAssignee(task, memberViewer, OTHER)).toBe(false);
  });

  it("blocks a member from clearing or reassigning a filled slot", () => {
    const task = makeTask({ assignee_id: OTHER });
    expect(canSetAssignee(task, memberViewer, MEMBER)).toBe(false);
    expect(canSetAssignee(task, memberViewer, null)).toBe(false);
  });

  it("lets a manager assign anyone or unassign", () => {
    const task = makeTask({ assignee_id: OTHER });
    expect(canSetAssignee(task, managerViewer, OTHER)).toBe(true);
    expect(canSetAssignee(task, managerViewer, MEMBER)).toBe(true);
    expect(canSetAssignee(task, managerViewer, null)).toBe(true);
  });

  it("lets a workspace admin assign anyone", () => {
    const task = makeTask({ assignee_id: null });
    expect(canSetAssignee(task, adminViewer, OTHER)).toBe(true);
  });
});

describe("canEditMeta", () => {
  it("allows the current reporter, managers, and admins", () => {
    const task = makeTask({ reporter_id: MEMBER });
    expect(canEditMeta(task, memberViewer)).toBe(true);
    expect(canEditMeta(task, managerViewer)).toBe(true);
    expect(canEditMeta(task, adminViewer)).toBe(true);
  });

  it("blocks a member who is neither manager nor reporter", () => {
    const task = makeTask({ reporter_id: OTHER });
    expect(canEditMeta(task, memberViewer)).toBe(false);
  });
});

describe("canChangeReporter", () => {
  it("allows only group managers", () => {
    const task = makeTask();
    expect(canChangeReporter(task, managerViewer)).toBe(true);
    expect(canChangeReporter(task, adminViewer)).toBe(false);
    expect(canChangeReporter(task, memberViewer)).toBe(false);
  });
});
