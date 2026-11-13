{
  stdenvNoCC,
  nodejs,
}:
stdenvNoCC.mkDerivation {
  pname = "tab-search-extension";
  version = "2.0.2";
  src = ./.;
  nativeBuildInputs = [ nodejs ];
  dontBuild = true;
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    node --test test_tab_search.cjs
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/share/tab-search"
    cp -r src/. "$out/share/tab-search/"
    runHook postInstall
  '';
}
