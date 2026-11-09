{
  config,
  lib,
  pkgs,
  ...
}:
{
  config = lib.mkIf config.nixed.features.obs.enable {
    nix.settings.extra-substituters = [
      "s3://nixed-build-225919348896-us-west-2-cache?region=us-west-2"
    ];
    # Public verification key only. Signing keys and AWS credentials stay out of Nix.
    nix.settings.extra-trusted-public-keys = [
      "nixed-cache:+5MIwRrtgWRDmI9GbBLDXrYEBmoz4wjDFOh9hR3x5hI="
    ];
    systemd.services.nix-daemon.environment.AWS_SHARED_CREDENTIALS_FILE =
      "/var/lib/nix/nixed-cache/credentials";
    systemd.services.nix-daemon.environment.AWS_PROFILE = "default";
    environment.systemPackages = [ pkgs.awscli2 ];
  };
}
