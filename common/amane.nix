{
  pkgs,
  source,
  useMesaIcds ? false,
}:
let
  cargoSource = pkgs.lib.fileset.toSource {
    root = source;
    fileset = pkgs.lib.fileset.unions [
      (source + "/Cargo.toml")
      (source + "/Cargo.lock")
      (source + "/src")
    ];
  };
in
pkgs.rustPlatform.buildRustPackage {
  pname = "amane_shell";
  version = "0.1.0";
  src = cargoSource;

  cargoLock = {
    lockFile = source + "/Cargo.lock";
    outputHashes."amane-0.1.2" = "sha256-fU20wtIC9wlOP9mvcCboSdB67zVq2ZSe9FjD7mwyHMc=";
  };

  nativeBuildInputs = with pkgs; [
    pkg-config
    makeWrapper
  ];

  buildInputs = with pkgs; [
    fontconfig
    freetype
    expat
    wayland
    libxkbcommon
    libpulseaudio
    linux-pam
  ];

  LIBRARY_PATH = pkgs.lib.makeLibraryPath [ pkgs.linux-pam ];

  # A concurrently spawned test child can briefly inherit the thumbnail cache lock.
  dontUseCargoParallelTests = true;

  preCheck = ''
    export LD_LIBRARY_PATH="${
      pkgs.lib.makeLibraryPath [ pkgs.wayland ]
    }''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  '';

  postInstall = ''
    mv "$out/bin/amane_shell" "$out/bin/amane_shell_release"
    wrapProgram "$out/bin/amane_shell_release" ${pkgs.lib.optionalString useMesaIcds "--prefix VK_ADD_DRIVER_FILES : ${pkgs.mesa}/share/vulkan/icd.d"} \
      --prefix LD_LIBRARY_PATH : "${
        pkgs.lib.makeLibraryPath [
          pkgs.vulkan-loader
          pkgs.wayland
        ]
      }" \
      --prefix PATH : "${
        pkgs.lib.makeBinPath [
          pkgs.wireplumber
          pkgs.brightnessctl
        ]
      }"
  '';

  meta = {
    mainProgram = "amane_shell_release";
    platforms = pkgs.lib.platforms.linux;
  };
}
