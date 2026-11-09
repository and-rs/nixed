{
  config,
  pkgs,
  lib,
  ...
}:
let
  inherit (pkgs.stdenv.hostPlatform) isLinux isDarwin;

  mountPoint = "${config.home.homeDirectory}/Mounts/Hetzner";
  secretPath = config.age.secrets.hetzner.path;

  rcloneFlags = [
    "--vfs-cache-mode=writes"
    "--vfs-write-back=1s"
    "--dir-cache-time=10s"
    "--attr-timeout=1s"
    "--vfs-read-chunk-size=16M"
    "--vfs-read-chunk-size-limit=2G"
    "--timeout=5s"
    "--contimeout=10s"
    "--low-level-retries=1"
    "--retries=1"
  ];

  rcloneArgs = builtins.concatStringsSep " " rcloneFlags;

  darwinStartScript = pkgs.writeShellScript "rclone-hetzner-start" ''
    set -euo pipefail

    if [ ! -f "${secretPath}" ]; then
      exit 1
    fi

    RAW_PASS=$(${pkgs.coreutils}/bin/cat "${secretPath}" | ${pkgs.coreutils}/bin/tr -d '\r\n')

    export RCLONE_CONFIG_HETZNER_TYPE="webdav"
    export RCLONE_CONFIG_HETZNER_URL="https://u555854.your-storagebox.de"
    export RCLONE_CONFIG_HETZNER_VENDOR="other"
    export RCLONE_CONFIG_HETZNER_USER="u555854"
    export RCLONE_CONFIG_HETZNER_PASS=$(${pkgs.rclone}/bin/rclone obscure "$RAW_PASS")

    ${pkgs.coreutils}/bin/mkdir -p "${mountPoint}"

    exec ${pkgs.rclone}/bin/rclone mount hetzner: "${mountPoint}" ${rcloneArgs}
  '';
in
{
  options.hetzner.enable = lib.mkOption {
    type = lib.types.bool;
    default = true;
    description = "Decrypt Hetzner credentials and mount the storage box.";
  };

  config = lib.mkIf config.hetzner.enable {
    age.identityPaths = [
      "${config.home.homeDirectory}/.ssh/${if isDarwin then "agenix-darwin" else "agenix"}"
    ];

    age.secrets.hetzner = {
      file = ../../secrets/hetzner.age;
    };

    programs.rclone = lib.mkIf isLinux {
      enable = true;
      remotes.hetzner = {
        config = {
          type = "webdav";
          url = "https://u555854.your-storagebox.de";
          vendor = "other";
          user = "u555854";
        };
        secrets.pass = config.age.secrets.hetzner.path;
      };
    };

    systemd.user.services.rclone-hetzner = lib.mkIf isLinux {
      Unit = {
        Description = "Mount Hetzner with rclone";
        After = [
          "network-online.target"
          "rclone-config.service"
        ];
        Requires = [ "rclone-config.service" ];
      };
      Install = {
        WantedBy = [ "default.target" ];
      };
      Service = {
        Type = "notify";
        Environment = [ "PATH=/run/wrappers/bin:/run/current-system/sw/bin" ];
        ExecStartPre = "${pkgs.coreutils}/bin/mkdir -p ${mountPoint}";
        ExecStart = "${pkgs.rclone}/bin/rclone mount hetzner: ${mountPoint} ${rcloneArgs}";
        ExecStop = "/run/wrappers/bin/fusermount3 -u ${mountPoint}";
        Restart = "on-failure";
        RestartSec = "10s";
      };
    };

    launchd.agents.rclone-hetzner = lib.mkIf isDarwin {
      enable = true;
      config = {
        Label = "com.and-rs.rclone-hetzner";
        ProgramArguments = [ "${darwinStartScript}" ];
        RunAtLoad = true;
        KeepAlive = {
          SuccessfulExit = false;
        };
        StandardOutPath = "${config.home.homeDirectory}/Library/Logs/rclone-hetzner.log";
        StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/rclone-hetzner.error.log";
      };
    };
  };
}
