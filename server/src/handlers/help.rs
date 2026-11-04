//! `GET /.help`: the space's skills and an outline of its pages, as the data
//! both the MCP's `help` and `sb help` render.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use silverbullet_server_search::FileStamp;
use space_tools::help::{
    FolderCount, HelpData, Outline, TagSummary, OUTLINE_ATTRIBUTES, OUTLINE_PAGES, OUTLINE_TAGS,
    SCAN_WAIT_SECS,
};
use space_tools::paths::path_to_page;
use space_tools::skills::merge_skills;

use crate::auth::{AccessLevel, Actor};
use crate::handlers::space_error_response;
use crate::page_watch::is_bundled;
use crate::router::run_blocking;
use crate::state::ServerState;

const SCAN_WAIT: Duration = Duration::from_secs(SCAN_WAIT_SECS);
const AGENTS_PAGE: &str = "AGENTS";

pub async fn handle_help(
    State(state): State<Arc<ServerState>>,
    Extension(actor): Extension<Actor>,
) -> Response {
    let st = state.clone();
    let listed = run_blocking(move || {
        let bundled = st.page_watch.bundled_skills(st.space.as_ref());
        let listing = match st.page_watch.pages() {
            Some(source) => source.view.list_meta().ok_or_else(|| {
                silverbullet_server_common::SpaceError::Io(std::io::Error::other(
                    "could not list the space's pages",
                ))
            })?,
            None => fs_listing(&st)?,
        };
        Ok((bundled, listing))
    })
    .await;
    let (bundled, listing) = match listed {
        Ok(listed) => listed,
        Err(e) => return space_error_response(e),
    };

    let (skills, scanning, tags) = match state.page_watch.catalog() {
        Some(catalog) => match catalog.skills(SCAN_WAIT).await {
            Some(own) => (
                merge_skills(&bundled, own),
                false,
                catalog.tags(Duration::ZERO).await.unwrap_or_default(),
            ),
            None => (bundled, true, Vec::new()),
        },
        None => (bundled, false, Vec::new()),
    };

    Json(HelpData {
        version: 1,
        runtime: runtime_allowed(&state, &actor),
        scanning,
        skills,
        outline: outline(&listing, tags),
    })
    .into_response()
}

/// Mirrors the refusals of `RuntimeBackend::for_actor` without calling it,
/// because that starts a runtime for the actor.
fn runtime_allowed(state: &ServerState, actor: &Actor) -> bool {
    state.runtime.as_ref().is_some_and(|r| r.enabled())
        && actor.level == AccessLevel::Write
        && state
            .access_policy
            .runtime_allowed(actor.username.as_deref())
}

/// The space's files as `GET /.fs` lists them, without the bundled ones.
fn fs_listing(
    state: &ServerState,
) -> Result<HashMap<String, FileStamp>, silverbullet_server_common::SpaceError> {
    Ok(state
        .space
        .fetch_file_list()?
        .into_iter()
        .filter(|f| !is_bundled(&f.name, &f.perm))
        .map(|f| {
            let stamp = FileStamp {
                modified: f.last_modified,
                size: u64::try_from(f.size).unwrap_or(0),
            };
            (f.name, stamp)
        })
        .collect())
}

