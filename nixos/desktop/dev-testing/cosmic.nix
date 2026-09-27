{ pkgs, ... }:
{
  services.desktopManager.cosmic.enable = true;
  services.power-profiles-daemon.enable = false;

  environment.cosmic.excludePackages = with pkgs; [
    tasks
    cosmic-edit
    cosmic-files
    cosmic-initial-setup
    cosmic-monitor
    cosmic-player
    cosmic-randr
    cosmic-reader
    cosmic-screenshot
    cosmic-sound-theme
    cosmic-store
    cosmic-term
    cosmic-wallpapers
    pop-icon-theme
  ];
}
