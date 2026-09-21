import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, resolve } from "node:path";

export const MAX_COMMAND_OUTPUT = 256 * 1024;
const ALLOWED_NAMES = new Set([
  "agent-reach.exe",
  "agent-reach",
  "yt-dlp.exe",
  "yt-dlp",
  "opencli.exe",
  "opencli",
]);
const OPENCLI_ENTRY =
  /[\\/]node_modules[\\/]@jackwener[\\/]opencli[\\/]dist[\\/]src[\\/]main\.js$/i;

function opencliPackageRoot(file: string): string | null {
  return OPENCLI_ENTRY.test(file) ? resolve(dirname(file), "../..") : null;
}

/** A JS entry is executable only after verifying the exact pinned upstream package. */
export async function checkedExecutable(
  executable?: string,
): Promise<string | null> {
  if (!executable || !isAbsolute(executable)) return null;
  const pkg = opencliPackageRoot(executable);
  if (!pkg && !ALLOWED_NAMES.has(basename(executable).toLowerCase()))
    return null;
  try {
    if (!(await stat(executable)).isFile()) return null;
    if (pkg) {
      const parsed: unknown = JSON.parse(
        await readFile(resolve(pkg, "package.json"), "utf8"),
      );
      if (
        !parsed ||
        typeof parsed !== "object" ||
        (parsed as Record<string, unknown>).name !== "@jackwener/opencli" ||
        (parsed as Record<string, unknown>).version !== "1.8.7"
      )
        return null;
    }
    return executable;
  } catch {
    return null;
  }
}

export async function checkedNode(file?: string): Promise<string | null> {
  if (
    !file ||
    !isAbsolute(file) ||
    !["node.exe", "node"].includes(basename(file).toLowerCase())
  )
    return null;
  try {
    return (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

export interface SocialExecOptions {
  /** Explicitly selected Node binary for isolated OpenCLI and YouTube JS. */
  nodePath?: string;
  /** Selected OpenCLI entry; used only to expose the sibling bin for read-only doctor. */
  opencliPath?: string;
}

/** Execute only a vetted executable and literal argument array, never a shell. */
export async function socialExec(
  executable: string,
  argv: string[],
  timeoutMs = 12000,
  signal?: AbortSignal,
  options: SocialExecOptions = {},
): Promise<string> {
  if (!(await checkedExecutable(executable)))
    throw new Error(
      "NOT_INSTALLED: Select a vetted absolute executable path in social config.",
    );
  if (argv.some((arg) => arg.length > 4096 || arg.includes("\0")))
    throw new Error("INVALID_INPUT: Command argument too long.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000)
    throw new Error("INVALID_INPUT: Invalid social timeout.");
  const node = await checkedNode(options.nodePath);
  const entryRoot = opencliPackageRoot(executable);
  if (entryRoot && !node)
    throw new Error(
      "NOT_INSTALLED: A selected absolute Node.js executable is required for OpenCLI.",
    );
  let opencliBin: string | undefined;
  if (options.opencliPath) {
    const selected = await checkedExecutable(options.opencliPath);
    const pkg = selected ? opencliPackageRoot(selected) : null;
    if (!pkg)
      throw new Error("NOT_INSTALLED: Select the pinned OpenCLI npm entry.");
    opencliBin = resolve(pkg, "../../.bin");
  }
  const paths = [
    dirname(executable),
    ...(entryRoot ? [resolve(entryRoot, "../../.bin")] : []),
    ...(opencliBin ? [opencliBin] : []),
    ...(node ? [dirname(node)] : []),
  ];
  const env: NodeJS.ProcessEnv = {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    PATH: [...new Set(paths)].join(delimiter),
  };
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(
      entryRoot ? node! : executable,
      entryRoot ? [executable, ...argv] : argv,
      {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      },
    );
    let stdout = "";
    let stderr = "";
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      error ? rejectPromise(error) : resolvePromise(stdout);
    };
    const abort = () => {
      child.kill();
      finish(new Error("CANCELED: Social request canceled."));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("TIMEOUT: Social backend exceeded time limit."));
    }, timeoutMs);
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    const collect = (chunk: Buffer, channel: "stdout" | "stderr") => {
      if (channel === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
      if (
        Buffer.byteLength(stdout) > MAX_COMMAND_OUTPUT ||
        Buffer.byteLength(stderr) > 4096
      ) {
        child.kill();
        finish(new Error("PARTIAL: Backend output exceeded safety limit."));
      }
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
    child.once("error", () =>
      finish(new Error("BACKEND_UNAVAILABLE: Social backend could not start.")),
    );
    child.once("close", (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(
              /429|rate.limit|captcha/i.test(stderr)
                ? "RATE_LIMITED: Wait for the platform limit or manual challenge resolution."
                : /login|auth|401|403/i.test(stderr)
                  ? "AUTH_REQUIRED: Sign in using the authorized Chrome profile manually."
                  : /extension|daemon|connection refused/i.test(stderr)
                    ? "EXTENSION_DISCONNECTED: Connect the OpenCLI Chrome extension manually."
                    : "BACKEND_UNAVAILABLE: Social backend failed; run local doctor.",
            ),
      ),
    );
  });
}

export function validatedSocialUrl(
  raw: string,
  platform: "youtube" | "facebook",
): string {
  if (!raw || raw.length > 2048 || /[\u0000-\u001f]/.test(raw))
    throw new Error("INVALID_INPUT: URL is invalid.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("INVALID_INPUT: URL is invalid.");
  }
  const hosts =
    platform === "youtube"
      ? new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"])
      : new Set(["facebook.com", "www.facebook.com", "m.facebook.com"]);
  if (
    url.protocol !== "https:" ||
    !hosts.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.searchParams.has("access_token")
  )
    throw new Error(
      "INVALID_INPUT: Only canonical HTTPS platform URLs without credentials are allowed.",
    );
  if (platform === "youtube") {
    const id =
      url.hostname === "youtu.be"
        ? url.pathname.slice(1)
        : url.pathname === "/watch"
          ? url.searchParams.get("v")
          : url.pathname.startsWith("/shorts/")
            ? url.pathname.slice(8)
            : null;
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id))
      throw new Error(
        "INVALID_INPUT: A canonical YouTube video URL is required.",
      );
    return `https://www.youtube.com/watch?v=${id}`;
  }
  url.search = "";
  return url.toString();
}
