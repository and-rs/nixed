# Fresh installation (M16)

**This erases BOTH SSDs, including the existing home and data partitions.**
`default` is the only NixOS target and describes this new layout.
Do not activate it on the old installation before installing the new layout.
Evaluation/building alone does not format disks; the installer runs formatting explicitly.

## Layout

- Micron 1 TB (`21483340DB72`): 2 GiB EFI, then LUKS containing LVM with
  24 GiB persistent swap and a Btrfs root volume. Root, home, Nix and data are
  separate subvolumes sharing free space, with Zstd compression.
- SK hynix 128 GB (`CD97N614711207N5E`): LUKS + ext4 at `/slow`.
  `/slow/storage` belongs to `and-rs`. It is nonessential to boot.
- One main passphrase prompt at boot. The secondary disk unlocks in stage 2
  using `/var/lib/cryptsetup-keys/slow.key` on the encrypted root. Its installation
  passphrase remains usable if that key is lost. Neither key enters the Nix store.
- No automatic snapshots or partition-size limits between Btrfs subvolumes.

## Before booting the installer

1. Verify the external backup and retain your SSH/age keys separately.
2. Make this exact repository checkout (including new files and `flake.lock`)
   available from the USB, backup drive or remote Git. Push/commit first if cloning.
3. Disable **firmware Secure Boot**. Kernel lockdown otherwise prevents
   hibernation; this target keeps Limine but disables its Secure Boot signing.
4. Boot a recent **NixOS installer USB in UEFI mode**, connect to the Internet,
   and open this checkout in a terminal. Keep the laptop on AC power.

### Optional features (disabled by default)

`nixos/features.nix` groups three independent switches, all initially `false`:

- `obs.enable`: OBS, its plugins, and the private S3 cache.
- `privateFonts.enable`: private font deployment using `~/.ssh/agenix`.
- `hetzner.enable`: age credential decryption and the Hetzner mount.

With these disabled, no AWS credentials or age identity are needed to install.
After booting, restore the correct age identity before enabling fonts or Hetzner.
Before enabling OBS, configure/login to AWS and export credentials as below, then
rebuild. AWS CLI can be run through `nix shell nixpkgs#awscli2` before OBS is enabled.
Public fonts and ordinary networking remain enabled.

### S3 credentials (only when OBS is enabled)

Shortly before installing, authenticate to AWS on your current system and run
`just credentials` from `aws/` (or `AWS_PROFILE=your-profile just credentials`).
This exports your current session to `/var/lib/nix/nixed-cache/credentials`.
Copy that file securely to external storage, **outside the repository**. It is a
secret: prefer encrypted external storage, restrict permissions, and remove the
external copy after installation. Never copy the cache signing private key.

Session credentials expire. Use a fresh session long enough for the installation;
if they expire, renew them rather than disabling signature checks or silently
building missing GPU dependencies. The installer accepts an AWS INI credentials
file containing a `[default]` profile, including its session token when applicable.

## Install

```sh
sudo bash nixos/install.sh
```

If `obs.enable = true`, pass `/path/on/external-storage/cache-credentials` as
an argument. Only then does the script require credentials, check S3 access and
signatures for the exact plugin's entire runtime closure before erasure, and
configure the live Nix daemon to use S3. Missing cache entries, expired credentials
or untrusted signatures abort that preflight.

The script checks the live installer, disk IDs and mountpoint. It shows both disks
and requires typing `ERASE BOTH SSDS`. Only then does it run the pinned Disko
format/mount script. Enter a strong LUKS passphrase when prompted (Disko may reuse
it for both disks). The script installs the secondary unlock key, copies this
checkout to `/etc/nixos`, installs NixOS and asks for your user login password.
Root password login remains locked. It does not reboot automatically.
When OBS is enabled, AWS credentials are copied to the new encrypted root with
root-only permissions; the installed daemon uses the cache and verification key.

If any step fails, **stop and inspect**; do not rerun the whole formatting script
to retry installation. Once mounted and the secondary key is installed, installation
can be retried with `sudo nixos-install --flake /mnt/etc/nixos#default --no-root-passwd`.
If credentials expired, first replace both the live installer's and target's
`/var/lib/nix/nixed-cache/credentials` with a fresh export (mode 600).
The temporary `/run/nixed-slow.key` is deleted when the script exits; its enrolled
copy is retained on the new encrypted root after formatting completes.

If private fonts or Hetzner are enabled during installation, restore the correct
age identity to `/mnt/home/and-rs/.ssh/agenix` after formatting/mounting but before
`nixos-install` activates Home Manager. For the default installation, leave these
features disabled and restore keys after booting, before enabling them.
Fix ownership and permissions after copying:

```sh
sudo nixos-enter --root /mnt -c 'chown -R and-rs:users /home/and-rs/.ssh; chmod 700 /home/and-rs/.ssh'
```

Keep private keys mode 600. Restore personal data/repositories as desired. Existing
Home Manager activation attempts to clone the dotfiles and Neovim repositories;
it does not replace your normal dotfiles deployment process. Do not regenerate
`hardware-configuration.nix`: Disko owns the storage configuration.

## First boot and subsequent rebuilds

```sh
sudo nixos-rebuild switch --flake /etc/nixos#default
findmnt -t btrfs,ext4,vfat
swapon --show
cat /sys/power/resume
```

From the checkout, the usual `just nixos-switch` and `just nixos-boot` also work.

When OBS is enabled, S3 is enabled alongside `cache.nixos.org`, with signature verification required.
To renew AWS access after installation, configure/login to your usual AWS profile
and run `AWS_PROFILE=your-profile bash aws/scripts/cache.sh credentials` from the
checkout. Renewal does not require Terraform or its state. AWS CLI is installed.
An exported session is **not a permanent credential**; repeat after expiry. If a
running daemon retains the old session, restart `nix-daemon` when no builds are active.

Confirm `/slow` is mounted before storing anything there. `/slow/storage` is writable
by your user. Save work, then test `systemctl hibernate`, power back on, unlock and
confirm the session resumes (not a fresh boot). Repeat with the NVIDIA GPU active
before relying on it; the existing NVIDIA power-management hooks remain enabled.
Hardware/driver resume reliability cannot be proven by configuration evaluation.

Unstable stays enabled. Moving disks improves storage responsiveness, **not cache
availability**: a changed lock file can still require downloads/builds. A fresh
store will need dependencies again unless exported/imported from a trusted cache.
ONNX Runtime uses the prebuilt GPU distribution rather than compiling CUDA kernels.

To unlock the secondary disk manually if needed (its passphrase still works):

```sh
sudo cryptsetup open /dev/disk/by-partlabel/disk-slow-luks slow
sudo mount /slow
```

Never run Disko's formatting script as part of routine rebuilds.
