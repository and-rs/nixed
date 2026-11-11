{ pkgs, ... }:
let
  myPython = pkgs.python314.buildEnv.override {
    extraLibs = with pkgs.python314Packages; [
      uv
      pip
      numpy
      pandas
      polars
      tkinter
      openpyxl
      virtualenv
    ];
    ignoreCollisions = true;
  };
in
{
  environment.systemPackages = [
    myPython
    pkgs.basedpyright
    pkgs.djlint
    pkgs.black
    pkgs.ruff
    pkgs.tcl
    pkgs.tk
    pkgs.ty

    pkgs.duckdb
  ];
}
