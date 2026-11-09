{ pkgs, config, ... }:
let
  asusGpuBoot = pkgs.writeShellApplication {
    name = "asus-gpu-boot";
    runtimeInputs = [ pkgs.coreutils ];
    text = ''
      set -euo pipefail

      state=/var/lib/asus-gpu-apply/dgpu_disable
      desired=
      if [[ -r "$state" ]]; then
        read -r desired < "$state"
      fi
      if [[ "$desired" != 1 ]]; then
        exit 0
      fi

      mux=/sys/class/firmware-attributes/asus-armoury/attributes/gpu_mux_mode/current_value
      dgpu=/sys/class/firmware-attributes/asus-armoury/attributes/dgpu_disable/current_value
      if [[ ! -r "$mux" || ! -w "$dgpu" ]] || [[ "$(<"$mux")" != 1 ]]; then
        echo "asus-gpu-boot: Integrated request requires an available hybrid MUX"
        exit 0
      fi

      # This sends the firmware's normal ACPI Eject Request. Do not remove PCI
      # functions directly: the ACPI hotplug handler owns that teardown.
      echo "asus-gpu-boot: requesting firmware dGPU eject for Integrated mode"
      printf '%s' 1 > "$dgpu"

      for _ in {1..10}; do
        if [[ ! -e /sys/bus/pci/devices/0000:01:00.0 ]] \
          && [[ ! -e /sys/bus/pci/devices/0000:01:00.1 ]]; then
          echo "asus-gpu-boot: NVIDIA PCI functions ejected"
          exit 0
        fi
        sleep 1
      done

      # Firmware/ACPI hotplug is asynchronous. Never hold the boot if it does
      # not complete; the journal retains the evidence for investigation.
      echo "asus-gpu-boot: NVIDIA PCI functions remained after 10 seconds"
    '';
  };
  asusGpuApply = pkgs.writeShellApplication {
    name = "asus-gpu-apply";
    runtimeInputs = [
      pkgs.coreutils
      pkgs.kmod
      pkgs.systemd
    ];
    text = ''
      set -euo pipefail

      get_value() {
        local attr="$1"
        local property="$2"
        local value
        value="$(busctl --system get-property \
          xyz.ljones.Asusd \
          /xyz/ljones/asus_armoury/"$attr" \
          xyz.ljones.AsusArmoury \
          "$property")"
        printf '%s\n' "''${value#i }"
      }

      apply_queued() {
        local attr="$1"
        local value="$2"
        if [[ "$value" == -1 ]]; then
          return
        fi

        echo "asus-gpu-apply: applying queued value $attr=$value"
        busctl --system call \
          xyz.ljones.Asusd \
          /xyz/ljones/asus_armoury/"$attr" \
          xyz.ljones.AsusArmoury \
          ApplyQueuedGpuValue
      }

      write_dgpu_state() {
        local value="$1"
        local state=/var/lib/asus-gpu-apply/dgpu_disable
        local temporary
        install -d -m 0755 "''${state%/*}"
        temporary="$(mktemp "''${state}.XXXXXX")"
        printf '%s\n' "$value" > "$temporary"
        mv -f "$temporary" "$state"
      }

      dgpu_disable_queued="$(get_value dgpu_disable QueuedGpuValue)"
      gpu_mux_mode_queued="$(get_value gpu_mux_mode QueuedGpuValue)"
      queued=false
      for value in "$dgpu_disable_queued" "$gpu_mux_mode_queued"; do
        if [[ "$value" != -1 ]]; then
          queued=true
        fi
      done

      if ! "$queued"; then
        echo "asus-gpu-apply: no queued GPU firmware values"
        exit 0
      fi

      if [[ "$dgpu_disable_queued" != -1 ]]; then
        write_dgpu_state "$dgpu_disable_queued"
      elif [[ "$gpu_mux_mode_queued" == 0 ]]; then
        write_dgpu_state 0
      fi

      echo "asus-gpu-apply: stopping NVIDIA services"
      for unit in nvidia-powerd.service nvidia-persistenced.service nvidia-fabricmanager.service; do
        systemctl stop --no-block "$unit" || true
      done

      unloaded=false
      for _ in {1..5}; do
        echo "asus-gpu-apply: unloading NVIDIA modules"
        if modprobe -r nvidia_drm nvidia_modeset nvidia_uvm nvidia; then
          unloaded=true
          break
        fi
        sleep 1
      done

      if ! "$unloaded"; then
        echo "asus-gpu-apply: NVIDIA modules remained in use"
        exit 1
      fi

      # The NVIDIA HDMI-audio PCI function keeps the dGPU package active even
      # after nvidia_drm unloads. It is safe to detach during shutdown.
      if [[ -L /sys/bus/pci/devices/0000:01:00.1/driver ]]; then
        echo "asus-gpu-apply: unbinding NVIDIA HDMI audio"
        printf '%s' 0000:01:00.1 > /sys/bus/pci/drivers/snd_hda_intel/unbind
        sleep 1
      fi

      # Firmware refuses to disable the dGPU while the MUX selects it, and
      # refuses to select the dGPU while it is disabled. Order dependent
      # transitions explicitly instead of relying on attribute names.
      if [[ "$dgpu_disable_queued" == 1 ]]; then
        if [[ "$gpu_mux_mode_queued" == 1 ]]; then
          apply_queued gpu_mux_mode "$gpu_mux_mode_queued"
        elif [[ "$(get_value gpu_mux_mode CurrentValue)" != 1 ]]; then
          echo "asus-gpu-apply: cannot disable dGPU while MUX is in dGPU mode"
          exit 1
        fi
        apply_queued dgpu_disable "$dgpu_disable_queued"
      elif [[ "$gpu_mux_mode_queued" == 0 ]]; then
        if [[ "$dgpu_disable_queued" == 0 ]]; then
          apply_queued dgpu_disable "$dgpu_disable_queued"
        elif [[ "$(get_value dgpu_disable CurrentValue)" != 0 ]]; then
          echo "asus-gpu-apply: cannot select dGPU MUX while dGPU is disabled"
          exit 1
        fi
        apply_queued gpu_mux_mode "$gpu_mux_mode_queued"
      else
        apply_queued dgpu_disable "$dgpu_disable_queued"
        apply_queued gpu_mux_mode "$gpu_mux_mode_queued"
      fi
      echo "asus-gpu-apply: completed"
    '';
  };
