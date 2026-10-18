//! Camada nativa do app.
//!
//! Além de abrir a janela, este módulo gerencia o ciclo de vida do motor de voz (Python):
//! - inicia o motor automaticamente quando o app abre (sem precisar de um segundo terminal);
//! - não inicia uma segunda cópia se já houver um motor ouvindo na porta (ex.: iniciado à mão);
//! - encerra o motor quando o app fecha;
//! - expõe comandos para a interface consultar o estado e reiniciar o motor.

use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const PORTA_MOTOR: u16 = 8765;

#[derive(Default)]
struct MotorVoz {
    interno: Mutex<EstadoInterno>,
}

#[derive(Default)]
struct EstadoInterno {
    processo: Option<Child>,
    erro: Option<String>,
}

#[derive(Serialize)]
struct EstadoMotor {
    /// Processo iniciado pelo app e ainda vivo.
    rodando: bool,
    /// Já existe algo respondendo na porta do motor (pode ter sido iniciado manualmente).
    porta_ativa: bool,
    /// Último erro ao tentar iniciar o motor.
    erro: Option<String>,
}

fn porta_em_uso() -> bool {
    let endereco = SocketAddr::from(([127, 0, 0, 1], PORTA_MOTOR));
    TcpStream::connect_timeout(&endereco, Duration::from_millis(300)).is_ok()
}

fn python_do_venv(pasta: &Path) -> Option<PathBuf> {
    let relativo = if cfg!(windows) {
        ["venv/Scripts/python.exe", ".venv/Scripts/python.exe"]
    } else {
        ["venv/bin/python", ".venv/bin/python"]
    };
    relativo.iter().map(|r| pasta.join(r)).find(|p| p.is_file())
}

/// Decide como executar o motor:
/// 1. Executável `motor-voz` empacotado (PyInstaller) ao lado do app — distribuição;
/// 2. `motor.py` em `src-tauri/motor-voz`, usando o Python do venv se existir — desenvolvimento.
fn montar_comando(app: &AppHandle) -> Result<Command, String> {
    let nome_binario = if cfg!(windows) { "motor-voz.exe" } else { "motor-voz" };

    if let Some(pasta_app) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
        let binario = pasta_app.join(nome_binario);
        if binario.is_file() {
            let mut cmd = Command::new(binario);
            cmd.current_dir(&pasta_app);
            if let Ok(recursos) = app.path().resource_dir() {
                let modelo = recursos.join("modelo");
                if modelo.is_dir() {
                    cmd.env("VOSK_MODELO", modelo);
                }
            }
            return Ok(cmd);
        }
    }

    let pasta = Path::new(env!("CARGO_MANIFEST_DIR")).join("motor-voz");
    let script = pasta.join("motor.py");
    if !script.is_file() {
        return Err(format!("motor.py não encontrado em {}", pasta.display()));
    }

    let python = python_do_venv(&pasta)
        .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "python" } else { "python3" }));

    let mut cmd = Command::new(python);
    cmd.arg("-u").arg(script).current_dir(&pasta);
    Ok(cmd)
}

fn iniciar_motor(app: &AppHandle) -> Result<(), String> {
    let motor = app.state::<MotorVoz>();
    let mut interno = motor.interno.lock().unwrap();

    let vivo = interno
        .processo
        .as_mut()
        .is_some_and(|p| matches!(p.try_wait(), Ok(None)));
    if vivo {
        return Ok(()); // já está rodando
    }
    interno.processo = None;

    if porta_em_uso() {
        println!("[MOTOR] Já existe um motor na porta {PORTA_MOTOR}; reutilizando.");
        interno.erro = None;
        return Ok(());
    }

    let mut cmd = montar_comando(app)?;
    cmd.env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1")
        .env("MOTOR_VOZ_PORTA", PORTA_MOTOR.to_string())
        // O motor encerra sozinho quando este pipe fecha (app fechou ou travou)
        .env("MOTOR_VOZ_VIGIAR_STDIN", "1")
        .stdin(Stdio::piped());

    if cfg!(debug_assertions) {
        // Em `tauri dev`, os logs do Python aparecem no mesmo terminal
        cmd.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    } else {
        cmd.stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.spawn() {
        Ok(processo) => {
            println!("[MOTOR] Motor de voz iniciado (pid {}).", processo.id());
            interno.processo = Some(processo);
            interno.erro = None;
            Ok(())
        }
        Err(e) => {
            let mensagem = if e.kind() == std::io::ErrorKind::NotFound {
                "Python não encontrado. Instale o Python ou crie o venv em src-tauri/motor-voz.".to_string()
            } else {
                format!("Falha ao iniciar o motor de voz: {e}")
            };
            interno.erro = Some(mensagem.clone());
            Err(mensagem)
        }
    }
}

fn parar_motor(app: &AppHandle) {
    let processo = app.state::<MotorVoz>().interno.lock().unwrap().processo.take();
    let Some(mut processo) = processo else { return };

    // Fechar o stdin já faz o motor encerrar sozinho de forma limpa
    drop(processo.stdin.take());
    let inicio = Instant::now();
    while inicio.elapsed() < Duration::from_millis(1500) {
        if !matches!(processo.try_wait(), Ok(None)) {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }

    // Plano B: no Windows o python.exe do venv é um lançador que cria um processo filho,
    // então é preciso matar a árvore inteira.
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &processo.id().to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = processo.kill();
    let _ = processo.wait();
}

#[tauri::command]
fn estado_motor(app: AppHandle) -> EstadoMotor {
    let motor = app.state::<MotorVoz>();
    let mut interno = motor.interno.lock().unwrap();
    let rodando = interno
        .processo
        .as_mut()
        .is_some_and(|p| matches!(p.try_wait(), Ok(None)));
    EstadoMotor {
        rodando,
        porta_ativa: porta_em_uso(),
        erro: interno.erro.clone(),
    }
}

#[tauri::command]
async fn reiniciar_motor(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        parar_motor(&app);
        // Espera a porta ser liberada antes de subir de novo
        let inicio = Instant::now();
        while porta_em_uso() && inicio.elapsed() < Duration::from_secs(3) {
            thread::sleep(Duration::from_millis(100));
        }
        iniciar_motor(&app)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(MotorVoz::default())
        .invoke_handler(tauri::generate_handler![estado_motor, reiniciar_motor])
        .setup(|app| {
            let handle = app.handle().clone();
            // Em outra thread para não atrasar a abertura da janela
            thread::spawn(move || {
                if let Err(e) = iniciar_motor(&handle) {
                    eprintln!("[MOTOR] {e}");
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                parar_motor(app);
            }
        });
}
