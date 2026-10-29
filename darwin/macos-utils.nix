{ pkgs, ... }:
{
  fonts = {
    packages = with pkgs; [
      nerd-fonts.symbols-only
      monaspace
      kode-mono
      (google-fonts.override { fonts = [ "Spline Sans Mono" ]; })
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
