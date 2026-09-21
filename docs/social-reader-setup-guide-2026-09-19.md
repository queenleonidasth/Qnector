# QNECTOR Social Reader — local setup / troubleshooting

**Deployment:** The developer candidate is not installed in the currently running QNECTOR and is not a GitHub release. Keep the installed instance running until a separately authorized change window. The candidate currently carries the same `0.4.42` version label, so the in-app updater will not discover it as a newer version. Do not copy files into `C:\Program Files\Qnector` while the app runs. The verified candidate path is recorded in `docs/social-reader-delivery-report-2026-09-19.md`.

## YouTube (no browser login)

1. Once a tested candidate has been deliberately launched/installed without disrupting the old instance, open QNECTOR **Settings → Social Connections → Enable YouTube**.
2. The opt-in checks pinned Agent Reach/yt-dlp in `%LOCALAPPDATA%\Qnector\integrations\agent-reach\` and a local Node runtime before saving the setting. It never installs additional packages or changes system PATH.
3. Use `social.health`, then `social.read` with a valid HTTPS video URL or `social.search` with a search query. Transcript text is returned only if accessible subtitle cues were actually retrieved. Videos without accessible captions are marked `TRANSCRIPT_UNAVAILABLE`; video media is not downloaded.
4. To roll back, click **Disable YouTube**. It does not restart the app, disconnect MCP, delete dependencies or touch browser sessions.

## Facebook — requires explicit manual account authorization

This PC's last local check found only Zen running, no Chrome/Edge installation at standard paths, and OpenCLI extension disconnected. Do not assume Zen's Firefox extension model is compatible with the upstream Chrome-extension backend.

1. Install Google Chrome or Microsoft Edge through an official source manually if needed. Use a **separate chosen browser profile** for verification; do not grant QNECTOR unrestricted browser-cookie extraction.
2. In the chosen Chrome/Edge profile, manually open the pinned-upstream extension URL `https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk`, install/enable OpenCLI and sign in to Facebook yourself. Never send passwords, session tokens, exported cookies or profile files into ChatGPT.
3. If OpenCLI's local daemon is not connected, from a local user terminal deliberately run the pinned CLI doctor's command (this command may start its local daemon):
   `node "%LOCALAPPDATA%\Qnector\integrations\agent-reach\opencli\node_modules\@jackwener\opencli\dist\src\main.js" doctor`
   In PowerShell, expand the environment variable with: `node "$env:LOCALAPPDATA\Qnector\integrations\agent-reach\opencli\node_modules\@jackwener\opencli\dist\src\main.js" doctor`.
4. When connected and signed in, open the new candidate's **Settings → Social Connections → Verify & Enable Facebook**. This is an **explicit user-triggered live read-only search** and may navigate the selected Chrome browser / take foreground focus; perform it only when not gaming or doing other foreground-sensitive work. Success saves the Facebook opt-in. Failure preserves the old config and returns an actionable error.
5. Only `social.search(platform=facebook,query=...)` is implemented. Full feed, arbitrary post URLs, photo enumeration, comments, posting and durable social tasks remain unsupported. The backend may lose authorization when you sign out; reverify on a separate session. **Disable Facebook** removes the opt-in without logging you out or closing Chrome.

## Diagnostics / honesty gates

- `EXTENSION_DISCONNECTED`: Chrome extension or OpenCLI daemon not connected; manually inspect both.
- `AUTH_REQUIRED`: sign in in the selected profile manually; no auto-login.
- `BACKEND_UNAVAILABLE`: verify the isolated CLI and Agent Reach doctor; do not run `agent-reach install --system` automatically.
- `TRANSCRIPT_UNAVAILABLE`: this YouTube video has no accessible verified caption text; do not fabricate a transcript.
- The installed stable QNECTOR may not expose `social` at all: that means the new candidate has **not** yet been deployed. The source-level and packaged MCP tests are not equivalent to updating an already running install.
