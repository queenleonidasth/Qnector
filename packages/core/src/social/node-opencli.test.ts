import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkedExecutable, socialExec } from "./command-runner.js";
import { facebookSearch } from "./adapters/opencli.js";

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("isolated OpenCLI process", () => {
  it("allows only a verified pinned npm entry and spawns Node with literal argv, never a shell", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-opencli-test-"));
    const pkg = path.join(root, "node_modules", "@jackwener", "opencli");
    const src = path.join(pkg, "dist", "src");
    await mkdir(src, { recursive: true });
    await writeFile(
      path.join(pkg, "package.json"),
      JSON.stringify({
        name: "@jackwener/opencli",
        version: "1.8.7",
        type: "module",
      }),
    );
    const entry = path.join(src, "main.js");
    await writeFile(
      entry,
      "process.stdout.write(JSON.stringify(process.argv.slice(2)))",
    );
    expect(await checkedExecutable(entry)).toBe(entry);
    expect(await checkedExecutable(path.join(src, "other.js"))).toBeNull();
    const output = await socialExec(
      entry,
      ["facebook", "search", "x;echo INJECTION"],
      5000,
      undefined,
      { nodePath: process.execPath },
    );
    expect(JSON.parse(output)).toEqual([
      "facebook",
      "search",
      "x;echo INJECTION",
    ]);
  });

  it("parses actual OpenCLI YAML array, retaining only validated Facebook URLs", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-opencli-test-"));
    const pkg = path.join(root, "node_modules", "@jackwener", "opencli");
    const src = path.join(pkg, "dist", "src");
    await mkdir(src, { recursive: true });
    await writeFile(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "@jackwener/opencli", version: "1.8.7" }),
    );
    const entry = path.join(src, "main.js");
    const fixture =
      "- index: 1\n  title: Verified result\n  text: Safe excerpt\n  url: https://www.facebook.com/example\n- index: 2\n  title: Unsafe result\n  url: https://facebook.com.evil.test/phish\n";
    await writeFile(entry, `process.stdout.write(${JSON.stringify(fixture)})`);
    const result = await facebookSearch(
      entry,
      "example;echo INJECTION",
      2,
      5000,
      undefined,
      process.execPath,
    );
    expect(result.completeness).toBe("PARTIAL");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.url).toBe("https://www.facebook.com/example");
    expect(result.items[0]?.excerpt).toBe("Safe excerpt");
  });

  it("fails closed on an unexpected OpenCLI response shape", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-opencli-test-"));
    const pkg = path.join(root, "node_modules", "@jackwener", "opencli");
    const src = path.join(pkg, "dist", "src");
    await mkdir(src, { recursive: true });
    await writeFile(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "@jackwener/opencli", version: "1.8.7" }),
    );
    const entry = path.join(src, "main.js");
    await writeFile(entry, 'process.stdout.write("unexpected: object\\n")');
    await expect(
      facebookSearch(entry, "example", 2, 5000, undefined, process.execPath),
    ).rejects.toThrow("CONTENT_UNAVAILABLE");
  });
});
