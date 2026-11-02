{
  lib,
  fetchurl,
  appimageTools,
  makeDesktopItem,
  symlinkJoin,
}:
let
  pname = "helium-browser";
  version = "0.18.1.1";
  src = fetchurl {
    url = "https://github.com/imputnet/helium-linux/releases/download/${version}/helium-${version}-x86_64.AppImage";
    hash = "sha256-0eG5k9+/7gbp+Q6KKc1Y6HpHUZewT8BIdQYifDOFacs=";
  };

  helium = appimageTools.wrapType2 {
    inherit pname version src;
  };

  desktopItem = makeDesktopItem {
    name = "helium";
    icon = "helium";
    type = "Application";
    exec = "env TZ=America/Bogota ${helium}/bin/helium-browser %u";
    desktopName = "Helium Browser";
    categories = [
      "Network"
      "WebBrowser"
    ];
    comment = "A fast and lightweight web browser";
    terminal = false;
  };
in
symlinkJoin {
  name = pname;
  inherit version;
  paths = [
    helium
    desktopItem
  ];

  meta = with lib; {
    description = "A fast and lightweight web browser";
    homepage = "https://github.com/imputnet/helium";
    license = licenses.gpl3Plus;
    mainProgram = "helium-browser";
    platforms = [ "x86_64-linux" ];
  };
}
