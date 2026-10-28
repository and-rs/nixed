{ pkgs, ... }:
{
  fonts = {
    packages = with pkgs; [
      nerd-fonts.symbols-only
      monaspace
      fragment-mono
      maple-mono.truetype-autohint
    ];
  };
  environment.systemPackages = with pkgs; [
    rclone
    ffmpeg
    aerospace
    ncurses
  ];
}
