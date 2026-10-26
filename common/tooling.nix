{ pkgs }:
with pkgs;
[
  deno
  biome
  corepack
  rustywind
  pnpm-shell-completion
  railway
  xmlstarlet

  vtsls
  typescript
  vscode-langservers-extracted
  tailwindcss-language-server

  lua
  stylua
  lua-language-server
  luajitPackages.luarocks

  go
  gopls
  gotmplfmt

  hurl
  curl
  shfmt
  beautysh
  shellcheck
  bash-language-server

  marksman
  tinymist
  typstyle
  typst

  qsv
  miller
  csvdiff
  csvlens

  gcc
  just
  cmake
  ninja
  gnumake
  pkg-config
  rustup

  buf
  nil
  sleek
  nixfmt
  kdlfmt
  ast-grep
  tree-sitter
  glsl_analyzer

  yamlfmt
  yaml-language-server

  zig
  zls
  zig-shell-completions

  clang-tools
  lldb
  gdb
]
