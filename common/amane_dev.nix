{ pkgs }:

(pkgs.mkShell.override { stdenv = pkgs.useMoldLinker pkgs.stdenv; }) {
  nativeBuildInputs = with pkgs; [
    cargo
    rustc
    rustfmt
    clippy
    rust-analyzer
    pkg-config
    watchexec
    util-linux
  ];

  inherit (pkgs.amane) buildInputs LIBRARY_PATH;

  LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [
    pkgs.vulkan-loader
    pkgs.wayland
  ];
  CARGO_PROFILE_DEV_DEBUG = "line-tables-only";

  shellHook = ''
    export CARGO_TARGET_DIR="''${XDG_CACHE_HOME:-$HOME/.cache}/amane/target"
  '';
}
