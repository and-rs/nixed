{ pkgs, ... }:
{
  imports = [
    ./macos-utils.nix
    ./blocklist.nix
    ./apps/helium.nix
  ];

  programs.direnv = {
    package = pkgs.direnv;
    nix-direnv = {
      enable = true;
      package = pkgs.nix-direnv;
    };
  };

  users.users.and-rs = {
    name = "and-rs";
    home = "/Users/index/";
  };

  nix.package = pkgs.nix;
  environment.darwinConfig = "$HOME/Vault/personal/nixos/flake.nix";

  nixpkgs = {
    config.allowBroken = true; # grit is marked as broken in darwin
    hostPlatform = "aarch64-darwin";
  };

  system = {
    stateVersion = 4;
    primaryUser = "and-rs";
  };
}
