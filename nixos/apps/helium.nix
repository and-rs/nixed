{
  lib,
  fetchurl,
  appimageTools,
  makeDesktopItem,
  writeText,
}:
let
  pname = "helium-browser";
  version = "0.18.1.1";
  redditNsfwBlockerId = "amdeloababijiphdimbjbencaafalkbn";
  redditNsfwBlockerVersion = "1.0.2";

  src = fetchurl {
    url = "https://github.com/imputnet/helium-linux/releases/download/${version}/helium-${version}-x86_64.AppImage";
    hash = "sha256-0eG5k9+/7gbp+Q6KKc1Y6HpHUZewT8BIdQYifDOFacs=";
  };

  redditNsfwBlocker = fetchurl {
    name = "reddit-nsfw-blocker-${redditNsfwBlockerVersion}.crx";
    url = "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=140.0.0.0&acceptformat=crx3&x=id%3D${redditNsfwBlockerId}%26uc";
    hash = "sha256-ZHnomWSIXpNMwuwM7n5FSBNZGNYFKdubFcvsRYNxkT4=";
  };

  redditNsfwBlockerUpdateManifest = writeText "reddit-nsfw-blocker-update.xml" ''
    <?xml version="1.0" encoding="UTF-8"?>
    <gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
      <app appid="${redditNsfwBlockerId}">
        <updatecheck codebase="file://${redditNsfwBlocker}" version="${redditNsfwBlockerVersion}" />
      </app>
    </gupdate>
  '';

  redditNsfwBlockerPolicy = writeText "reddit-nsfw-blocker-policy.json" (
    builtins.toJSON {
      ExtensionSettings = {
        ${redditNsfwBlockerId} = {
          installation_mode = "force_installed";
          update_url = "file://${redditNsfwBlockerUpdateManifest}";
          override_update_url = true;
        };
      };
    }
  );

  desktopItem = makeDesktopItem {
    name = "helium";
    icon = "helium";
    type = "Application";
    exec = "env TZ=America/Bogota helium-browser %u";
    desktopName = "Helium Browser";
    categories = [
      "Network"
      "WebBrowser"
    ];
    comment = "A fast and lightweight web browser";
    terminal = false;
  };
in
appimageTools.wrapType2 {
  inherit pname version src;

  # Helium's AppImage runs in an FHS sandbox, so its managed policy must be
  # mounted into the sandbox rather than installed under the host's /etc.
  extraBwrapArgs = [
    "--dir /etc/chromium"
    "--dir /etc/chromium/policies"
    "--dir /etc/chromium/policies/managed"
    "--ro-bind ${redditNsfwBlockerPolicy} /etc/chromium/policies/managed/reddit-nsfw-blocker.json"
  ];

  extraInstallCommands = ''
    install -m 444 -D ${desktopItem}/share/applications/helium.desktop $out/share/applications/helium.desktop
    substituteInPlace $out/share/applications/helium.desktop \
      --replace "Exec=helium-browser" "Exec=$out/bin/helium-browser"
  '';

  meta = with lib; {
    description = "A fast and lightweight web browser";
    homepage = "https://github.com/imputnet/helium";
    license = licenses.gpl3Plus;
    mainProgram = "helium-browser";
    platforms = [ "x86_64-linux" ];
  };
}
