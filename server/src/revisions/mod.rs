pub mod author;
pub mod engine;
pub mod git;
pub mod read;
pub mod store;

pub use author::spawn_author_config_lookup;
pub use engine::{Attribution, AuthorConfig, RevisionEngine};
pub use git::available as git_available;
pub use read::{
    file_at, file_history, space_log, FileRevisions, LogCommit, RevisionEntry, SpaceLog,
};
pub use store::{discover_repo_root, RevisionStore};