in
{
  services.udev.extraRules = ''
    ACTION=="add", SUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_device", TEST=="power/wakeup", ATTR{power/wakeup}="disabled"
  '';

  environment.etc."libinput/local-overrides.quirks".text = ''
    [Asus Keyboard DWT Fix]
    MatchName=Asus Keyboard
    AttrKeyboardIntegration=internal
  '';

  boot.kernelPackages = pkgs.linuxPackages_xanmod_stable;

  # for virtual OBS camera
  boot.extraModulePackages = with config.boot.kernelPackages; [
    v4l2loopback
  ];
  boot.kernelModules = [ "v4l2loopback" ];

  boot.extraModprobeConfig = ''
    blacklist spd5118
    options snd_usb_audio implicit_fb=0
    options usbcore autosuspend=-1
    options v4l2loopback devices=1 video_nr=1 card_label="Asus Camera" exclusive_caps=1
  '';

  boot.blacklistedKernelModules = [
    "sdhci"
    "sdhci_pci"
    "spd5118"
  ];

  boot.kernelParams = [
    "usbcore.autosuspend=-1"
    "i915.force_probe=46a6"
    "clocksource=tsc"
    "tsc=reliable"
  ];

  environment.systemPackages = with pkgs; [ asusctl ];
  services.asusd.enable = true;
  users.groups.power = { };

  # The upstream handler runs at PrepareForShutdown, before Wayland releases
  # nvidia_drm. Apply the deferred firmware values during unit teardown instead.
  systemd.services.asus-shutdown.enable = false;
  systemd.services.asus-gpu-apply = {
    description = "Apply queued ASUS GPU firmware settings";
    wantedBy = [ "multi-user.target" ];
    after = [ "asusd.service" ];
    before = [
      "display-manager.service"
      "shutdown.target"
      "reboot.target"
      "halt.target"
    ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      ExecStart = "${pkgs.coreutils}/bin/true";
      ExecStop = "${asusGpuApply}/bin/asus-gpu-apply";
      TimeoutStopSec = "45s";
      CapabilityBoundingSet = "CAP_SYS_MODULE CAP_SYS_ADMIN";
      NoNewPrivileges = true;
      ProtectKernelModules = false;
      SystemCallFilter = [
        "@system-service"
        "@module"
        "~@resources"
      ];
    };
  };

  systemd.services.asus-gpu-boot = {
    description = "Request ASUS dGPU eject for Integrated mode";
    wantedBy = [ "multi-user.target" ];
    after = [ "local-fs.target" ];
    before = [ "display-manager.service" ];
    serviceConfig = {
      Type = "oneshot";
      ExecStart = "${asusGpuBoot}/bin/asus-gpu-boot";
      TimeoutStartSec = "15s";
      StateDirectory = "asus-gpu-apply";
      CapabilityBoundingSet = "CAP_SYS_ADMIN";
      NoNewPrivileges = true;
      PrivateTmp = true;
      ProtectHome = true;
      ProtectSystem = "strict";
    };
  };

  hardware.graphics = {
    enable = true;
    extraPackages = with pkgs; [
      intel-media-driver
      libvdpau-va-gl
      vulkan-loader
      libva-utils
      vpl-gpu-rt
    ];
  };
}
