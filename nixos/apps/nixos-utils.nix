{
  pkgs,
  config,
  ...
}:
{
  environment.systemPackages = with pkgs; [
    # terminal
    tailwindcss_4
    file
    glab
    dex
    bc

    kdePackages.qt6ct
    kdePackages.qtbase
    kdePackages.qttools
    kdePackages.qtdeclarative

    # needed for winboat
    freerdp
    docker-compose

    libcxx.dev
    stdenv.cc.cc.lib
    stdenv.cc
    stdenv
    zlib
  ];

  # compiling flags needed for nixos
  environment.sessionVariables = {
    AR = "${pkgs.stdenv.cc.bintools}/bin/ar";
    CC = "${pkgs.stdenv.cc}/bin/gcc";
    CXXFLAGS = "-O2 -D_GNU_SOURCE";
    CFLAGS = "-O2 -D_GNU_SOURCE";
  };

  virtualisation.docker = {
    package = pkgs.docker_29;
    rootless = {
      enable = true;
      setSocketVariable = true;
    };
  };
}
