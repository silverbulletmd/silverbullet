use std::sync::Arc;

use serde::Serialize;

/// Who a request is from. `username` is the verified account name (absent for
/// anonymous credentials and for deployments without accounts at all);
/// `full_name` and `email` come from wherever that deployment keeps profiles.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub username: Option<String>,
    pub full_name: Option<String>,
    pub email: Option<String>,
}

/// Turns the verified username on a request into a full identity. Multi-space
/// servers resolve against `users.json`; the App resolves against its own
/// settings; a plain single-space server has nothing to add.
pub trait IdentityResolver: Send + Sync {
    fn resolve(&self, username: Option<&str>) -> UserProfile;

    /// Every account with access to this space, or `None` where the deployment
    /// keeps no accounts at all.
    fn accounts(&self) -> Option<Vec<UserProfile>> {
        None
    }
}

struct UsernameOnly;

impl IdentityResolver for UsernameOnly {
    fn resolve(&self, username: Option<&str>) -> UserProfile {
        UserProfile {
            username: username.map(str::to_string),
            ..Default::default()
        }
    }
}

pub fn username_only() -> Arc<dyn IdentityResolver> {
    Arc::new(UsernameOnly)
}

/// `<`, `>` and line breaks would either be rejected by git or let a value
/// forge extra commit headers, so they are refused rather than escaped.
fn clean_ident_field(field: &str, value: &str) -> Result<Option<String>, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.contains(['<', '>', '\n', '\r']) {
        return Err(format!("{field} must not contain <, > or line breaks"));
    }
    Ok(Some(value.to_string()))
}

pub fn clean_full_name(value: &str) -> Result<Option<String>, String> {
    clean_ident_field("full name", value)
}

pub fn clean_email(value: &str) -> Result<Option<String>, String> {
    let email = clean_ident_field("email", value)?;
    if let Some(email) = &email {
        if email.contains(char::is_whitespace) {
            return Err("email must not contain whitespace".into());
        }
    }
    Ok(email)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn username_only_passes_the_username_through_and_adds_nothing() {
        let resolver = username_only();
        assert_eq!(
            resolver.resolve(Some("ada")),
            UserProfile {
                username: Some("ada".into()),
                full_name: None,
                email: None,
            }
        );
        assert_eq!(resolver.resolve(None), UserProfile::default());
    }
}
