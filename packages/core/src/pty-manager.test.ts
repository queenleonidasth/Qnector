import { describe, expect, test } from "vitest";
import { PtyManager } from "./pty-manager.js";

const windowsTest = process.platform === "win32" ? test : test.skip;

describe("P23 interactive PTY", () => {
  windowsTest(
    "runs an interactive Windows ConPTY session with input and resize",
    async () => {
      const manager = new PtyManager("cmd");
      const started = await manager.start({
        cwd: process.cwd(),
        shell: "cmd",
        cols: 80,
        rows: 24,
      });

      try {
        expect(started.state).toBe("running");
        expect(started.pid).toBeGreaterThan(0);

        manager.write(started.id, "@set /p P23_VALUE=P23_PROMPT:", true);
        await delay(100);
        manager.write(started.id, "QNECTOR23", true);
        manager.write(started.id, "@echo P23_INTERACTIVE_%P23_VALUE%", true);

        const output = await waitForText(
          manager,
          started.id,
          "P23_INTERACTIVE_QNECTOR23",
        );
        expect(output).toContain("P23_INTERACTIVE_QNECTOR23");

        const resized = manager.resize(started.id, 132, 40);
        expect(resized.cols).toBe(132);
        expect(resized.rows).toBe(40);
        expect(manager.list().some((entry) => entry.id === started.id)).toBe(
          true,
        );
      } finally {
        const closed = await manager.close(started.id);
        expect(closed.state).toBe("stopped");
      }
    },
    10_000,
  );
});

async function waitForText(
  manager: PtyManager,
  ptyId: string,
  expected: string,
): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const output = manager.read(ptyId, 0, 100_000);
    if (output.text.includes(expected)) return output.text;
    if (output.state !== "running")
      throw new Error(
        `PTY exited before '${expected}' appeared: ${output.text}`,
      );
    await delay(25);
  }
  const output = manager.read(ptyId, 0, 100_000);
  throw new Error(`Timed out waiting for '${expected}': ${output.text}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
