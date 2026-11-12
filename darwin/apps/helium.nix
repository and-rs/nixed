{ pkgs, ... }:
let
  version = "0.19.3.1";

  helium = pkgs.stdenvNoCC.mkDerivation {
    pname = "helium-browser";
    inherit version;

    src = pkgs.fetchurl {
      url = "https://github.com/imputnet/helium-macos/releases/download/${version}/helium_${version}_arm64-macos.dmg";
      hash = "sha256-ugwwxIPubEbkj/wjmuaysIR6/etU60puoxZlBUpS0Vk=";
    };

    nativeBuildInputs = [ pkgs.undmg ];
    dontUnpack = true;
    # Keeps the notarized Developer ID signature intact.
    dontFixup = true;

    installPhase = ''
      runHook preInstall
      undmg $src
      mkdir -p $out/Applications
      cp -R Helium.app $out/Applications/
      runHook postInstall
    '';

    meta = {
      description = "A fast and lightweight web browser";
      homepage = "https://github.com/imputnet/helium";
      license = pkgs.lib.licenses.gpl3Plus;
      platforms = [ "aarch64-darwin" ];
    };
  };
in
{
  environment.systemPackages = [
    (import ../../extensions/browser-theme/darwin.nix { inherit pkgs helium; })
  ];

  system.activationScripts.postActivation.text = ''
    policy="/Library/Managed Preferences/net.imput.helium.plist"
    if [ -e "$policy" ]; then
      rm -f "$policy"
    fi
  '';
}
