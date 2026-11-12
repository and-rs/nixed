{ pkgs, helium }:
let
  theme = pkgs.callPackage ./default.nix { };
  original = "${helium}/Applications/Helium.app";
in
pkgs.runCommand "helium-themed" { nativeBuildInputs = [ pkgs.makeWrapper ]; } ''
  app="$out/Applications/Helium.app"
  mkdir -p "$app/Contents/MacOS"
  ln -s ${original}/Contents/Resources "$app/Contents/Resources"
  ${pkgs.python3}/bin/python3 - ${original}/Contents/Info.plist "$app/Contents/Info.plist" <<'PY'
  import plistlib
  import sys
  with open(sys.argv[1], "rb") as source:
      info = plistlib.load(source)
  info["CFBundleExecutable"] = "browser-theme"
  with open(sys.argv[2], "wb") as target:
      plistlib.dump(info, target)
  PY
  makeWrapper ${theme}/bin/browser-theme "$app/Contents/MacOS/browser-theme" \
    --add-flags 'launch -- ${original}/Contents/MacOS/Helium'
''
