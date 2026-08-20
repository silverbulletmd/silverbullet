use crate::reconcile::{ReconcileRequest, ReconcileResponse};
use crate::{FileMeta, SpaceError, SpacePrimitives};

/// Conditional/revision-aware operations. Defaults fall back to the
/// unconditional trait methods so non-HTTP backends stay oblivious.
pub trait ConditionalSpacePrimitives: SpacePrimitives {
    /// `precondition`: `Some(MatchesHash(h))` -> If-Match; `Some(NotExists)`
    /// -> If-None-Match: *; `None` -> unconditional.
    /// Returns the written meta plus the new remote content hash when the
    /// server reports one.
    fn write_file_conditional(
        &self,
        path: &str,
        data: &[u8],
        meta: Option<&FileMeta>,
        precondition: Option<WritePrecondition>,
    ) -> Result<(FileMeta, Option<String>), SpaceError> {
        let _ = precondition;
        self.write_file(path, data, meta).map(|m| (m, None))
    }

    fn delete_file_conditional(
        &self,
        path: &str,
        expected_hash: Option<&str>,
    ) -> Result<(), SpaceError> {
        let _ = expected_hash;
        self.delete_file(path)
    }

    /// read_file that also surfaces the remote content hash when available.
    fn read_file_with_hash(
        &self,
        path: &str,
    ) -> Result<(Vec<u8>, FileMeta, Option<String>), SpaceError> {
        self.read_file(path).map(|(d, m)| (d, m, None))
    }

    /// Ok(None) means the remote does not support reconciliation.
    fn reconcile(
        &self,
        _path: &str,
        _request: &ReconcileRequest,
    ) -> Result<Option<ReconcileResponse>, SpaceError> {
        Ok(None)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum WritePrecondition {
    /// If-Match: "sha256:<hash>"
    MatchesHash(String),
    /// If-None-Match: * (create-only)
    NotExists,
}
