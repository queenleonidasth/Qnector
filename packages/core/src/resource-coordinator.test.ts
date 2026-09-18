import { describe, expect, it } from "vitest";
import {
  ResourceCoordinator,
  normalizeResource,
  resourcesOverlap,
} from "./resource-coordinator.js";

describe("shared file mutation coordination", () => {
  it("serializes competing operations on the same file while permitting unrelated files", async () => {
    const coordinator = new ResourceCoordinator();
    const events: string[] = [];
    let unlock!: () => void;
    const hold = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const first = coordinator.withResources(
      "C:/workspace",
      ["a.txt"],
      "one",
      async () => {
        events.push("first-start");
        await hold;
        events.push("first-end");
      },
    );
    await Promise.resolve();
    const second = coordinator.withResources(
      "C:/workspace",
      ["a.txt"],
      "two",
      async () => {
        events.push("second-start");
      },
    );
    const third = coordinator.withResources(
      "C:/workspace",
      ["b.txt"],
      "three",
      async () => {
        events.push("other-start");
      },
    );
    await third;
    expect(events).toContain("other-start");
    expect(events).not.toContain("second-start");
    unlock();
    await Promise.all([first, second]);
    expect(events.indexOf("first-end")).toBeLessThan(
      events.indexOf("second-start"),
    );
  });
  it("normalizes paths and locks nested resources without blocking unrelated names", () => {
    const root = normalizeResource(process.cwd(), "src");
    const nested = normalizeResource(process.cwd(), "src/main.ts");
    const sibling = normalizeResource(process.cwd(), "src-extra/main.ts");
    expect(resourcesOverlap(root, nested)).toBe(true);
    expect(resourcesOverlap(root, sibling)).toBe(false);
  });
});
