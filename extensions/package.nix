{
  lib,
  stdenvNoCC,
  nodejs,
  name,
  version,
  src,
}:
let
  testName = lib.replaceStrings [ "-" ] [ "_" ] name;
in
stdenvNoCC.mkDerivation {
  pname = "${name}-extension";
  inherit version src;
  nativeBuildInputs = [ nodejs ];
  dontBuild = true;
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    node --test test_${testName}.cjs
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/share/${name}"
    cp -r src/. "$out/share/${name}/"
    runHook postInstall
  '';
}
