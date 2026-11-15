{
  stdenvNoCC,
  nodejs,
}:
stdenvNoCC.mkDerivation {
  pname = "page-navigation-extension";
  version = "1.0.0";
  src = ./.;
  nativeBuildInputs = [ nodejs ];
  dontBuild = true;
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    node --test test_page_navigation.cjs
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/share/page-navigation"
    cp -r src/. "$out/share/page-navigation/"
    runHook postInstall
  '';
}
