"""
Motor de reconhecimento de voz (Vosk) + servidor WebSocket.

Protocolo Python -> Interface (sempre JSON):
    {"tipo": "status",  "estado": "carregando" | "pronto" | "erro", "mensagem": str}
    {"tipo": "parcial", "texto": str}    # transcrição em andamento (legenda ao vivo)
    {"tipo": "final",   "texto": str}    # frase fechada -> vai para a fila do VLibras
    {"tipo": "nivel",   "valor": float}  # volume do microfone (0..1) para o indicador visual
    {"tipo": "mudo",    "valor": bool}

Protocolo Interface -> Python (texto simples, igual à versão anterior):
    "COMANDO:MUTE" | "COMANDO:UNMUTE"

Pode ser executado manualmente (`python motor.py`) ou iniciado automaticamente
pelo app Tauri, que também o encerra quando a janela é fechada.
"""

import array
import asyncio
import json
import math
import os
import queue
import sys
import threading
import time

import sounddevice as sd
from vosk import KaldiRecognizer, Model, SetLogLevel
from websockets.asyncio.server import broadcast, serve
from websockets.exceptions import ConnectionClosed

# Configurações
HOST = "127.0.0.1"
PORTA = int(os.environ.get("MOTOR_VOZ_PORTA", "8765"))
SAMPLE_RATE = 16000
TAMANHO_BLOCO = 4000  # 250 ms: legenda parcial e indicador de volume mais responsivos
INTERVALO_RETENTATIVA_MIC = 3.0  # segundos entre tentativas de reabrir o microfone
TAMANHO_MINIMO_FRASE = 2  # descarta "frases" de 1 letra, geralmente ruído ("a", "e", "o")


def _diretorio_base():
    # Quando empacotado com PyInstaller, o modelo fica ao lado do executável
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


CAMINHO_MODELO = os.environ.get("VOSK_MODELO", os.path.join(_diretorio_base(), "modelo"))


def log(*args):
    """print() que nunca derruba o motor (ex.: sem console ou com encoding limitado)."""
    try:
        print(*args, flush=True)
    except Exception:
        pass


for _fluxo in (sys.stdout, sys.stderr):
    try:
        _fluxo.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


class Estado:
    def __init__(self):
        self.mudo = False
        self.status = {"tipo": "status", "estado": "carregando", "mensagem": "Carregando modelo de voz..."}
        self.clientes = set()
        self.loop = None
        self.resetar_reconhecedor = threading.Event()


estado = Estado()


def publicar(mensagem):
    """Envia uma mensagem para todas as interfaces conectadas. Pode ser chamada de qualquer thread."""
    loop = estado.loop
    if loop is None or loop.is_closed():
        return
    dados = json.dumps(mensagem, ensure_ascii=False)
    try:
        loop.call_soon_threadsafe(lambda: broadcast(estado.clientes, dados))
    except RuntimeError:
        pass  # loop encerrando


def definir_status(novo_estado, mensagem=""):
    estado.status = {"tipo": "status", "estado": novo_estado, "mensagem": mensagem}
    log(f"[MOTOR] {novo_estado.upper()}: {mensagem}")
    publicar(estado.status)


def definir_mudo(valor):
    if estado.mudo == valor:
        return
    estado.mudo = valor
    estado.resetar_reconhecedor.set()  # descarta o que estava pela metade
    log("[MOTOR] 🔇 Microfone mutado." if valor else "[MOTOR] 🎙️ Microfone ativo.")
    publicar({"tipo": "mudo", "valor": valor})


# ---------------------------------------------------------------- Rede

async def atender_interface(websocket):
    estado.clientes.add(websocket)
    log("[REDE] 🟢 Interface conectada.")
    try:
        # Quem acabou de conectar recebe o estado atual imediatamente
        await websocket.send(json.dumps(estado.status, ensure_ascii=False))
        await websocket.send(json.dumps({"tipo": "mudo", "valor": estado.mudo}))

        async for mensagem in websocket:
            if mensagem == "COMANDO:MUTE":
                definir_mudo(True)
            elif mensagem == "COMANDO:UNMUTE":
                definir_mudo(False)
    except ConnectionClosed:
        pass
    finally:
        estado.clientes.discard(websocket)
        log("[REDE] 🔴 Interface desconectada.")


# ---------------------------------------------------------------- Áudio

