import { useState } from "react";
import type { QnectorConfig } from "@qnector/shared";

const EXTENSION_URL =
  "https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk";

/** Opt-in diagnostics and one-click YouTube setup. Never opens or signs into a browser automatically. */
export function SocialConnections({
  config,
  onConfigChange,
}: {
  config: QnectorConfig | undefined;
  onConfigChange: (next: QnectorConfig) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [facebookReady, setFacebookReady] = useState(false);
  const youtubeEnabled = Boolean(
    config?.social?.enabled && config.social.platforms.includes("youtube"),
  );
  const facebookEnabled = Boolean(
    config?.social?.enabled && config.social.platforms.includes("facebook"),
  );

  async function inspectHealth(): Promise<void> {
    const result = await window.qnector.callTool("social", {
      action: "health",
    });
    if (!result.ok)
      throw new Error(result.error?.message ?? "Social health check failed.");
    const data = result.data as
      | { capabilities?: { youtubeRead?: boolean; facebookSearch?: boolean } }
      | undefined;
    setFacebookReady(data?.capabilities?.facebookSearch === true);
    setMessage(
      data?.capabilities?.youtubeRead
        ? "YouTube backend detected. Facebook requires a separately authorized Chrome/Edge extension session."
        : "YouTube is disabled or unavailable. Enable it to run an isolated backend health check.",
    );
  }

  async function toggleYouTube(): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      const saved = await window.qnector.toggleYouTubeSocial(!youtubeEnabled);
      onConfigChange(saved);
      if (youtubeEnabled) {
        setMessage(
          "YouTube reading disabled. Existing browser and connection unchanged.",
        );
      } else {
        await inspectHealth();
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Social setup failed; no change was saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleFacebook(): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      // Verification is requested by this explicit click only. It may navigate
      // the selected authenticated Chrome/Edge profile and change focus.
      const saved = await window.qnector.toggleFacebookSocial(!facebookEnabled);
      onConfigChange(saved);
      setFacebookReady(!facebookEnabled);
      setMessage(
        facebookEnabled
          ? "Facebook disabled. The browser session has not been modified."
          : "Facebook search verified against your manually authorized session and enabled. Recheck health after signing out.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Facebook verification failed; no settings were changed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function check(): Promise<void> {
    setBusy(true);
    try {
      await inspectHealth();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Health check failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="update-settings-card" aria-label="Social connections">
      <div className="update-card-header">
        <span className="update-card-icon">◎</span>
        <div className="update-card-copy">
          <span className="update-card-eyebrow">SOCIAL CONNECTIONS</span>
          <strong>Agent Reach: YouTube &amp; Facebook</strong>
          <small>
            Read-only integration. No automatic login or posting. An explicitly
            requested Facebook verification may navigate Chrome and change
            focus.
          </small>
        </div>
      </div>
      <p role="status">
        YouTube: {youtubeEnabled ? "Enabled" : "Off"} · Facebook:{" "}
        {facebookEnabled
          ? "Enabled (session was verified at setup; may expire)"
          : facebookReady
            ? "Backend detected; login unverified"
            : "Off / not verified"}
      </p>
      <div className="update-card-actions">
        <button
          type="button"
          disabled={busy || !config}
          onClick={() => void toggleYouTube()}
        >
          {busy
            ? "Checking…"
            : youtubeEnabled
              ? "Disable YouTube"
              : "Enable YouTube"}
        </button>
        <button
          type="button"
          disabled={busy || !config}
          onClick={() => void check()}
        >
          Check health
        </button>
      </div>
      <small>
        Facebook requires Chrome or Edge, the OpenCLI extension, and your manual
        sign-in. Zen support is unverified; Facebook remains off until an
        authenticated test passes.
      </small>
      <div className="update-card-actions">
        <button
          type="button"
          onClick={() => void window.qnector.openUrl(EXTENSION_URL)}
        >
          Open official extension setup
        </button>
        <button
          type="button"
          disabled={busy || !config}
          onClick={() => void toggleFacebook()}
        >
          {facebookEnabled
            ? "Disable Facebook"
            : "Verify & Enable Facebook (may open browser)"}
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
