{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  buildInputs = [ pkgs.mongodb pkgs.nodejs pkgs.awscli2 ];
}
