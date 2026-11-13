{
  writeShellScriptBin,
  python3,
  callPackage,
}:
let
  tabSearch = callPackage ../tab-search { };
in
writeShellScriptBin "browser-theme" ''
  exec ${python3}/bin/python3 ${./browser-theme.py} --tab-search-manifest ${tabSearch}/share/tab-search/manifest.json "$@"
''
