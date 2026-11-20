let
  nixosKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJTj2/WRs75eDyLPcJzJW5LlZHeS76pbC1HGavRB79bn";
  darwinKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE1TzsK/VfkieVdyccxlpvyiYLHAM85ZY5yQBosmS5SJ";
  amadeusKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM7i1HdPX0AOh7yjgmrpm+1wICTJxDF54jXm6EkGajh3 amadeus-private-fonts";

  infrastructureRecipients = [
    nixosKey
    darwinKey
  ];
  fontRecipients = infrastructureRecipients ++ builtins.filter (key: key != "") [ amadeusKey ];
  fontSecrets = builtins.listToAttrs (
    map (font: {
      name = "fonts/${font.archive}";
      value.publicKeys = fontRecipients;
    }) (import ../common/private-fonts-manifest.nix)
  );
in
{
  "hetzner.age".publicKeys = infrastructureRecipients;
  "browsing.age".publicKeys = infrastructureRecipients;
}
// fontSecrets
