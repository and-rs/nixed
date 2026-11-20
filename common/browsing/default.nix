{
  lib,
  stdenvNoCC,
  python3,
  age,
  dnsmasq,
  makeWrapper,
  callPackage,
}:
let
  extension = callPackage ../../extensions/browsing { };
in
stdenvNoCC.mkDerivation {
  pname = "browsing-rules";
  version = "1.0.0";
  src = lib.cleanSourceWith {
    src = ./.;
    filter = path: _: baseNameOf path != "__pycache__";
  };
  nativeBuildInputs = [
    python3
    makeWrapper
  ];
  dontBuild = true;
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    python3 -m unittest discover -s . -p 'test_*.py'
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/share/browsing" "$out/bin"
    cp rules.py "$out/share/browsing/"
    makeWrapper ${python3}/bin/python3 "$out/bin/browsing-rules" \
      --add-flags "$out/share/browsing/rules.py --encrypted ${../../secrets/browsing.age} --extension-source ${extension}/share/browsing" \
      --prefix PATH : ${
        lib.makeBinPath [
          age
          dnsmasq
        ]
      }
    runHook postInstall
  '';
}
