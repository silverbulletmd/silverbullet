//! The documentation site matching a build.

const STABLE_DOCS: &str = "https://docs.silverbullet.md";
const EDGE_DOCS: &str = "https://edge.silverbullet.md";

/// Documentation site matching the build. Releases are `git describe --tags
/// --long` output with zero commits after the tag (`2.12.1-0-g4d5eac537-<ts>`,
/// or a bare `2.12.1`); N>0 commits, the `0.0.0` fallback and anything
/// unparsable are edge builds.
pub fn docs_url(version: &str) -> &'static str {
    let is_triple = |s: &str| {
        let parts: Vec<&str> = s.split('.').collect();
        parts.len() == 3
            && parts
                .iter()
                .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
    };
    let stable = if is_triple(version) {
        version != "0.0.0"
    } else {
        let mut parts = version.splitn(3, '-');
        matches!(
            (parts.next(), parts.next(), parts.next()),
            (Some(tag), Some("0"), Some(rest)) if is_triple(tag) && tag != "0.0.0" && rest.starts_with('g')
        )
    };
    if stable {
        STABLE_DOCS
    } else {
        EDGE_DOCS
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn releases_link_stable_docs_and_the_rest_edge() {
        assert_eq!(docs_url("2.12.1"), STABLE_DOCS);
        assert_eq!(docs_url("2.12.1-0-g4d5eac537-20261103"), STABLE_DOCS);
        assert_eq!(docs_url("2.12.1-3-g4d5eac537"), EDGE_DOCS);
        assert_eq!(docs_url("0.0.0"), EDGE_DOCS);
        assert_eq!(docs_url("dev"), EDGE_DOCS);
    }
}
