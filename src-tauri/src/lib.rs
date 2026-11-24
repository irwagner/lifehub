use std::path::PathBuf;
use tauri::Manager;

const DB_FILENAME: &str = "lifehub.db";

fn resolve_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Não foi possível localizar a pasta de dados do app: {e}"))?;
    Ok(config_dir.join(DB_FILENAME))
}

#[tauri::command]
fn get_db_file_path(app: tauri::AppHandle) -> Result<String, String> {
    let path = resolve_db_path(&app)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn export_sqlite_bytes(app: tauri::AppHandle) -> Result<Vec<u8>, String> {
    let path = resolve_db_path(&app)?;
    if !path.exists() {
        return Err(format!(
            "Arquivo SQLite ainda não encontrado em {}",
            path.display()
        ));
    }
    std::fs::read(&path).map_err(|e| format!("Erro ao ler arquivo SQLite: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_db_file_path,
            export_sqlite_bytes
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar o aplicativo LifeHub");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_filename_is_lifehub_db() {
        assert_eq!(DB_FILENAME, "lifehub.db");
    }
}
