{ pkgs, inputs, ... }:
{
  imports = [
    ./yt-dlp.nix
    ./python.nix
  ];

  environment.systemPackages =
    (import ./terminal.nix { inherit pkgs inputs; })
    ++ (import ./tooling.nix { inherit pkgs; });
  environment.pathsToLink = [ "/share/direnv-instant" ];

  nix.settings.warn-dirty = false;
  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];
  nixpkgs.config.allowUnfree = true;
  nix.optimise.automatic = true;

  nix.settings.download-buffer-size = 1 * 1024 * 1024 * 1024;
}
