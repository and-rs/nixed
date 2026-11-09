{ config, lib, ... }:
{
  options.nixed.features = {
    obs.enable = lib.mkEnableOption "OBS and its private S3 binary cache";
    privateFonts.enable = lib.mkEnableOption "private fonts decrypted with the age identity";
    hetzner.enable = lib.mkEnableOption "the encrypted Hetzner credentials and mount";
  };

  config = {
    nixed.features = {
      obs.enable = false;
      privateFonts.enable = false;
      hetzner.enable = false;
    };

    home-manager.users.and-rs = {
      privateFonts.enable = config.nixed.features.privateFonts.enable;
      hetzner.enable = config.nixed.features.hetzner.enable;
    };
  };
}
