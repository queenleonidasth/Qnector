import { describe, expect, it } from "vitest";
import { clearDocumentSessions, withDocumentSession } from "./document-session.js";

describe("document sessions", () => {
  it("deduplicates concurrent reads and caches only the same revision", async () => {
    clearDocumentSessions();
    let loads = 0;
    const loader = async () => { loads += 1; await Promise.resolve(); return { text: "สวัสดี" }; };
    const [a, b] = await Promise.all([
      withDocumentSession("/a.pdf", "sha-a|page=1", loader),
      withDocumentSession("/a.pdf", "sha-a|page=1", loader),
    ]);
    expect(a).toEqual(b);
    expect(loads).toBe(1);
    expect((await withDocumentSession("/a.pdf", "sha-b|page=1", loader)).text).toBe("สวัสดี");
    expect(loads).toBe(2);
  });
});
