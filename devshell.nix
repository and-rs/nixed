{ pkgs }:
let
  terraformBinary =
    {
      x86_64-linux = {
        platform = "linux_amd64";
        sha256 = "4638628058e71a55212b1c563712eac03b902128f40740f3dc8174df12135061";
      };
      aarch64-darwin = {
        platform = "darwin_arm64";
        sha256 = "b1ecb3fe0d0a0290c1ab6f83d967d43f25da05d0b671ee0fb355252268dce95a";
      };
    }
    .${pkgs.stdenv.hostPlatform.system};
  terraform = pkgs.stdenvNoCC.mkDerivation rec {
    pname = "terraform-bin";
    version = "1.17.1";
    src = pkgs.fetchurl {
      url = "https://releases.hashicorp.com/terraform/${version}/terraform_${version}_${terraformBinary.platform}.zip";
      inherit (terraformBinary) sha256;
    };
    nativeBuildInputs = [ pkgs.unzip ];
    dontUnpack = true;
    dontStrip = true;
    installPhase = ''
      runHook preInstall
      unzip "$src"
      install -Dm755 terraform "$out/bin/terraform"
      install -Dm644 LICENSE.txt "$out/share/licenses/terraform/LICENSE.txt"
      runHook postInstall
    '';
    meta.license = pkgs.lib.licenses.bsl11;
  };
in
pkgs.mkShell {
  packages = with pkgs; [
    ssm-session-manager-plugin
    terraform
    awscli2
    just
    jq
    zip
    shellcheck
    python3
  ];
}
