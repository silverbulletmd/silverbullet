//! Naming a space by its id or its name.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpaceRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpaceLookupError {
    NotFound,
    /// The spaces whose names match, ignoring case.
    Ambiguous(Vec<SpaceRef>),
}

/// The id of the space `wanted` names: an exact id wins, then a name
/// (ignoring case) that only one of `spaces` has.
pub fn resolve_space(spaces: &[SpaceRef], wanted: &str) -> Result<String, SpaceLookupError> {
    if let Some(space) = spaces.iter().find(|s| s.id == wanted) {
        return Ok(space.id.clone());
    }
    let lower = wanted.to_lowercase();
    let named: Vec<&SpaceRef> = spaces
        .iter()
        .filter(|s| s.name.to_lowercase() == lower)
        .collect();
    match named.as_slice() {
        [only] => Ok(only.id.clone()),
        [] => Err(SpaceLookupError::NotFound),
        _ => Err(SpaceLookupError::Ambiguous(
            named.into_iter().cloned().collect(),
        )),
    }
}

pub fn not_available_message(wanted: &str, spaces: &[SpaceRef]) -> String {
    let known: Vec<String> = spaces
        .iter()
        .map(|s| format!("{} (id `{}`)", s.name, s.id))
        .collect();
    let choices = if known.is_empty() {
        "You have no spaces you can write to.".to_owned()
    } else {
        format!("Available: {}.", known.join(", "))
    };
    format!("space \"{wanted}\" is not available. {choices}")
}

pub fn ambiguous_message(wanted: &str, several: &[SpaceRef]) -> String {
    let list: Vec<String> = several
        .iter()
        .map(|s| format!("`{}` ({})", s.id, s.name))
        .collect();
    format!(
        "Several of your spaces are named \"{wanted}\": {}. Pass the id instead.",
        list.join(", ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn space(id: &str, name: &str) -> SpaceRef {
        SpaceRef {
            id: id.to_owned(),
            name: name.to_owned(),
        }
    }

    #[test]
    fn exact_id_wins_over_a_name() {
        let spaces = [space("notes", "Recipes"), space("r1", "notes")];
        assert_eq!(resolve_space(&spaces, "notes"), Ok("notes".to_owned()));
    }

    #[test]
    fn name_matches_ignoring_case_when_unique() {
        let spaces = [space("n1", "Notes"), space("r1", "Recipes")];
        assert_eq!(resolve_space(&spaces, "notes"), Ok("n1".to_owned()));
        assert_eq!(
            resolve_space(&spaces, "fixture"),
            Err(SpaceLookupError::NotFound)
        );
    }

    #[test]
    fn two_case_insensitive_matches_are_ambiguous() {
        let spaces = [space("n1", "Notes"), space("n2", "notes")];
        assert_eq!(
            resolve_space(&spaces, "NOTES"),
            Err(SpaceLookupError::Ambiguous(spaces.to_vec()))
        );
        assert_eq!(
            ambiguous_message("NOTES", &spaces),
            "Several of your spaces are named \"NOTES\": `n1` (Notes), `n2` (notes). Pass the id instead."
        );
    }

    #[test]
    fn not_available_lists_names_and_ids() {
        let spaces = [space("n1", "Notes"), space("r1", "Recipes")];
        assert_eq!(
            not_available_message("x", &spaces),
            "space \"x\" is not available. Available: Notes (id `n1`), Recipes (id `r1`)."
        );
    }

    #[test]
    fn no_spaces_says_so() {
        assert_eq!(
            not_available_message("x", &[]),
            "space \"x\" is not available. You have no spaces you can write to."
        );
    }
}
