{
  description = "SilverBullet dev shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          # Rust itself comes from rustup (see rust-toolchain.toml), not nix:
          # the overlay-built std + bundled lld cannot link against NixOS
          # glibc, while a rustup install works once `cc` is on PATH.
          packages = [
            pkgs.nodejs_24

            pkgs.biome

            pkgs.gnumake
            pkgs.podman-compose

            pkgs.pkg-config
            pkgs.gcc
            pkgs.musl
            pkgs.git
            pkgs.chromium
          ];

          # Playwright's downloaded browsers don't run on NixOS (dynamically
          # linked); point the e2e suite at the Nix chromium instead.
          PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";

          shellHook = ''
            npm install
            ln -sf ${pkgs.biome}/bin/biome node_modules/.bin/biome
            # musl's lib dir must NOT sit on the global linker search path:
            # rust-lld resolves glibc's LFS symbols (open64/stat64/lseek64) from
            # the first -L it sees, and musl's libc shadows glibc here, breaking
            # every host (and musl-target build-script) link. musl is only the
            # *cross* target's libc and is supplied by musl-gcc itself, so drop
            # it from the inherited NIX_LDFLAGS.
            export NIX_LDFLAGS="$(echo "$NIX_LDFLAGS" | sed -E 's# -L[^ ]*musl[^ ]*/lib##g')"
          '';
        };
      });
}
