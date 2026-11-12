{ writeShellScriptBin, python3 }:
writeShellScriptBin "browser-theme" ''
  exec ${python3}/bin/python3 ${./browser-theme.py} "$@"
''
