{ pkgs }:
let
  theme = pkgs.callPackage ../extensions/browser-theme { };
in
pkgs.symlinkJoin {
  name = "google-chrome-host-integrated";
  paths = [ pkgs.google-chrome ];
  nativeBuildInputs = [ pkgs.makeWrapper ];
  postBuild = ''
    rm -f "$out/bin/google-chrome"
    rm -f "$out/bin/google-chrome-stable"

    makeWrapper ${theme}/bin/browser-theme "$out/bin/google-chrome-stable" \
      --add-flags 'launch --browser chrome -- ${pkgs.google-chrome}/bin/google-chrome-stable' \
      --suffix PATH : ${
        pkgs.lib.makeBinPath [
          pkgs.xdg-utils
          pkgs.glib
          pkgs.desktop-file-utils
        ]
      }:/usr/bin:/bin:/usr/sbin:/sbin \
      --run 'export XDG_DATA_DIRS="''${XDG_DATA_DIRS:+$XDG_DATA_DIRS:}$HOME/.nix-profile/share:/nix/var/nix/profiles/default/share:/usr/local/share:/usr/share"'

    ln -s "$out/bin/google-chrome-stable" "$out/bin/google-chrome"

    if [ -f "$out/share/applications/google-chrome.desktop" ]; then
      rm "$out/share/applications/google-chrome.desktop"
      cp ${pkgs.google-chrome}/share/applications/google-chrome.desktop "$out/share/applications/google-chrome.desktop"

      substituteInPlace "$out/share/applications/google-chrome.desktop" \
        --replace-warn 'Exec=google-chrome-stable' "Exec=$out/bin/google-chrome-stable" \
        --replace-warn 'TryExec=google-chrome-stable' "TryExec=$out/bin/google-chrome-stable" \
        --replace-warn 'Exec=google-chrome %U' "Exec=$out/bin/google-chrome-stable %U" \
        --replace-warn 'TryExec=google-chrome' "TryExec=$out/bin/google-chrome-stable" \
        --replace-warn 'Exec=${pkgs.google-chrome}/bin/google-chrome-stable' "Exec=$out/bin/google-chrome-stable" \
        --replace-warn 'TryExec=${pkgs.google-chrome}/bin/google-chrome-stable' "TryExec=$out/bin/google-chrome-stable"
    fi
  '';
}
