//! Migrating a legacy single-space folder into a multi-space data root: the
//! old folder's entries move to `spaces/<folder>` and the env-var settings
//! become a `spaces.json` entry.

pub mod api;
pub mod blockers;
pub mod execute;
pub mod plan;
pub mod report;

pub use blockers::{find_blockers, Blocker};
pub use execute::{execute, pending_journal, resume, Journal, MigrationSecrets};
pub use plan::{
    compute_plan, default_edits, synthesize_space, AdminChoice, AdminPlan, LegacyEnv,
    MigrationPlan, Move, PlanEdits, SingleSpaceSettings, Visitors,
};
pub use report::MigrationReport;

/// The journal a running migration keeps in the data root.
pub const JOURNAL_FILE: &str = ".migration-journal.json";
/// The report a finished migration leaves in the data root.
pub const REPORT_FILE: &str = "MIGRATION.md";
