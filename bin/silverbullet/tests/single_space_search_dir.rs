//! Review Focus 3: a read-only space with SB_SEARCH_DIR: search works, the
//! index persists outside the space, and the space folder is not written.

mod common;
use common::free_port;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_read_only_space_searches_from_an_index_in_the_search_dir() {
    let dir = tempfile::tempdir().unwrap();
    let space = dir.path().join("Orchard");
    std::fs::create_dir_all(&space).unwrap();
    std::fs::write(space.join("index.md"), "# Orchard\n").unwrap();
    std::fs::write(
        space.join("Pruning.md"),
        "Prune the pear trees in late winter.\n",
    )
    .unwrap();
    let listing = || {
        let mut names: Vec<_> = std::fs::read_dir(&space)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        names.sort();
        names
    };
    let before = listing();
    let search_dir = dir.path().join("orchard-search");
    let port = free_port();
    std::env::set_var("SB_RUNTIME_API", "0");
    std::env::set_var("SB_READ_ONLY", "1");
    std::env::set_var("SB_SEARCH_DIR", &search_dir);
    let folder = space.to_str().unwrap().to_string();
    let handle = tokio::spawn(async move {
        let _ = silverbullet::server::run(Some("127.0.0.1".into()), Some(port), Some(folder), true)
            .await;
    });
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    let mut found = None;
    for _ in 0..100 {
        if let Ok(response) = client
            .post(format!("{base}/.search/query"))
            .json(&serde_json::json!({"query": "pear trees", "limit": 10}))
            .send()
            .await
        {
            if let Ok(body) = response.json::<serde_json::Value>().await {
                if body["items"]
                    .as_array()
                    .is_some_and(|items| !items.is_empty())
                {
                    found = Some(body);
                    break;
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    let found = found.expect("search answered from the index");
    assert_eq!(found["items"][0]["page"], "Pruning");
    assert!(
        search_dir.join("indexes/single").is_dir(),
        "index persisted outside the space"
    );
    assert_eq!(before, listing(), "nothing written into the space folder");
    handle.abort();
}
