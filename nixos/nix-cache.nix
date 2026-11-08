{ config, lib, ... }:
let
  cfg = config.nixed.binaryCache;
in
{
  options.nixed.binaryCache = {
    enable = lib.mkEnableOption "the private S3 binary cache";
    url = lib.mkOption {
      type = lib.types.str;
      description = "S3 binary-cache URI, including its AWS region.";
    };
    publicKey = lib.mkOption {
      type = lib.types.str;
      description = "Public Nix signing key; never the private key.";
    };
  };

  config = lib.mkIf cfg.enable {
    nix.settings.extra-substituters = [ cfg.url ];
    nix.settings.extra-trusted-public-keys = [ cfg.publicKey ];
    systemd.services.nix-daemon.environment.AWS_SHARED_CREDENTIALS_FILE =
      "/var/lib/nix/nixed-cache/credentials";
  };
}
