{ pkgs, inputs }:
with pkgs;
[
  inputs.agenix.packages.${stdenv.hostPlatform.system}.default
  bob-nvim
  kakoune
  chezmoi

  fzf
  tmux
  direnv
  zoxide
  oh-my-posh

  ocamlformat
  ocamlPackages.lsp
  ocamlPackages.utop

  nushell
  topiary
  carapace

  age
  grit
  sqlite
  sqldiff

  fastfetch
  worktrunk
  hyperfine
  alacritty
  cbonsai
  cmatrix
  ripgrep
  slides
  dotbot
  tokei
  unzip
  delta
  p7zip
  yazi
  btop
  wget
  nmap
  git
  eza
  fd
  gh
  jq
  fx
]
++ lib.optionals stdenv.hostPlatform.isLinux [
  inputs.ghostty.packages.${stdenv.hostPlatform.system}.default
]