fn outline(listing: &HashMap<String, FileStamp>, tags: Vec<TagSummary>) -> Outline {
    let mut folders: BTreeMap<&str, usize> = BTreeMap::new();
    let mut pages: Vec<String> = Vec::new();
    for path in listing.keys().filter(|p| p.ends_with(".md")) {
        match path.split_once('/') {
            Some((folder, _)) => *folders.entry(folder).or_default() += 1,
            None => pages.push(path_to_page(path)),
        }
    }
    pages.sort();
    Outline {
        folders: folders
            .into_iter()
            .map(|(name, pages)| FolderCount {
                name: name.to_owned(),
                pages,
            })
            .collect(),
        agents: pages.iter().any(|p| p == AGENTS_PAGE),
        page_count: pages.len(),
        pages: pages.into_iter().take(OUTLINE_PAGES).collect(),
        tags: tags
            .into_iter()
            .take(OUTLINE_TAGS)
            .map(|mut tag| {
                tag.attributes.truncate(OUTLINE_ATTRIBUTES);
                tag
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use silverbullet_server_common::space::GitignoreMatcher;
    use silverbullet_server_common::space::{FallthroughSpacePrimitives, MemorySpacePrimitives};
    use silverbullet_server_common::{FileMeta, SpaceError, SpacePrimitives};
    use space_tools::help::{FolderCount, HelpData, TagSummary};
    use space_tools::skills::SkillSource;
    use tower::ServiceExt;

    use crate::auth::{AccessLevel, AuthContext, AuthOutcome, RequestAuthorizer};
    use crate::page_watch::PageWatch;
    use crate::search::{PageSource, SpaceSearchView};
    use crate::state::ServerState;
    use crate::test_support::test_state;

    /// A read-only base layer, as the bundled `Library/Std` files are served.
    struct BaseLayer(MemorySpacePrimitives);

    impl BaseLayer {
        fn ro(mut meta: FileMeta) -> FileMeta {
            meta.perm = "ro".into();
            meta
        }
    }

    impl SpacePrimitives for BaseLayer {
        fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
            Ok(self
                .0
                .fetch_file_list()?
                .into_iter()
                .map(Self::ro)
                .collect())
        }
        fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
            self.0.get_file_meta(path).map(Self::ro)
        }
        fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
            self.0
                .read_file(path)
                .map(|(data, meta)| (data, Self::ro(meta)))
        }
        fn write_file(
            &self,
            path: &str,
            _data: &[u8],
            _meta: Option<&FileMeta>,
        ) -> Result<FileMeta, SpaceError> {
            Err(SpaceError::ReadOnly(path.into()))
        }
        fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
            Err(SpaceError::ReadOnly(path.into()))
        }
    }

    fn write(space: &dyn SpacePrimitives, path: &str, text: &str) {
        space.write_file(path, text.as_bytes(), None).unwrap();
    }

    /// A space whose own pages are `own` over a base layer of `bundled`, its
    /// pages followed when `followed`.
    fn state(own: &[(&str, &str)], bundled: &[(&str, &str)], followed: bool) -> ServerState {
        let user = Arc::new(MemorySpacePrimitives::new());
        for (path, text) in own {
            write(user.as_ref(), path, text);
        }
        let base = MemorySpacePrimitives::new();
        for (path, text) in bundled {
            write(&base, path, text);
        }
        let mut state = test_state();
        state.space = Arc::new(FallthroughSpacePrimitives::new(
            Box::new(user.clone()),
            Box::new(BaseLayer(base)),
        ));
        let pages = followed.then(|| {
            PageSource::new(
                Arc::new(SpaceSearchView::new(user, GitignoreMatcher::default())),
                tokio::sync::broadcast::channel(4).0,
            )
        });
        state.page_watch = Arc::new(PageWatch::new(pages));
        state
    }

    async fn get(state: Arc<ServerState>, uri: &str) -> axum::response::Response {
        crate::build_router(state)
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    async fn help(state: ServerState) -> HelpData {
        let response = get(Arc::new(state), "/.help").await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    const QUERYING: &str =
        "---\ntags: meta/skill\ndescription: Use when querying.\n---\n# Querying\n";
    const FILING: &str = "---\ntags: meta/skill\ndescription: Use when filing.\n---\n# Filing\n";

    #[tokio::test]
    async fn help_lists_bundled_and_own_skills() {
        let data = help(state(
            &[("Guides/Filing.md", FILING)],
            &[("Library/Std/Docs/Querying.md", QUERYING)],
            true,
        ))
        .await;
        assert_eq!(data.version, 1);
        assert!(!data.scanning);
        let skills: Vec<(&str, SkillSource)> = data
            .skills
            .iter()
            .map(|s| (s.page.as_str(), s.source))
            .collect();
        assert_eq!(
            skills,
            vec![
                ("Guides/Filing", SkillSource::Space),
                ("Library/Std/Docs/Querying", SkillSource::Std),
            ]
        );
        assert!(data.skills.iter().all(|s| !s.overrides_bundled));
    }

    #[tokio::test]
    async fn help_outline_counts_folders_pages_and_tags() {
        let project = "---\ntags: project\nstatus: open\n---\n# Project\n";
        let data = help(state(
            &[
                ("Projects/Alpha.md", project),
                ("Projects/Beta.md", project),
                ("Projects/Gamma.md", project),
                ("AGENTS.md", "# Notes for assistants\n"),
            ],
            &[("Library/Std/Docs/Querying.md", QUERYING)],
            true,
        ))
        .await;
        assert_eq!(
            data.outline.folders,
            vec![FolderCount {
                name: "Projects".into(),
                pages: 3
            }]
        );
        assert!(data.outline.agents);
        assert_eq!(data.outline.pages, vec!["AGENTS".to_string()]);
        assert_eq!(data.outline.page_count, 1);
        assert_eq!(
            data.outline.tags[0],
            TagSummary {
                tag: "project".into(),
                pages: 3,
                attributes: vec!["status".into()],
            }
        );
    }

    #[tokio::test]
    async fn help_reports_runtime_false_without_backend() {
        let data = help(state(&[], &[], true)).await;
        assert!(!data.runtime);
    }

    #[tokio::test]
    async fn help_without_page_source_uses_a_listing_and_no_tags() {
        let project = "---\ntags: project\nstatus: open\n---\n# Project\n";
        let data = help(state(
            &[
                ("Projects/Alpha.md", project),
                ("Guides/Filing.md", FILING),
                ("index.md", "# Home\n"),
            ],
            &[("Library/Std/Docs/Querying.md", QUERYING)],
            false,
        ))
        .await;
        assert!(!data.scanning);
        let pages: Vec<&str> = data.skills.iter().map(|s| s.page.as_str()).collect();
        assert_eq!(pages, vec!["Library/Std/Docs/Querying"]);
        assert_eq!(
            data.outline.folders,
            vec![
                FolderCount {
                    name: "Guides".into(),
                    pages: 1
                },
                FolderCount {
                    name: "Projects".into(),
                    pages: 1
                },
            ]
        );
        assert_eq!(data.outline.pages, vec!["index".to_string()]);
        assert!(data.outline.tags.is_empty());
    }

    struct Fixed(Option<AuthOutcome>);
    impl RequestAuthorizer for Fixed {
        fn authorize(&self, _ctx: &AuthContext) -> Option<AuthOutcome> {
            self.0.clone()
        }
    }

    struct ReadersOnly;
    impl crate::auth::AccessPolicy for ReadersOnly {
        fn level_for(&self, _username: Option<&str>) -> AccessLevel {
            AccessLevel::Read
        }
    }

    fn guarded(outcome: Option<AuthOutcome>) -> Arc<ServerState> {
        let mut state = state(&[("index.md", "# Home\n")], &[], true);
        state.authorizer = Some(Arc::new(Fixed(outcome)));
        state.access_policy = Arc::new(ReadersOnly);
        Arc::new(state)
    }

    #[tokio::test]
    async fn help_refuses_an_unauthenticated_request_to_a_private_space() {
        let state = guarded(None);
        let fs = get(state.clone(), "/.fs").await;
        let help = get(state, "/.help").await;
        assert_eq!(fs.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(help.status(), fs.status());
        assert_eq!(help.headers().get("location"), fs.headers().get("location"));
    }

    #[tokio::test]
    async fn help_refuses_an_anonymous_visitor_of_a_public_space() {
        let state = guarded(Some(AuthOutcome::anonymous()));
        assert_eq!(get(state.clone(), "/.fs").await.status(), StatusCode::OK);
        assert_eq!(
            get(state, "/.help").await.status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn help_answers_an_authenticated_reader() {
        let state = guarded(Some(AuthOutcome::user("ada".into())));
        let response = get(state, "/.help").await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let data: HelpData = serde_json::from_slice(&body).unwrap();
        assert!(!data.runtime);
    }

    #[tokio::test]
    async fn help_answers_a_caller_with_a_grant_and_no_username() {
        let state = guarded(Some(AuthOutcome::trusted()));
        assert_eq!(get(state, "/.help").await.status(), StatusCode::OK);
    }

    /// Only `/.help` itself is the help route: near misses neither demand an
    /// account nor reach the handler.
    #[tokio::test]
    async fn near_miss_paths_are_not_the_help_route() {
        for outcome in [AuthOutcome::anonymous(), AuthOutcome::user("ada".into())] {
            let state = guarded(Some(outcome.clone()));
            for path in ["/.helpers", "/.help/", "/.HELP", "/.Help", "/.help/x"] {
                let response = get(state.clone(), path).await;
                assert_ne!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
                let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                    .await
                    .unwrap();
                assert!(
                    serde_json::from_slice::<HelpData>(&body).is_err(),
                    "{path} answered help data for {outcome:?}"
                );
            }
        }
    }

    /// Fails every listing.
    struct Unlistable;
    impl silverbullet_server_search::SpaceView for Unlistable {
        fn list_meta(
            &self,
        ) -> Option<std::collections::HashMap<String, silverbullet_server_search::FileStamp>>
        {
            None
        }
        fn read(&self, _path: &str) -> Option<Vec<u8>> {
            None
        }
    }

    #[tokio::test]
    async fn a_failed_page_listing_is_an_error_not_an_empty_outline() {
        let mut state = state(&[("index.md", "# Home\n")], &[], false);
        state.page_watch = Arc::new(PageWatch::new(Some(PageSource::new(
            Arc::new(Unlistable),
            tokio::sync::broadcast::channel(4).0,
        ))));
        let response = get(Arc::new(state), "/.help").await;
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
