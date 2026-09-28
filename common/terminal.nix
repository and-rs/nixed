{ pkgs, inputs }:
with pkgs;
[
  inputs.agenix.packages.${stdenv.hostPlatform.system}.default
  bob-nvim
  kakoune
  chezmoi

  yek
  opencode

  fzf
  tmux
  direnv
  zoxide
  oh-my-posh

  nushell
  topiary
  carapace

  age
  grit
  sqlite
  sqldiff

  fastfetch
  hyperfine
  alacritty
  cbonsai
  neovide
  cmatrix
  ripgrep
  slides
  dotbot
  broot
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
]
++ lib.optionals stdenv.hostPlatform.isLinux [
  inputs.ghostty.packages.${stdenv.hostPlatform.system}.default
]
