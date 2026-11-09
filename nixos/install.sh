#!/usr/bin/env bash
# Run only from a NixOS installer USB. This script ERASES BOTH internal SSDs.
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

if [[ $EUID != 0 ]]; then
  echo 'Run from the installer with: sudo bash nixos/install.sh' >&2
  exit 1
fi
if ! findmnt --mountpoint /iso >/dev/null; then
  echo 'Refusing: boot a NixOS installer USB first (/iso must be mounted).' >&2
  exit 1
fi
if [[ ! -d /sys/firmware/efi ]]; then
  echo 'Refusing: boot the installer in UEFI mode.' >&2
  exit 1
fi
for secure_boot in /sys/firmware/efi/efivars/SecureBoot-*; do
  [[ -f "$secure_boot" ]] || continue
  if [[ $(od -An -j4 -N1 -tu1 "$secure_boot" | tr -d ' ') == 1 ]]; then
    echo 'Refusing: disable firmware Secure Boot for hibernation first.' >&2
    exit 1
  fi
done
if findmnt --mountpoint /mnt >/dev/null; then
  echo 'Refusing: /mnt is already mounted. Check existing mounts before retrying.' >&2
  exit 1
fi

# OBS requires its private cache; a base installation needs no AWS credentials.
obs_enabled="$(nix --extra-experimental-features 'nix-command flakes' eval --json \
  .#nixosConfigurations.default.config.nixed.features.obs.enable)"
if [[ "$obs_enabled" == true ]]; then
  # Supply a fresh exported AWS INI credential file from outside this checkout.
  credentials="${1:?OBS enabled: supply /path/to/cache-credentials}"
  [[ -f "$credentials" && -s "$credentials" ]] || { echo 'Missing/empty AWS credential file' >&2; exit 1; }
  credentials="$(realpath "$credentials")"
  case "$credentials" in
    "$PWD"/*) echo 'Keep AWS credentials outside the repository.' >&2; exit 1 ;;
  esac
  install -d -m 0700 /var/lib/nix/nixed-cache
  if [[ "$credentials" != /var/lib/nix/nixed-cache/credentials ]]; then
    install -m 0600 "$credentials" /var/lib/nix/nixed-cache/credentials
  fi
  export AWS_SHARED_CREDENTIALS_FILE=/var/lib/nix/nixed-cache/credentials
  export AWS_PROFILE=default
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN

  cache="$(nix --extra-experimental-features 'nix-command flakes' eval --raw \
    .#nixosConfigurations.default.config.nix.settings.extra-substituters --apply builtins.head)"
  public_key="$(nix --extra-experimental-features 'nix-command flakes' eval --raw \
    .#nixosConfigurations.default.config.nix.settings.extra-trusted-public-keys --apply builtins.head)"
  plugin="$(nix --extra-experimental-features 'nix-command flakes' eval --raw .#obs-backgroundremoval.outPath)"

  # Fail BEFORE erasing disks if credentials expired, the package changed, or trust fails.
  nix --extra-experimental-features 'nix-command flakes' store verify \
    --store "$cache" --recursive --no-contents --extra-trusted-public-keys "$public_key" "$plugin"

  # Configure the live daemon as well as the root CLI. No secret enters nix.conf.
  install -d -m 0755 /run/systemd/system/nix-daemon.service.d
  cat > /run/systemd/system/nix-daemon.service.d/nixed-cache.conf <<'EOF'
[Service]
Environment=AWS_SHARED_CREDENTIALS_FILE=/var/lib/nix/nixed-cache/credentials
Environment=AWS_PROFILE=default
EOF
  cat >> /etc/nix/nix.conf <<EOF
extra-substituters = $cache
extra-trusted-public-keys = $public_key
EOF
  systemctl daemon-reload
  systemctl restart nix-daemon.service
fi

main=/dev/disk/by-id/nvme-Micron_2450_MTFDKBA1T0TFK_21483340DB72
slow=/dev/disk/by-id/nvme-HFM128GDJTNG-8310A_CD97N614711207N5E
for disk in "$main" "$slow"; do
  [[ -b "$disk" ]] || { echo "Missing disk: $disk" >&2; exit 1; }
  lsblk -o NAME,SIZE,MODEL,SERIAL,FSTYPE,MOUNTPOINTS "$disk"
done

echo 'ALL partitions and data on BOTH disks above will be destroyed.'
echo 'Backups must already exist elsewhere. Firmware Secure Boot must be disabled.'
read -r -p 'Type ERASE BOTH SSDS to continue: ' confirmation
[[ "$confirmation" == 'ERASE BOTH SSDS' ]] || exit 1

# Catch configuration/evaluation failures BEFORE touching either disk.
nix --extra-experimental-features 'nix-command flakes' \
  eval --raw .#nixosConfigurations.default.config.system.build.toplevel.drvPath

# Never write this key into the repository or the Nix store.
if [[ -e /run/nixed-slow.key ]]; then
  echo 'Refusing to overwrite /run/nixed-slow.key; check the previous attempt.' >&2
  exit 1
fi
umask 077
head -c 64 /dev/urandom > /run/nixed-slow.key
trap 'rm -f /run/nixed-slow.key' EXIT

# Build/run the Disko version locked by this flake, not an unpinned CLI.
nix --extra-experimental-features 'nix-command flakes' \
  build .#nixosConfigurations.default.config.system.build.destroyFormatMount \
  --out-link /run/nixed-disko
/run/nixed-disko/bin/disko-destroy-format-mount --yes-wipe-all-disks

install -d -m 0700 /mnt/var/lib/cryptsetup-keys
install -m 0600 /run/nixed-slow.key /mnt/var/lib/cryptsetup-keys/slow.key
cryptsetup open --test-passphrase --key-file /mnt/var/lib/cryptsetup-keys/slow.key \
  /dev/disk/by-partlabel/disk-slow-luks

install -d -m 0755 /mnt/etc/nixos
if [[ "$obs_enabled" == true ]]; then
  install -d -m 0700 /mnt/var/lib/nix/nixed-cache
  install -m 0600 /var/lib/nix/nixed-cache/credentials /mnt/var/lib/nix/nixed-cache/credentials
fi
# Retain the exact checkout, including local changes and lock file, for rebuilds.
cp -a . /mnt/etc/nixos/
nixos-install --flake /mnt/etc/nixos#default --no-root-passwd
nixos-enter --root /mnt -c 'passwd and-rs'

echo 'Installed. Restore your SSH/age keys before enabling private fonts or Hetzner.'
echo 'After reboot, rebuild with: sudo nixos-rebuild switch --flake /etc/nixos#default'
