{ pkgs, ... }:
{
  environment.sessionVariables.TERMINAL = "ghostty";

  services.xserver = {
    enable = true;
    desktopManager.xterm.enable = false;
    windowManager.i3 = {
      enable = true;
      extraPackages = [ ];
      configFile = pkgs.writeText "i3-ghostty.conf" ''
        set $mod Mod4
        font pango:monospace 10
        exec --no-startup-id env GDK_BACKEND=x11 ghostty
        bindsym $mod+Return exec env GDK_BACKEND=x11 ghostty
        bindsym $mod+Shift+q kill
        bindsym $mod+Shift+e exec i3-msg exit
      '';
    };
  };
}
