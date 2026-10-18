"""
Motor de reconhecimento de voz (Vosk) + servidor WebSocket.

Protocolo Python -> Interface (sempre JSON):
    {"tipo": "status",  "estado": "carregando" | "pronto" | "erro", "mensagem": str}
    {"tipo": "parcial", "texto": str}    # transcrição em andamento (legenda ao vivo)
    {"tipo": "final",   "texto": str}    # frase fechada -> vai para a fila do VLibras
    {"tipo": "nivel",   "valor": float}  # volume do microfone (0..1) para o indicador visual
    {"tipo": "mudo",    "valor": bool}

Protocolo Interface -> Python (texto simples):
    "COMANDO:MUTE" | "COMANDO:UNMUTE"
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

# Configurações de Áudio e Desempenho
HOST = "127.0.0.1"
PORTA = int(os.environ.get("MOTOR_VOZ_PORTA", "8765"))
SAMPLE_RATE = 16000
TAMANHO_BLOCO = 4000  # Bloco estável para captura fonética completa
INTERVALO_RETENTATIVA_MIC = 3.0  # segundos entre tentativas de reabrir o microfone
TAMANHO_MINIMO_FRASE = 2  # descarta "frases" de 1 letra (ruídos)


def _diretorio_base():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


CAMINHO_MODELO = os.environ.get("VOSK_MODELO", os.path.join(_diretorio_base(), "modelo"))
ARQUIVO_VOCABULARIO = os.path.join(_diretorio_base(), "vocabulario.txt")


def log(*args):
    """print() seguro com flush imediato."""
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
    """Envia uma mensagem para todas as interfaces conectadas."""
    loop = estado.loop
    if loop is None or loop.is_closed():
        return
    dados = json.dumps(mensagem, ensure_ascii=False)
    try:
        loop.call_soon_threadsafe(lambda: broadcast(estado.clientes, dados))
    except RuntimeError:
        pass


def definir_status(novo_estado, mensagem=""):
    estado.status = {"tipo": "status", "estado": novo_estado, "mensagem": mensagem}
    log(f"[MOTOR] {novo_estado.upper()}: {mensagem}")
    publicar(estado.status)


def definir_mudo(valor):
    if estado.mudo == valor:
        return
    estado.mudo = valor
    estado.resetar_reconhecedor.set()
    log("[MOTOR] 🔇 Microfone mutado." if valor else "[MOTOR] 🎙️ Microfone ativo.")
    publicar({"tipo": "mudo", "valor": valor})


# ---------------------------------------------------------------- Rede

async def atender_interface(websocket):
    estado.clientes.add(websocket)
    log("[REDE] 🟢 Interface conectada.")
    try:
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


# ---------------------------------------------------------------- Áudio & Vocabulário

def escolher_melhor_dispositivo():
    """Detecta e seleciona o melhor dispositivo de entrada, evitando drivers virtuais inativos."""
    try:
        devs = sd.query_devices()
        default_in = sd.default.device[0]
    except Exception:
        return None

    env_dev = os.environ.get("DISPOSITIVO_MIC")
    if env_dev is not None:
        try:
            return int(env_dev)
        except ValueError:
            pass

    palavras_virtuais = ["iriun", "steam streaming", "virtual", "cable", "mixagem", "stereo mix"]
    candidatos_reais = []

    for i, d in enumerate(devs):
        if d.get("max_input_channels", 0) <= 0:
            continue
        nome = d.get("name", "").strip().lower()
        if not any(v in nome for v in palavras_virtuais):
            candidatos_reais.append((i, d.get("name")))

    # Se o padrão do sistema não for um driver virtual conhecido, usa ele
    if 0 <= default_in < len(devs):
        nome_default = devs[default_in].get("name", "").lower()
        if not any(v in nome_default for v in palavras_virtuais):
            return default_in

    # Caso contrário, pega o primeiro microfone físico real encontrado
    if candidatos_reais:
        return candidatos_reais[0][0]

    return default_in if default_in >= 0 else None


def carregar_vocabulario():
    """Lê termos prioritários de vocabulario.txt e monta gramática Kaldi com [unk]."""
    if not os.path.isfile(ARQUIVO_VOCABULARIO):
        return None

    termos = []
    try:
        with open(ARQUIVO_VOCABULARIO, "r", encoding="utf-8") as f:
            for linha in f:
                linha = linha.strip()
                if linha and not linha.startswith("#"):
                    termos.append(linha.lower())
    except Exception as e:
        log(f"[VOCABULÁRIO] Erro ao ler vocabulario.txt: {e}")
        return None

    if not termos:
        return None

    # O token especial '[unk]' permite palavras fora da lista enquanto dá peso às da lista!
    if "[unk]" not in termos:
        termos.append("[unk]")

    log(f"[VOCABULÁRIO] 📚 {len(termos) - 1} termos prioritários carregados de vocabulario.txt")
    return json.dumps(termos, ensure_ascii=False)


def nivel_do_audio(dados):
    """Volume perceptual em escala 0..1 (-50 dB -> 0, -10 dB -> 1)."""
    amostras = array.array("h", dados)
    if not amostras:
        return 0.0
    rms = math.sqrt(sum(a * a for a in amostras) / len(amostras)) / 32768.0
    if rms <= 0:
        return 0.0
    db = 20 * math.log10(rms)
    return max(0.0, min(1.0, (db + 50) / 40))


def processar_audio(reconhecedor, fila_audio, stream):
    """Loop principal de transcrição contínua."""
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


def carregar_modelo_seguro(caminho):
    """Carrega o modelo Vosk, tratando a limitação do Windows para arquivos G.carpa > 2GB."""
    rescore_dir = os.path.join(caminho, "rescore")
    rescore_disabled = os.path.join(caminho, "rescore.disabled")

    # No Windows, arquivos de rescore G.carpa > 2GB estouram o offset de 32 bits no Kaldi
    if os.path.isdir(rescore_dir):
        carpa = os.path.join(rescore_dir, "G.carpa")
        if os.path.isfile(carpa) and os.path.getsize(carpa) > 2 * 1024 * 1024 * 1024:
            try:
                os.rename(rescore_dir, rescore_disabled)
                log("[MOTOR] ℹ️ Pasta 'rescore' contornada (evita estouro de 32 bits no Windows). Usando grafo HCLG completo.")
            except Exception:
                pass

    try:
        return Model(caminho)
    except Exception as e:
        if os.path.isdir(rescore_dir):
            try:
                os.rename(rescore_dir, rescore_disabled)
                log("[MOTOR] ℹ️ Tentando carregar o modelo sem a pasta 'rescore'...")
                return Model(caminho)
            except Exception:
                pass
        raise e


def motor_de_voz():
    SetLogLevel(-1)

    if not os.path.isdir(CAMINHO_MODELO):
        definir_status("erro", f"Modelo Vosk não encontrado em '{CAMINHO_MODELO}'.")
        return

    try:
        modelo = carregar_modelo_seguro(CAMINHO_MODELO)
    except Exception as erro:
        definir_status("erro", f"Falha ao carregar o modelo de voz: {erro}")
        return

    # Modelos com HCLG.fst já possuem o vocabulário completo pré-compilado
    tem_hclg = os.path.isfile(os.path.join(CAMINHO_MODELO, "graph", "HCLG.fst"))
    if tem_hclg:
        log("[VOCABULÁRIO] 📚 Modelo avançado ativo: vocabulário completo (300.000+ palavras).")
        reconhecedor = KaldiRecognizer(modelo, SAMPLE_RATE)
    else:
        gramatica = carregar_vocabulario()
        if gramatica:
            reconhecedor = KaldiRecognizer(modelo, SAMPLE_RATE, gramatica)
        else:
            reconhecedor = KaldiRecognizer(modelo, SAMPLE_RATE)

    reconhecedor.SetWords(True)

    fila_audio = queue.Queue(maxsize=60)

    def callback_microfone(indata, frames, tempo, status):
        if status:
            log(f"[MIC] {status}")
        try:
            fila_audio.put_nowait(bytes(indata))
        except queue.Full:
            pass

    dispositivo_idx = escolher_melhor_dispositivo()
    try:
        nome_dev = sd.query_devices(dispositivo_idx)["name"]
        log(f"[MIC] 🎙️ Usando dispositivo de entrada [{dispositivo_idx}]: {nome_dev}")
    except Exception:
        log(f"[MIC] 🎙️ Usando dispositivo padrão [{dispositivo_idx}]")

    while True:
        try:
            with sd.RawInputStream(samplerate=SAMPLE_RATE, blocksize=TAMANHO_BLOCO, device=dispositivo_idx,
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
        log(f"[REDE] ❌ Não foi possível usar a porta {PORTA}: {erro}")
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