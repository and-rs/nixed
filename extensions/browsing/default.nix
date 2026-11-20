{
  lib,
  stdenvNoCC,
  nodejs,
}:
stdenvNoCC.mkDerivation {
  pname = "browsing-extension";
  version = "1.0.0";
  src = lib.cleanSource ./.;
  nativeBuildInputs = [ nodejs ];
  dontBuild = true;
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    node --test test_browsing.cjs
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/share/browsing"
    cp src/* "$out/share/browsing/"
    runHook postInstall
  '';
}
