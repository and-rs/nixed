{ pkgs, inputs }:
let
  commonPackages =
    (import ../common/terminal.nix { inherit pkgs inputs; })
    ++ (import ../common/tooling.nix { inherit pkgs; });

  hostIntegratedHyprlock = import ./hyprlock.nix { inherit pkgs; };
  hostIntegratedGoogleChrome = import ./google-chrome.nix { inherit pkgs; };
  privateFonts = import ../common/private-fonts.nix { inherit pkgs; };
in
pkgs.symlinkJoin {
  name = "user-tools";

  paths = commonPackages ++ [
    (pkgs.azure-cli.override {
      withExtensions = [ pkgs.azure-cli-extensions.azure-devops ];
    })
    (pkgs.rofi.override { plugins = [ pkgs.rofi-calc ]; })

    pkgs.jujutsu
    pkgs.podman
    pkgs.terraform

    pkgs.slurp
    pkgs.ffmpeg
    pkgs.gpu-screen-recorder
    pkgs.mpv

    pkgs.awww
    pkgs.niri
    pkgs.grim
    pkgs.satty
    pkgs.xremap
    pkgs.hypridle
    hostIntegratedHyprlock
    pkgs.playerctl
    pkgs.pwvucontrol
    pkgs.quickshell
    hostIntegratedGoogleChrome
    privateFonts
    pkgs.xwayland-satellite
    pkgs.kdePackages.qtdeclarative
    pkgs.xdg-desktop-portal-gnome
    pkgs.xdg-desktop-portal-gtk
    pkgs.xdg-desktop-portal
    pkgs.recursive
    pkgs.monaspace
    pkgs.maple-mono.truetype-autohint

    pkgs.uv
    pkgs.ty
    pkgs.ruff

    (pkgs.nixgl.nixGLCommon pkgs.nixgl.nixGLMesa)
  ];
}
