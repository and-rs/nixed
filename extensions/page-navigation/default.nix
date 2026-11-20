{ callPackage }:
callPackage ../package.nix {
  name = "page-navigation";
  version = "1.0.0";
  src = ./.;
}
