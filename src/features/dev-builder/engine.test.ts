import { describe, expect, it } from "vitest";
import published from "./generated/builder-config.json";
import { alignNode, findNode, moveNode, resizeNode } from "./engine";
import { validateBuilderDocument } from "./validation";
import type { BuilderDocument } from "./types";

const base = published as BuilderDocument;

describe("dev builder layout engine", () => {
  it("moves nodes while respecting the viewport", () => {
    const moved = moveNode(base, "finance-card", "mobile", 9999, 9999, 8);
    const node = findNode(moved, "finance-card")!;
    expect(node.frames.mobile.x).toBeLessThanOrEqual(40);
    expect(node.frames.mobile.y).toBeLessThanOrEqual(634);
  });

  it("resizes nodes with a minimum size", () => {
    const resized = resizeNode(base, "finance-card", "mobile", 1, 2, 1);
    const node = findNode(resized, "finance-card")!;
    expect(node.frames.mobile.width).toBe(40);
    expect(node.frames.mobile.height).toBe(40);
  });

  it("aligns a node to the horizontal center", () => {
    const aligned = alignNode(base, "finance-card", "mobile", "center-x");
    const node = findNode(aligned, "finance-card")!;
    expect(node.frames.mobile.x).toBe(20);
  });

  it("validates the published starter document", () => {
    expect(validateBuilderDocument(base).filter((issue) => issue.level === "error")).toHaveLength(0);
  });
});
