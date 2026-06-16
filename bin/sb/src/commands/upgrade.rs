//! `upgrade` and `upgrade-edge` command implementations for the `sb` CLI.
//!
//! The actual download-and-replace machinery lives in
//! [`silverbullet_server_common::upgrade`], shared with the `silverbullet`
//! server binary. This module only pins the `sb`-specific parameters.

use silverbullet_server_common::upgrade::{self, UpgradeSpec, EDGE_URL_PREFIX, STABLE_URL_PREFIX};

/// The `sb` CLI ships as `sb-<os>-<arch>.zip` and the executable inside is `sb`.
const SPEC: UpgradeSpec = UpgradeSpec {
    asset: "sb",
    binary: "sb",
};

/// Run the upgrade command.
///
/// `edge = false` → stable release; `edge = true` → edge release.
pub fn run(edge: bool) -> Result<(), String> {
    if edge {
        println!("Upgrading sb to edge...");
        upgrade::upgrade(&SPEC, EDGE_URL_PREFIX)
    } else {
        println!("Upgrading sb...");
        upgrade::upgrade(&SPEC, STABLE_URL_PREFIX)
    }
}
