{ pkgs, ... }:
{
  imports = [
    ./hardware-configuration.nix
    ./networking/networkd.nix

    ./apps/nixos-utils.nix
    ./apps/packages.nix

    # ./desktop/dev-testing/cosmic.nix
    # ./desktop/dev-testing/x11.nix
    ./desktop/directories.nix
    ./desktop/environment.nix
    ./desktop/xremap.nix
    ./desktop/nvidia.nix
    ./desktop/fonts.nix
    ./desktop/asus.nix
    ./desktop/tlp.nix
    ./desktop/ly.nix
  ];
  programs.nix-ld.enable = true;

  zramSwap.enable = true;
  zramSwap.memoryPercent = 50;

  boot.loader = {
    systemd-boot.enable = false;
    limine = {
      enable = true;
      efiSupport = true;
      secureBoot.enable = true;
      style = {
        wallpapers = [ ];
        wallpaperStyle = "centered";
        interface = {
          branding = "Code Manufacturer";
        };
        backdrop = "00000000";
        graphicalTerminal = {
          background = "00000000";
          foreground = "ffffffff";
          brightBackground = "00000000";
          brightForeground = "ffffffff";
          brightPalette = "1b1e25;ffc0b9;b3f6c0;fce094;a6dbff;ffcaff;8cf8f7;eef1f8";
          palette = "1b1e25;ffc0b9;b3f6c0;fce094;a6dbff;ffcaff;8cf8f7;eef1f8";
        };
      };
    };
    efi.canTouchEfiVariables = false;
  };

  hardware.bluetooth.enable = true;
  hardware.bluetooth.powerOnBoot = false;

  security.pki.certificates = [ ];

  environment.variables = {
    SSL_CERT_FILE = "/etc/ssl/certs/ca-certificates.crt";
    CURL_CA_BUNDLE = "/etc/ssl/certs/ca-certificates.crt";
  };

  time.timeZone = "America/Bogota";
  i18n.defaultLocale = "en_US.UTF-8";

  time.hardwareClockInLocalTime = true;
  i18n.extraLocaleSettings = {
    LC_ADDRESS = "es_CO.UTF-8";
    LC_IDENTIFICATION = "es_CO.UTF-8";
    LC_MEASUREMENT = "es_CO.UTF-8";
    LC_MONETARY = "es_CO.UTF-8";
    LC_NAME = "es_CO.UTF-8";
    LC_NUMERIC = "es_CO.UTF-8";
    LC_PAPER = "es_CO.UTF-8";
    LC_TELEPHONE = "es_CO.UTF-8";
    LC_TIME = "es_CO.UTF-8";
  };

  security.rtkit.enable = true;

  services.pipewire = {
    enable = true;
    alsa.enable = true;
    pulse.enable = true;
    alsa.support32Bit = true;
    wireplumber.enable = true;
  };

  users.users.and-rs = {
    shell = pkgs.zsh;
    isNormalUser = true;
    description = "and-rs";
    extraGroups = [
      "wheel"
      "docker"
    ];
  };

  programs = {
    zsh.enable = true;
    dconf.enable = true;
    noisetorch.enable = true;
    gnupg.agent.enable = true;
    gnupg.agent.enableSSHSupport = true;
  };

  services = {
    gvfs.enable = true;
    tumbler.enable = true;
    openssh.enable = true;
    thermald.enable = true;
    gnome.gnome-keyring.enable = true;
    logind.settings.Login = {
      HandlePowerKey = "suspend";
      HandleLidSwitch = "suspend";
      HandleSuspendKey = "suspend";
    };
  };

  system.stateVersion = "25.05"; # do not change at all
}
