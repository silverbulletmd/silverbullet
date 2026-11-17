use silverbullet_server::auth::handoff::{Handoff, Handoffs};
fn grant() -> Handoff {
    Handoff {
        scope: "/".into(),
        destination: "https://notes.test/Page?x=1".into(),
        binding: "browser-a".into(),
        username: "morgan".into(),
        credential_version: Some("epoch-1".into()),
        session_id: "session-a".into(),
        shared: false,
        encrypt: false,
    }
}
#[test]
fn accepts_only_once_on_the_bound_origin_and_browser() {
    let store = Handoffs::default();
    let code = store.issue(grant(), 100).unwrap();
    let used = store
        .consume(&code, "https://notes.test", "browser-a", 110)
        .unwrap();
    assert_eq!(used.username, "morgan");
    assert!(store
        .consume(&code, "https://notes.test", "browser-a", 111)
        .is_none());
}
#[test]
fn rejects_foreign_origins_browsers_and_expiration() {
    for (origin, binding, now) in [
        ("https://evil.test", "browser-a", 110),
        ("https://notes.test", "browser-b", 110),
        ("https://notes.test", "browser-a", 160),
    ] {
        let store = Handoffs::default();
        let code = store.issue(grant(), 100).unwrap();
        assert!(store.consume(&code, origin, binding, now).is_none());
    }
}
