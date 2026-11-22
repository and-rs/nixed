{ pkgs, inputs }:
with pkgs;
[
  inputs.agenix.packages.${stdenv.hostPlatform.system}.default
  (callPackage "${inputs.direnv-instant}/default.nix" { })
  (callPackage ../extensions/browser-theme { })
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

  pandoc
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
  ncdu
  nmap
  git
  eza
  fd
  gh
  jq
  fx
]