def nivel_do_audio(dados):
    """Volume do bloco em escala perceptual 0..1 (-50 dB -> 0, -10 dB -> 1)."""
    amostras = array.array("h", dados)
    if not amostras:
        return 0.0
    rms = math.sqrt(sum(a * a for a in amostras) / len(amostras)) / 32768.0
    if rms <= 0:
        return 0.0
    db = 20 * math.log10(rms)
    return max(0.0, min(1.0, (db + 50) / 40))


def processar_audio(reconhecedor, fila_audio, stream):
    """Loop principal de transcrição. Só retorna (com exceção) se o microfone parar."""
    ultimo_parcial = ""

    while True:
        try:
            dados = fila_audio.get(timeout=2)
        except queue.Empty:
            if not stream.active:
                raise RuntimeError("o fluxo do microfone foi interrompido")
            continue

        if estado.resetar_reconhecedor.is_set():
            estado.resetar_reconhecedor.clear()
            reconhecedor.Reset()
            if ultimo_parcial:
                ultimo_parcial = ""
                publicar({"tipo": "parcial", "texto": ""})

        if estado.mudo:
            continue

        publicar({"tipo": "nivel", "valor": round(nivel_do_audio(dados), 3)})

        if reconhecedor.AcceptWaveform(dados):
            texto = json.loads(reconhecedor.Result()).get("text", "").strip()
            ultimo_parcial = ""
            if len(texto) >= TAMANHO_MINIMO_FRASE:
                log(f"[VOZ] {texto}")
                publicar({"tipo": "final", "texto": texto})
            else:
                publicar({"tipo": "parcial", "texto": ""})
        else:
            parcial = json.loads(reconhecedor.PartialResult()).get("partial", "").strip()
            if parcial != ultimo_parcial:
                ultimo_parcial = parcial
                publicar({"tipo": "parcial", "texto": parcial})


def motor_de_voz():
    SetLogLevel(-1)

    if not os.path.isdir(CAMINHO_MODELO):
        definir_status("erro", f"Modelo Vosk não encontrado em '{CAMINHO_MODELO}'.")
        return

    try:
        modelo = Model(CAMINHO_MODELO)
    except Exception as erro:
        definir_status("erro", f"Falha ao carregar o modelo de voz: {erro}")
        return

    reconhecedor = KaldiRecognizer(modelo, SAMPLE_RATE)
    fila_audio = queue.Queue(maxsize=40)  # ~10 s de áudio; evita crescer sem limite

    def callback_microfone(indata, frames, tempo, status):
        if status:
            log(f"[MIC] {status}")
        try:
            fila_audio.put_nowait(bytes(indata))
        except queue.Full:
            pass  # processamento atrasado: descarta o bloco em vez de acumular atraso

    # Se o microfone falhar (desconectado, ocupado...), tenta reabrir em vez de morrer
    while True:
        try:
            with sd.RawInputStream(samplerate=SAMPLE_RATE, blocksize=TAMANHO_BLOCO, device=None,
                                   dtype="int16", channels=1, callback=callback_microfone) as stream:
                definir_status("pronto", "Ouvindo")
                processar_audio(reconhecedor, fila_audio, stream)
        except Exception as erro:
            definir_status("erro", f"Microfone indisponível: {erro}")
            time.sleep(INTERVALO_RETENTATIVA_MIC)
            reconhecedor.Reset()
            while not fila_audio.empty():
                fila_audio.get_nowait()


# ---------------------------------------------------------------- Ciclo de vida

def vigiar_processo_pai():
    """Iniciado pelo Tauri: o app segura o stdin aberto. Se o app fechar (ou travar), o stdin
    recebe EOF e o motor se encerra, liberando o microfone e a porta."""
    try:
        while sys.stdin.read(1024):
            pass
    except Exception:
        pass
    log("[MOTOR] App encerrado, finalizando motor.")
    os._exit(0)


async def main():
    estado.loop = asyncio.get_running_loop()

    try:
        servidor = await serve(atender_interface, HOST, PORTA)
    except OSError as erro:
        log(f"[REDE] ❌ Não foi possível usar a porta {PORTA} (outro motor já está rodando?): {erro}")
        sys.exit(2)

    async with servidor:
        log(f"[REDE] Servidor WebSocket em ws://{HOST}:{PORTA}")
        threading.Thread(target=motor_de_voz, daemon=True, name="motor-voz").start()
        await asyncio.Future()


if __name__ == "__main__":
    log("\nIniciando Motor de Voz e Servidor WebSocket...")
    if os.environ.get("MOTOR_VOZ_VIGIAR_STDIN") == "1":
        threading.Thread(target=vigiar_processo_pai, daemon=True, name="vigia").start()
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass