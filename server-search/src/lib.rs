//! Search backends for SilverBullet Server. Exactly one backend is active per
//! space; the HTTP layer in `silverbullet-server` routes every request to it.

pub mod admission;
pub mod backend;
pub mod error;
pub mod gate;
pub mod ripgrep;
pub mod types;

pub use admission::{Admission, ProcessSlot, RequestCx};
pub use backend::{BoxFut, SearchBackend, SpaceView};
pub use error::SearchError;
pub use gate::Gate;
pub use types::*;
