pub mod engine;
pub mod git;
pub mod read;
pub mod store;

pub use engine::{Attribution, RevisionEngine};
pub use git::available as git_available;
pub use read::{
    file_at, file_history, range_file_diff, range_summary, space_log, FileRevisions, LogCommit,
    RangeEnd, RangeFile, RangeSummary, RevisionEntry, SpaceLog,
};
pub use store::{discover_repo_root, RevisionStore};
