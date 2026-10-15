//! Search backends for SilverBullet Server. Exactly one backend is active per
//! space; the HTTP layer in `silverbullet-server` routes every request to it.

pub mod admission;
pub mod backend;
pub mod error;
pub mod fulltext;
pub mod gate;
pub mod index;
mod job;
pub mod layout;
pub mod limits;
pub mod report;
#[cfg(feature = "semantic")]
pub mod semantic;
pub mod stats;
pub mod sync;
#[cfg(test)]
pub(crate) mod test_support;
pub mod types;
pub mod view;

pub use admission::{Admission, QuerySlot, RequestCx};
pub use backend::{BoxFut, SearchBackend, SpaceView};
pub use error::SearchError;
pub use fulltext::FullTextBackend;
pub use gate::Gate;
pub use index::{
    Change, ChangeFeed, FeedEvent, FileStamp, IndexSink, Location, Opened, SinkError, SinkLimits,
    WhileReconciling,
};
pub use layout::{is_schema_dir, SearchRoot, CURRENT_SCHEMA_DIRS};
pub use report::{IndexKind, IndexReport, IndexState};
pub use stats::IndexStats;
pub use types::*;
pub use view::SpaceSearchView;
