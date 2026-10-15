//! What the dashboard shows about each index of a space.

use serde::Serialize;

use crate::Progress;

/// Which index: on the dashboard, in states and in log lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IndexKind {
    FullText,
    Semantic,
}

impl IndexKind {
    /// Starts the "index ready" and startup log lines.
    pub fn title(self) -> &'static str {
        match self {
            IndexKind::FullText => "Search index",
            IndexKind::Semantic => "Semantic index",
        }
    }

    /// Starts a warning.
    pub fn capitalized(self) -> &'static str {
        match self {
            IndexKind::FullText => "Full-text index",
            IndexKind::Semantic => "Semantic index",
        }
    }

    /// Inside a sentence.
    pub fn noun(self) -> &'static str {
        match self {
            IndexKind::FullText => "full-text index",
            IndexKind::Semantic => "semantic index",
        }
    }

    /// What a failed sync state says; the details go to the server log only.
    pub fn failed_message(self) -> &'static str {
        match self {
            IndexKind::FullText => "The full-text index can't be updated",
            IndexKind::Semantic => "The semantic index can't be updated",
        }
    }
}

/// A space's index lifecycle: what the dashboard shows, and what a status
/// and a query's notice are derived from.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum IndexState {
    /// Opening the index, or waiting for its turn.
    Starting,
    /// Queued behind another space's build: builds run one at a time.
    Waiting {
        /// Pages the build will commit; for the status and the query
        /// notice, not shown on the dashboard.
        #[serde(skip)]
        total: u64,
    },
    /// The semantic model is downloading (bytes).
    Downloading {
        done: u64,
        total: u64,
    },
    /// A first build or a rebuild: `done` of `total` changed pages committed.
    Building {
        done: u64,
        total: u64,
    },
    /// Answering; `catch_up` is a large reconcile running meanwhile.
    Ready {
        #[serde(rename = "catchUp")]
        catch_up: Option<Progress>,
    },
    Failed {
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexReport {
    pub kind: IndexKind,
    #[serde(flatten)]
    pub state: IndexState,
    /// From the last finished build or catch-up; `None` before the first.
    pub pages: Option<u64>,
    pub bytes: Option<u64>,
    pub memory: bool,
    /// How long the last full build took (not a catch-up), in seconds.
    pub build_secs: Option<f64>,
}

impl IndexState {
    pub fn is_ready(&self) -> bool {
        matches!(self, IndexState::Ready { .. })
    }

    /// Pages committed of those a build or a catch-up changes; `None`
    /// otherwise (a model download counts bytes, not pages).
    pub fn progress(&self) -> Option<Progress> {
        match self {
            IndexState::Building { done, total } => Some(Progress {
                done: *done,
                total: *total,
            }),
            IndexState::Waiting { total } => Some(Progress {
                done: 0,
                total: *total,
            }),
            IndexState::Ready { catch_up } => *catch_up,
            IndexState::Starting | IndexState::Downloading { .. } | IndexState::Failed { .. } => {
                None
            }
        }
    }
}

impl IndexReport {
    /// An index that isn't open yet.
    pub(crate) fn starting(kind: IndexKind) -> IndexReport {
        IndexReport {
            kind,
            state: IndexState::Starting,
            pages: None,
            bytes: None,
            memory: false,
            build_secs: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_serialise_flat_and_camel_case() {
        let r = IndexReport {
            kind: IndexKind::FullText,
            state: IndexState::Ready {
                catch_up: Some(Progress { done: 1, total: 4 }),
            },
            pages: Some(3),
            bytes: Some(20_480),
            memory: true,
            build_secs: Some(0.5),
        };
        assert_eq!(
            serde_json::to_value(&r).unwrap(),
            serde_json::json!({"kind":"fullText","state":"ready","catchUp":{"done":1,"total":4},"pages":3,"bytes":20480,"memory":true,"buildSecs":0.5})
        );
        let building = IndexReport {
            kind: IndexKind::Semantic,
            state: IndexState::Building {
                done: 12,
                total: 40,
            },
            ..IndexReport::starting(IndexKind::Semantic)
        };
        assert_eq!(
            serde_json::to_value(&building).unwrap(),
            serde_json::json!({"kind":"semantic","state":"building","done":12,"total":40,"pages":null,"bytes":null,"memory":false,"buildSecs":null})
        );
        let failed = IndexState::Failed {
            reason: "Disk full".into(),
        };
        assert_eq!(
            serde_json::to_value(&failed).unwrap(),
            serde_json::json!({"state":"failed","reason":"Disk full"})
        );
        assert_eq!(
            serde_json::to_value(IndexState::Waiting { total: 7 }).unwrap(),
            serde_json::json!({"state":"waiting"})
        );
    }
}
