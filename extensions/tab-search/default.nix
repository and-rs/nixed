{ callPackage }:
callPackage ../package.nix {
  name = "tab-search";
  version = "2.0.2";
  src = ./.;
}
