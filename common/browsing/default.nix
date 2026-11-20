{
  lib,
  stdenvNoCC,
  python3,
  nodejs,
  age,
  dnsmasq,
  makeWrapper,
}:
let
  extension = lib.cleanSource ../../extensions/browsing;
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
    nodejs
    makeWrapper
  ];
  dontBuild = true;
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    python3 -m unittest discover -s . -p 'test_*.py'
    node --test ${extension}/test_browsing.cjs
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/share/browsing/extension" "$out/bin"
    cp rules.py "$out/share/browsing/"
    cp ${extension}/src/* "$out/share/browsing/extension/"
    makeWrapper ${python3}/bin/python3 "$out/bin/browsing-rules" \
      --add-flags "$out/share/browsing/rules.py --encrypted ${../../secrets/browsing.age} --extension-source $out/share/browsing/extension" \
      --prefix PATH : ${
        lib.makeBinPath [
          age
          dnsmasq
        ]
      }
    runHook postInstall
  '';
}
