{
  lib,
  stdenv,
  rustPlatform,
  fetchFromGitHub,
  systemd,
  coreutils,
  gnugrep,
  pkg-config,
  fontconfig,
  libGL,
  libinput,
  libxkbcommon,
  libgbm,
  seatd,
  wayland,
  udevCheckHook,
}:

let
  version = "6.5.0";
  src = fetchFromGitHub {
    owner = "OpenGamingCollective";
    repo = "asusctl";
    # Pin the commit instead of a retaggable GitHub release tag.
    rev = "ec09e7629da3e4081d9c342e7f323e30158cccfd";
    hash = "sha256-UTs9LF2EKUj5vxG0hc9V4DvCFMbyYgvA645ClxnE3WM=";
  };
in
rustPlatform.buildRustPackage {
  pname = "asusctl";
  inherit version src;
  cargoHash = "sha256-Kujj8gQ5qsEv2iLO3T1JoK0E2q0ByOhxpuN942EvB7Q=";

  postPatch = ''
    substituteInPlace data/asusd.service \
      --replace-fail /usr/bin/asusd $out/bin/asusd \
      --replace-fail /bin/sleep ${lib.getExe' coreutils "sleep"}
    substituteInPlace data/asus-shutdown.service \
      --replace-fail /usr/bin/asus-shutdown $out/bin/asus-shutdown
    substituteInPlace Makefile \
      --replace-fail /usr/bin/grep ${lib.getExe gnugrep}
  '';

  nativeBuildInputs = [
    pkg-config
    rustPlatform.bindgenHook
    udevCheckHook
  ];

  buildInputs = [
    fontconfig
    libGL
    libinput
    libxkbcommon
    libgbm
    seatd
    systemd
    wayland
  ];

  cargoBuildFlags = [
    "--package"
    "asusctl"
    "--package"
    "asusd"
    "--package"
    "asus-shutdown"
  ];

  env.RUSTFLAGS = toString (
    map (arg: "-C link-arg=${arg}") [
      "-Wl,--push-state,--no-as-needed"
      "-lEGL"
      "-lfontconfig"
      "-lwayland-client"
      "-Wl,--pop-state"
    ]
  );

  postInstall = ''
    install -Dm755 target/${stdenv.hostPlatform.rust.cargoShortTarget}/release/asusctl -t $out/bin
    install -Dm755 target/${stdenv.hostPlatform.rust.cargoShortTarget}/release/asusd -t $out/bin
    install -Dm755 target/${stdenv.hostPlatform.rust.cargoShortTarget}/release/asus-shutdown -t $out/bin
    install -Dm644 data/asusd.rules $out/lib/udev/rules.d/99-asusd.rules
    install -Dm644 rog-aura/data/aura_support.ron $out/share/asusd/aura_support.ron
    install -Dm644 data/asusd.conf $out/share/dbus-1/system.d/asusd.conf
    install -Dm644 data/asusd.service $out/lib/systemd/system/asusd.service
    install -Dm644 data/asus-shutdown.service $out/lib/systemd/system/asus-shutdown.service
    install -Dm644 LICENSE $out/share/asusctl/LICENSE
    cp -r rog-anime/data/anime $out/share/asusd/
  '';

  doCheck = false;
  doInstallCheck = true;

  meta = {
    description = "ASUS laptop control daemon and CLI";
    homepage = "https://github.com/OpenGamingCollective/asusctl";
    license = lib.licenses.mpl20;
    platforms = [ "x86_64-linux" ];
  };
}
