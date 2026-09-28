{
  config,
  lib,
  pkgs,
  ...
}:
let
  disableDBus =
    pkg:
    pkg.overrideAttrs (old: {
      postInstall = (old.postInstall or "") + ''
        for file in $out/share/applications/*.desktop; do
          substituteInPlace "$file" \
            --replace "DBusActivatable=true" "DBusActivatable=false"
        done
      '';
    });
in
{
  services.dbus.implementation = "broker";
  services.gnome.tinysparql.enable = true;
  services.gnome.localsearch.enable = true;

  xdg.portal = {
    enable = true;
    xdgOpenUsePortal = true;
    config = {
      niri = {
        default = [
          "gnome"
          "gtk"
        ];
        "org.freedesktop.impl.portal.FileChooser" = [ "gtk" ];
      };
    };
    extraPortals = [
      pkgs.xdg-desktop-portal-gnome
      pkgs.xdg-desktop-portal-gtk
    ];
  };

  services.upower.enable = true;
  # Use the normal NixOS system profile rather than Hyprland's default PATH.
  systemd.user.services.hypridle.path = lib.mkForce [
    config.system.path
  ];

  programs = {
    dconf.enable = true;
    niri.useNautilus = true;
    hyprlock.enable = true;
    niri.enable = true;
    steam = {
      enable = true;
      remotePlay.openFirewall = true;
      dedicatedServer.openFirewall = true;
      localNetworkGameTransfers.openFirewall = true;
    };
  };

  environment.sessionVariables = {
    LIBVA_DRIVER_NAME = "iHD";
    NIXOS_OZONE_WL = "1";
  };

  environment.systemPackages = with pkgs; [
    (disableDBus pkgs.nautilus)

    (rofi.override { plugins = [ rofi-calc ]; })
    libqalculate

    xwayland-satellite
    wl-clipboard
    wf-recorder
    quickshell
    xwayland
    upower
    slurp
    grim
    awww
  ];
}
