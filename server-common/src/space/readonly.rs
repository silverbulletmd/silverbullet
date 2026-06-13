//! A `SpacePrimitives` wrapper that makes any inner space read-only: reads pass
//! through; writes and deletes are rejected. Used for `SB_READ_ONLY` servers.

use crate::types::{FileMeta, SpaceError, SpacePrimitives};

pub struct ReadOnlySpacePrimitives {
    inner: Box<dyn SpacePrimitives>,
}

impl ReadOnlySpacePrimitives {
    pub fn new(inner: Box<dyn SpacePrimitives>) -> Self {
        Self { inner }
    }
}

impl SpacePrimitives for ReadOnlySpacePrimitives {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
        self.inner.fetch_file_list()
    }
    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
        self.inner.get_file_meta(path)
    }
    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        self.inner.read_file(path)
    }
    fn write_file(
        &self,
        path: &str,
        _data: &[u8],
        _meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError> {
        Err(SpaceError::WriteError(format!(
            "Cannot write file {path}: read-only mode"
        )))
    }
    fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
        Err(SpaceError::WriteError(format!(
            "Cannot delete file {path}: read-only mode"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::space::MemorySpacePrimitives;

    fn ro() -> ReadOnlySpacePrimitives {
        let inner = MemorySpacePrimitives::new();
        inner.write_file("a.md", b"hi", None).unwrap();
        ReadOnlySpacePrimitives::new(Box::new(inner))
    }

    #[test]
    fn reads_pass_through() {
        let ro = ro();
        let (data, _) = ro.read_file("a.md").unwrap();
        assert_eq!(data, b"hi");
        assert_eq!(ro.fetch_file_list().unwrap().len(), 1);
    }

    #[test]
    fn writes_and_deletes_are_rejected() {
        let ro = ro();
        assert!(ro.write_file("b.md", b"x", None).is_err());
        assert!(ro.delete_file("a.md").is_err());
        // The underlying file is untouched.
        assert!(ro.read_file("a.md").is_ok());
    }
}
