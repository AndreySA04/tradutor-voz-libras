import os
import sys
import json
import queue
import sounddevice as sd
from vosk import Model, KaldiRecognizer
import asyncio
import websockets
import threading

# Configurações do Áudio
CAMINHO_MODELO = "modelo"
SAMPLE_RATE = 16000 
TAMANHO_BLOCO = 8000 

fila_audio = queue.Queue()
fila_textos = queue.Queue()
microfone_mutado = False 

async def servidor_websocket(websocket):
    global microfone_mutado
    print("\n[REDE] 🟢 Interface conectada.")
    
    async def escutar_comandos():
        global microfone_mutado
        try:
            async for mensagem in websocket:
                if mensagem == "COMANDO:MUTE":
                    microfone_mutado = True
                elif mensagem == "COMANDO:UNMUTE":
                    microfone_mutado = False
        except websockets.exceptions.ConnectionClosed:
            pass

    async def enviar_textos():
        try:
            while True:
                if not fila_textos.empty():
                    texto = fila_textos.get()
                    await websocket.send(texto)
                await asyncio.sleep(0.05)
        except websockets.exceptions.ConnectionClosed:
            print("\n[REDE] 🔴 Interface desconectada.")

    await asyncio.gather(escutar_comandos(), enviar_textos())

async def iniciar_servidor_async():
    async with websockets.serve(servidor_websocket, "127.0.0.1", 8765):
        await asyncio.Future() 

def iniciar_servidor_rede():
    asyncio.run(iniciar_servidor_async())

def callback_microfone(indata, status):
    if status:
        print(f"Status: {status}", file=sys.stderr)
    fila_audio.put(bytes(indata))

def iniciar_motor_original():
    if not os.path.exists(CAMINHO_MODELO):
        print("Erro: Pasta do modelo não encontrada.")
        os._exit(1)

    modelo = Model(CAMINHO_MODELO)
    reconhecedor = KaldiRecognizer(modelo, SAMPLE_RATE)
    
    with sd.RawInputStream(samplerate=SAMPLE_RATE, blocksize=TAMANHO_BLOCO, 
                           device=None, dtype='int16', channels=1, 
                           callback=callback_microfone):
        try:
            while True:
                dados = fila_audio.get()
                if microfone_mutado:
                    continue
                
                if reconhecedor.AcceptWaveform(dados):
                    resultado = json.loads(reconhecedor.Result())
                    texto_final = resultado.get("text", "")
                    if texto_final:
                        fila_textos.put(texto_final) 
        except Exception:
            pass

if __name__ == "__main__":
    print("\nIniciando Motor de Voz e Servidor WebSocket...")
    thread_voz = threading.Thread(target=iniciar_motor_original, daemon=True)
    thread_voz.start()

    iniciar_servidor_rede()