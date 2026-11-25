use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const DB_FILENAME: &str = "lifehub.db";
const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";

fn resolve_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Não foi possível localizar a pasta de dados do app: {e}"))?;
    Ok(config_dir.join(DB_FILENAME))
}

pub fn validate_sqlite_bytes(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 100 {
        return Err("Arquivo SQLite inválido ou incompleto.".to_string());
    }
    if &bytes[..16] != SQLITE_MAGIC {
        return Err("O arquivo selecionado não possui cabeçalho SQLite 3 válido.".to_string());
    }
    Ok(())
}

pub fn replace_sqlite_file_safely(target_path: &Path, bytes: &[u8]) -> Result<Option<PathBuf>, String> {
    validate_sqlite_bytes(bytes)?;

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Erro ao criar pasta do banco de dados: {e}"))?;
    }

    let mut backup_path: Option<PathBuf> = None;
    if target_path.exists() {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let bak = target_path.with_extension(format!("db.bak-{ts}"));
        fs::copy(target_path, &bak)
            .map_err(|e| format!("Falha ao criar cópia de segurança antes da restauração: {e}"))?;
        backup_path = Some(bak);
    }

    let tmp_path = target_path.with_extension("db.restore-tmp");
    fs::write(&tmp_path, bytes)
        .map_err(|e| format!("Erro ao gravar arquivo temporário de restauração: {e}"))?;

    // On Windows, fs::rename fails if target exists; remove target only after backup succeeded.
    if target_path.exists() {
        if let Err(e) = fs::remove_file(target_path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!("Não foi possível substituir o arquivo atual (feche outras instâncias): {e}"));
        }
    }

    if let Err(e) = fs::rename(&tmp_path, target_path) {
        if let Some(ref bak) = backup_path {
            let _ = fs::copy(bak, target_path);
        }
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("Erro ao concluir restauração do banco SQLite: {e}"));
    }

    Ok(backup_path)
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
    fs::read(&path).map_err(|e| format!("Erro ao ler arquivo SQLite: {e}"))
}

#[tauri::command]
fn import_sqlite_bytes(app: tauri::AppHandle, bytes: Vec<u8>) -> Result<String, String> {
    let path = resolve_db_path(&app)?;
    let backup = replace_sqlite_file_safely(&path, &bytes)?;
    Ok(backup
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default())
}

#[tauri::command]
fn open_data_folder(app: tauri::AppHandle) -> Result<(), String> {
    let path = resolve_db_path(&app)?;
    let dir = path
        .parent()
        .ok_or_else(|| "Pasta de dados não encontrada.".to_string())?;
    fs::create_dir_all(dir).map_err(|e| format!("Erro ao preparar pasta de dados: {e}"))?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Erro ao abrir Explorer: {e}"))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_db_file_path,
            export_sqlite_bytes,
            import_sqlite_bytes,
            open_data_folder
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar o aplicativo LifeHub");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_valid_sqlite_payload(marker: u8) -> Vec<u8> {
        let mut buf = vec![marker; 256];
        buf[..16].copy_from_slice(SQLITE_MAGIC);
        buf
    }

    #[test]
    fn db_filename_is_lifehub_db() {
        assert_eq!(DB_FILENAME, "lifehub.db");
    }

    #[test]
    fn rejects_invalid_sqlite_header_and_short_files() {
        assert!(validate_sqlite_bytes(&[1, 2, 3]).is_err());
        assert!(validate_sqlite_bytes(&[0u8; 256]).is_err());
        assert!(validate_sqlite_bytes(&fake_valid_sqlite_payload(0x42)).is_ok());
    }

    #[test]
    fn replaces_sqlite_file_atomically_and_preserves_safety_backup() {
        let tmp_dir = std::env::temp_dir().join(format!(
            "lifehub_restore_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp_dir);
        fs::create_dir_all(&tmp_dir).unwrap();

        let target = tmp_dir.join("lifehub.db");
        let original = fake_valid_sqlite_payload(0x11);
        let replacement = fake_valid_sqlite_payload(0x22);
        fs::write(&target, &original).unwrap();

        let backup = replace_sqlite_file_safely(&target, &replacement)
            .expect("restore should succeed")
            .expect("backup should be created");

        assert!(backup.exists());
        assert_eq!(fs::read(&backup).unwrap(), original);
        assert_eq!(fs::read(&target).unwrap(), replacement);

        // Corrupt payload must fail and keep target untouched
        assert!(replace_sqlite_file_safely(&target, b"not-sqlite").is_err());
        assert_eq!(fs::read(&target).unwrap(), replacement);

        let _ = fs::remove_dir_all(&tmp_dir);
    }
}
