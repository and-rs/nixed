{ pkgs, ... }:
{
  fonts = {
    packages = with pkgs; [
      adwaita-fonts

      monaspace
      recursive
      maple-mono.truetype-autohint
    ];
    fontconfig = {
      enable = true;
      antialias = true;
      subpixel.lcdfilter = "none";
      hinting = {
        enable = true;
        autohint = false;
        style = "full";
      };
      defaultFonts = {
        monospace = [ "CommitMono" ];
        sansSerif = [ "SF Pro" ];
        serif = [ "SF Pro" ];
      };
    };
  };
}
