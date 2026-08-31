# Bundled ripgrep

Windows release builds bundle the official ripgrep executable for fast
`workspace.grep` searches.

- Version: 15.2.0 (`x86_64-pc-windows-msvc`)
- Source: <https://github.com/BurntSushi/ripgrep/releases/tag/15.2.0>
- Archive SHA-256:
  `71B2FEF860ABE467217A538FF31DE02F5258807C0129F771846F87BD029AAFC5`
- `rg.exe` SHA-256:
  `14231169855EC5205CF5A1B6F1DB358FF4AED4247C86B69CE8AAE647C77F6680`
- License: MIT or Unlicense, at the user's option.

The executable is a downloaded native build and is intentionally excluded from
Git. Place the verified `rg.exe` in this directory before running
`package:windows`.
