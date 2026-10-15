//! The admin API for search: which model semantic search runs with (and the
//! models on disk), each space's indexes and their rebuild. Nested with the
//! rest of the admin API under `/.dashboard/api/admin/`, behind its gate.
//! What it reports is built in `crate::search::report`.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::extract::{Path as AxumPath, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Serialize;
use silverbullet_server_search::SearchError;

use super::admin_api::{api_error, error_response, AdminState};
use super::instance::SpaceInstance;
use super::manager::ApiError;
use super::validate::FieldError;
use crate::router::run_blocking;
use crate::search::{
    model_card, RemoveModelError, SearchModelCard, SpaceSearch, SpaceSearchInfo, SpaceSearchStatus,
};

const NO_INDEX: &str = "This space has no search index to rebuild.";

pub(super) fn routes() -> Router<Arc<AdminState>> {
    Router::new()
        .route("/search", get(handle_overview).put(handle_set_model))
        .route("/search/models/{id}", delete(handle_remove_model))
        .route("/spaces/{id}/search", get(handle_space))
        .route("/spaces/{id}/search/rebuild", post(handle_rebuild))
}

/// `GET search`: the model card, and each space's search state and indexes.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchOverview {
    #[serde(flatten)]
    card: SearchModelCard,
    spaces: BTreeMap<String, SpaceSearchRow>,
}

/// A space's row in the overview's index status table.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpaceSearchRow {
    name: String,
    #[serde(flatten)]
    status: SpaceSearchStatus,
}

fn row(search: &SpaceSearch, instance: &SpaceInstance) -> SpaceSearchRow {
    SpaceSearchRow {
        name: instance.config.name.clone(),
        status: search.space_status(
            &instance.id,
            instance.config.semantic_search,
            instance.search.as_deref(),
            instance.pages(),
        ),
    }
}

fn overview(state: &AdminState) -> SearchOverview {
    let search = state.manager.search();
    let spaces = state
        .manager
        .search_instances()
        .into_iter()
        .map(|(id, instance)| (id, row(search, &instance)))
        .collect();
    SearchOverview {
        card: model_card(search),
        spaces,
    }
}

/// `overview` takes the manager lock (held through a model switch) and walks
/// the model store, so it runs off the async workers.
async fn handle_overview(State(state): State<Arc<AdminState>>) -> Response {
    match run_blocking(move || Ok(overview(&state))).await {
        Ok(overview) => Json(overview).into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

fn model_error(message: &str) -> Response {
    api_error(ApiError::Validation(vec![FieldError {
        field: "model".into(),
        message: message.into(),
    }]))
}

/// `PUT search` `{"model": "<id>" | null}`: switches the model and answers
/// with the new overview.
async fn handle_set_model(
    State(state): State<Arc<AdminState>>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let model = match body.get("model") {
        None => return model_error("model is required"),
        Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(id)) => Some(id.clone()),
        Some(_) => return model_error("model must be a model id or null"),
    };
    let result = run_blocking(move || {
        Ok(state
            .manager
            .set_search_model(model.as_deref())
            .map(|()| overview(&state)))
    })
    .await;
    match result {
        Ok(Ok(overview)) => Json(overview).into_response(),
        Ok(Err(e)) => api_error(e),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

/// `DELETE search/models/{id}`: deletes an offered model's files, unless it
/// is the one in use.
async fn handle_remove_model(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    let search = state.manager.search().clone();
    match run_blocking(move || Ok(search.remove_offered_model(&id))).await {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(error @ RemoveModelError::Unknown)) => {
            error_response(StatusCode::NOT_FOUND, "id", &error.to_string())
        }
        Ok(Err(error @ RemoveModelError::InUse)) => {
            api_error(ApiError::Conflict(error.to_string()))
        }
        Ok(Err(error)) => api_error(ApiError::Internal(error.to_string())),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "task failed").into_response(),
    }
}

/// The search info of `instance`'s space, with its offer.
fn space_info(state: &AdminState, instance: &SpaceInstance) -> SpaceSearchInfo {
    state.manager.search().space_info(
        &instance.id,
        instance.config.semantic_search,
        instance.search.as_deref(),
        instance.pages(),
    )
}

async fn handle_space(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    match state.manager.instance(&id) {
        Some(instance) => Json(space_info(&state, &instance)).into_response(),
        None => api_error(ApiError::NotFound),
    }
}

/// `POST spaces/{id}/search/rebuild`: starts rebuilding every index of the
/// space (a rebuild already running continues) and answers 202 with its
/// state.
async fn handle_rebuild(
    State(state): State<Arc<AdminState>>,
    AxumPath(id): AxumPath<String>,
) -> Response {
    let Some(instance) = state.manager.instance(&id) else {
        return api_error(ApiError::NotFound);
    };
    let Some(search) = instance.search.clone() else {
        return api_error(ApiError::Conflict(NO_INDEX.into()));
    };
    match search.rebuild() {
        Ok(()) => {}
        Err(SearchError::Unsupported(_)) => return api_error(ApiError::Conflict(NO_INDEX.into())),
        Err(SearchError::Unavailable(message)) => return api_error(ApiError::Conflict(message)),
        Err(error) => return api_error(ApiError::Internal(error.to_string())),
    }
    let info = space_info(&state, &instance);
    (StatusCode::ACCEPTED, Json(info)).into_response()
}

#[cfg(test)]
mod tests;
