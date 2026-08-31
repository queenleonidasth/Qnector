# Native tools

The Windows package bundles native tools from this directory, but the binaries
are generated or downloaded locally and are intentionally not committed:

- `uia-helper/publish/qnector-uia.exe` is produced by
  `dotnet publish tools/uia-helper/Qnector.UiaHelper.csproj -c Release -r win-x64 --self-contained true`.
- `everything-cli/es.exe` is the Voidtools Everything CLI executable.
- `tunnel-client/cloudflared.exe` and `tunnel-client/tunnel-client.exe` are
  platform binaries used by the optional tunnel transports.

Run `pnpm package:windows` on a Windows development machine after installing
or generating these assets. The source code, manifests, licenses, and SBOM
metadata remain versioned here; large executable files are excluded to keep
the Git repository within GitHub's file-size limits.
