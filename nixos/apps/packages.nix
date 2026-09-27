{ pkgs, ... }:
let
  apps = with pkgs; [
    helium-browser
    firefox

    prismlauncher
    picocrypt-cli
    showmethekey
    keepassxc
    localsend
    obsidian
    vesktop
    zathura
    spotify
  ];

  system = with pkgs; [
    inotify-tools
    brightnessctl
    appimage-run
    home-manager
    pwvucontrol
    efibootmgr
    alsa-utils
    libnotify
    playerctl
    powertop
    thermald
    pciutils
    nftables
    geeqie
    parted
    sbctl
    satty
    xrdb
    mpv
    dig
  ];

  codecs = with pkgs; [
    openh264
    ffmpeg
    x264
  ];
in
{
  programs.obs-studio = {
    enable = true;
    package = pkgs.obs-studio.override {
      cudaSupport = true;
    };
    plugins = [
      pkgs.obs-studio-plugins.wlrobs
      pkgs.obs-studio-plugins.obs-gstreamer
      pkgs.obs-studio-plugins.obs-vkcapture
      pkgs.obs-studio-plugins.obs-pipewire-audio-capture
      pkgs.obs-backgroundremoval
    ];
  };

  environment.systemPackages = apps ++ codecs ++ system;
}
