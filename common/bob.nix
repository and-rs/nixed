{
  lib,
  stdenv,
  cacert,
  bob-nvim,
}:
bob-nvim.overrideAttrs (_: {
  postInstall = lib.optionalString (stdenv.buildPlatform.canExecute stdenv.hostPlatform) ''
    export HOME="$TMPDIR/bob-home"
    mkdir -p "$HOME"
    export SSL_CERT_FILE="${cacert}/etc/ssl/certs/ca-bundle.crt"
    export NIX_SSL_CERT_FILE="$SSL_CERT_FILE"

    # Keep other shell completions, but omit Nushell's vendor autoload.
    for shell in bash fish zsh; do
      "$out/bin/bob" complete "$shell" > "bob.$shell"
    done
    installShellCompletion --cmd bob \
      --bash bob.bash \
      --fish bob.fish \
      --zsh bob.zsh
  '';
})
