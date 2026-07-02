use askama::Template;
use axum::extract::{Path, State};
use axum::response::IntoResponse;

use crate::error::{render_template, AppError};
use crate::models::game;
use crate::AppState;

#[derive(Template)]
#[template(path = "games/gallery.html")]
struct GalleryTemplate {
    games: Vec<game::Game>,
}

pub async fn gallery(State(state): State<AppState>) -> Result<impl IntoResponse, AppError> {
    let games = game::list_published(&state.db).await?;
    render_template(&GalleryTemplate { games })
}

#[derive(Template)]
#[template(path = "games/play.html")]
struct PlayTemplate {
    game: game::Game,
}

pub async fn play(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let g = game::get_game(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound("game not found".to_string()))?;

    let db = state.db.clone();
    let game_id = g.id.clone();
    tokio::spawn(async move {
        let _ = game::increment_play_count(&db, &game_id).await;
    });

    render_template(&PlayTemplate { game: g })
}
