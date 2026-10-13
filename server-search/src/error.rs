#[derive(Debug, thiserror::Error, PartialEq)]
pub enum SearchError {
    #[error("{0}")]
    Invalid(String),
    #[error("Type at least {0} characters to search")]
    QueryTooShort(usize),
    #[error("This search backend does not support {0}")]
    Unsupported(&'static str),
    #[error("Search is busy; try again in a moment")]
    Busy,
    #[error("{0}")]
    Unavailable(String),
    #[error("Superseded by a newer search")]
    Cancelled,
    #[error("Search failed: {0}")]
    Failed(String),
}

impl SearchError {
    /// Stable machine-readable code returned in HTTP error bodies.
    pub fn code(&self) -> &'static str {
        match self {
            SearchError::Invalid(_) => "invalid",
            SearchError::QueryTooShort(_) => "query-too-short",
            SearchError::Unsupported(_) => "unsupported",
            SearchError::Busy => "busy",
            SearchError::Unavailable(_) => "unavailable",
            SearchError::Cancelled => "cancelled",
            SearchError::Failed(_) => "failed",
        }
    }
}
