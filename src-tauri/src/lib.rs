use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const DB_FILENAME: &str = "lifehub.db";
const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
const MIN_EXE_BYTES: usize = 1_000_000; // 1 MB minimum sanity check for valid Windows binary

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

pub fn validate_github_release_url(url: &str) -> Result<(), String> {
    let allowed = url.starts_with("https://github.com/irwagner/lifehub/releases/download/")
        || url.starts_with("https://objects.githubusercontent.com/")
        || url.starts_with("https://release-assets.githubusercontent.com/");
    if !allowed {
        return Err("URL de atualização não autorizada. Apenas releases oficiais de irwagner/lifehub são permitidas.".to_string());
    }
    Ok(())
}

pub fn validate_pe_executable_bytes(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < MIN_EXE_BYTES {
        return Err("Arquivo baixado é muito pequeno para ser um executável válido do LifeHub.".to_string());
    }
    if bytes.len() < 2 || bytes[0] != b'M' || bytes[1] != b'Z' {
        return Err("O arquivo baixado não é um executável Windows válido (cabeçalho MZ ausente).".to_string());
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
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
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
        Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Erro ao abrir Explorer: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn download_and_apply_update(
    app: tauri::AppHandle,
    download_url: String,
    is_installer: bool,
) -> Result<String, String> {
    validate_github_release_url(&download_url)?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let temp_dir = std::env::temp_dir();
    let downloaded_path = temp_dir.join(format!("lifehub-update-{ts}.exe"));

    #[cfg(target_os = "windows")]
    {
        let status = Command::new("curl.exe")
            .args([
                "-fsSL",
                "--retry",
                "2",
                "--connect-timeout",
                "20",
                "-o",
                &downloaded_path.to_string_lossy(),
                &download_url,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| format!("Falha ao executar download da atualização: {e}"))?;

        if !status.success() {
            let _ = fs::remove_file(&downloaded_path);
            return Err("Não foi possível baixar o arquivo da nova versão no GitHub.".to_string());
        }

        let bytes = fs::read(&downloaded_path)
            .map_err(|e| format!("Erro ao validar arquivo baixado: {e}"))?;
        if let Err(err) = validate_pe_executable_bytes(&bytes) {
            let _ = fs::remove_file(&downloaded_path);
            return Err(err);
        }

        if is_installer {
            Command::new(&downloaded_path)
                .spawn()
                .map_err(|e| format!("Erro ao iniciar o instalador da atualização: {e}"))?;
            app.exit(0);
            return Ok("Instalador iniciado.".to_string());
        }

        let current_exe = std::env::current_exe()
            .map_err(|e| format!("Não foi possível localizar o executável atual: {e}"))?;
        let current_exe_str = current_exe.to_string_lossy().to_string();
        let downloaded_str = downloaded_path.to_string_lossy().to_string();
        let backup_exe_str = format!("{current_exe_str}.old");
        let pid = std::process::id();
        let script_path = temp_dir.join(format!("lifehub-apply-{ts}.cmd"));

        let script = format!(
            "@echo off\r\n\
            setlocal\r\n\
            :wait_exit\r\n\
            tasklist /FI \"PID eq {pid}\" 2>NUL | find /I \"{pid}\" >NUL\r\n\
            if not errorlevel 1 (\r\n\
              timeout /t 1 /nobreak >NUL\r\n\
              goto wait_exit\r\n\
            )\r\n\
            timeout /t 1 /nobreak >NUL\r\n\
            if exist \"{backup_exe_str}\" del /f /q \"{backup_exe_str}\" >NUL 2>&1\r\n\
            move /y \"{current_exe_str}\" \"{backup_exe_str}\" >NUL 2>&1\r\n\
            move /y \"{downloaded_str}\" \"{current_exe_str}\" >NUL 2>&1\r\n\
            if errorlevel 1 (\r\n\
              move /y \"{backup_exe_str}\" \"{current_exe_str}\" >NUL 2>&1\r\n\
              exit /b 1\r\n\
            )\r\n\
            start \"\" \"{current_exe_str}\"\r\n\
            timeout /t 2 /nobreak >NUL\r\n\
            if exist \"{backup_exe_str}\" del /f /q \"{backup_exe_str}\" >NUL 2>&1\r\n\
            del /f /q \"%~f0\" >NUL 2>&1\r\n"
        );

        fs::write(&script_path, script)
            .map_err(|e| format!("Erro ao preparar script de atualização: {e}"))?;

        Command::new("cmd.exe")
            .args(["/C", &script_path.to_string_lossy()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Erro ao iniciar processo de atualização automática: {e}"))?;

        app.exit(0);
        return Ok("Atualização pronta; reiniciando LifeHub...".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, downloaded_path, is_installer);
        Err("Auto-atualização nativa disponível apenas no Windows.".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            get_db_file_path,
            export_sqlite_bytes,
            import_sqlite_bytes,
            open_data_folder,
            download_and_apply_update
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

        assert!(replace_sqlite_file_safely(&target, b"not-sqlite").is_err());
        assert_eq!(fs::read(&target).unwrap(), replacement);

        let _ = fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn validates_only_official_github_release_urls() {
        assert!(validate_github_release_url(
            "https://github.com/irwagner/lifehub/releases/download/v0.2.0/LifeHub.exe"
        )
        .is_ok());
        assert!(validate_github_release_url("https://evil.example.com/LifeHub.exe").is_err());
        assert!(validate_github_release_url("http://github.com/irwagner/lifehub/releases/download/v0.2.0/LifeHub.exe").is_err());
    }

    #[test]
    fn validates_windows_pe_executable_header_and_size() {
        assert!(validate_pe_executable_bytes(b"<html>404</html>").is_err());
        let mut fake_exe = vec![0u8; MIN_EXE_BYTES + 16];
        fake_exe[0] = b'M';
        fake_exe[1] = b'Z';
        assert!(validate_pe_executable_bytes(&fake_exe).is_ok());
    }
}
