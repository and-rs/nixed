{
  disko.devices = {
    disk = {
      main = {
        type = "disk";
        device = "/dev/disk/by-id/nvme-Micron_2450_MTFDKBA1T0TFK_21483340DB72";
        content = {
          type = "gpt";
          partitions = {
            ESP = {
              size = "2G";
              type = "EF00";
              content = {
                type = "filesystem";
                format = "vfat";
                mountpoint = "/boot";
                mountOptions = [ "umask=0077" ];
              };
            };
            luks = {
              size = "100%";
              content = {
                type = "luks";
                name = "main";
                content = {
                  type = "lvm_pv";
                  vg = "system";
                };
              };
            };
          };
        };
      };
      slow = {
        type = "disk";
        device = "/dev/disk/by-id/nvme-HFM128GDJTNG-8310A_CD97N614711207N5E";
        content = {
          type = "gpt";
          partitions.luks = {
            size = "100%";
            content = {
              type = "luks";
              name = "slow";
              # Unlock in stage 2 using a key stored on the encrypted root.
              initrdUnlock = false;
              additionalKeyFiles = [ "/run/nixed-slow.key" ];
              content = {
                type = "filesystem";
                format = "ext4";
                mountpoint = "/slow";
                mountOptions = [
                  "nofail"
                  "x-systemd.device-timeout=10s"
                ];
              };
            };
          };
        };
      };
    };
    lvm_vg.system = {
      type = "lvm_vg";
      lvs = {
        swap = {
          size = "24G";
          content = {
            type = "swap";
            resumeDevice = true;
          };
        };
        root = {
          size = "100%FREE";
          content = {
            type = "btrfs";
            subvolumes = {
              "@root" = {
                mountpoint = "/";
                mountOptions = [
                  "compress=zstd:1"
                  "noatime"
                ];
              };
              "@home" = {
                mountpoint = "/home";
                mountOptions = [
                  "compress=zstd:1"
                  "noatime"
                ];
              };
              "@nix" = {
                mountpoint = "/nix";
                mountOptions = [
                  "compress=zstd:1"
                  "noatime"
                ];
              };
              "@data" = {
                mountpoint = "/data";
                mountOptions = [
                  "compress=zstd:1"
                  "noatime"
                ];
              };
            };
          };
        };
      };
    };
  };
}
