{ pkgs, inputs }:
let
  stablePkgs = inputs.stable.legacyPackages.${pkgs.stdenv.hostPlatform.system};

  commonPackages =
    (import ../common/terminal.nix { inherit pkgs inputs; })
    ++ (import ../common/tooling.nix { inherit pkgs; });

  hostIntegratedHyprlock = import ./hyprlock.nix { inherit pkgs; };
  hostIntegratedGoogleChrome = import ./google-chrome.nix { inherit pkgs; };
in
pkgs.symlinkJoin {
  name = "user-tools";

  paths = commonPackages ++ [
    (stablePkgs.azure-cli.override {
      withExtensions = [ stablePkgs.azure-cli-extensions.azure-devops ];
    })
    (pkgs.rofi.override { plugins = [ pkgs.rofi-calc ]; })

    pkgs.jujutsu
    pkgs.podman
    pkgs.terraform

    pkgs.gpu-screen-recorder
    pkgs.ffmpeg
    pkgs.slurp
    pkgs.mpv

    pkgs.awww
    pkgs.niri
    pkgs.grim
    pkgs.satty
    pkgs.xremap
    pkgs.zathura
    pkgs.hypridle
    hostIntegratedHyprlock
    pkgs.playerctl
    pkgs.pwvucontrol
    pkgs.quickshell
    hostIntegratedGoogleChrome
    pkgs.inter
    pkgs.xwayland-satellite
    pkgs.kdePackages.qtdeclarative
    pkgs.xdg-desktop-portal-gnome
    pkgs.xdg-desktop-portal-gtk
    pkgs.xdg-desktop-portal

    # fonts
    pkgs.recursive
    pkgs.monaspace
    pkgs.fragment-mono
    pkgs.commit-mono
    pkgs.maple-mono.truetype-autohint

    pkgs.uv
    pkgs.ty
    pkgs.ruff

    (pkgs.nixgl.nixGLCommon pkgs.nixgl.nixGLMesa)
  ];
}
