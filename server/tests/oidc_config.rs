use silverbullet_server::auth::oidc::{config::ProviderConfig, store::ProviderStore};
fn config() -> ProviderConfig {
    ProviderConfig {
        provider_id: String::new(),
        issuer: "https://identity.test".into(),
        central_origin: "https://login.sb.test".into(),
        client_id: "client".into(),
        client_secret: "private-secret".into(),
        workspace_domain: String::new(),
        button_label: "Continue with Pocket ID".into(),
    }
}
#[test]
fn untested_or_edited_configuration_cannot_be_activated() {
    let dir = tempfile::tempdir().unwrap();
    let store = ProviderStore::open(dir.path()).unwrap();
    let rev = store.save_draft(config()).unwrap();
    assert!(store.activate(rev).is_err());
    store.mark_tested(rev).unwrap();
    store.save_draft(config()).unwrap();
    assert!(store.activate(rev).is_err());
}
#[test]
fn activation_survives_restart_without_exposing_the_secret() {
    let dir = tempfile::tempdir().unwrap();
    let store = ProviderStore::open(dir.path()).unwrap();
    let rev = store.save_draft(config()).unwrap();
    store.mark_tested(rev).unwrap();
    store.activate(rev).unwrap();
    let active = ProviderStore::open(dir.path()).unwrap().active().unwrap();
    assert_eq!(active.client_secret, "private-secret");
    assert!(!active.public_json().to_string().contains("private-secret"));
}