import { useEffect, useRef, useState } from 'react';
import { Player } from './vlibras-core/Player.js';
import { FaMicrophone, FaMicrophoneSlash } from 'react-icons/fa';
import './App.css';

function App() {
  const vlibrasRef = useRef<HTMLDivElement>(null);
  const playerInstanciado = useRef(false);
  const playerRef = useRef<any>(null); 
  const wsRef = useRef<WebSocket | null>(null);
  
  const filaDeTextos = useRef<string[]>([]);
  const isSinalizando = useRef(false);
  
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const processarFila = () => {
      if (isSinalizando.current || filaDeTextos.current.length === 0) return;

      const proximaFrase = filaDeTextos.current.shift();
      
      if (proximaFrase && playerRef.current) {
        isSinalizando.current = true;
        playerRef.current.translate(proximaFrase);
      }
    };

    if (vlibrasRef.current && !playerInstanciado.current) {
      playerInstanciado.current = true;
      const player = new Player({ targetPath: '/target' });
      player.load(vlibrasRef.current);
      playerRef.current = player;

      (player as any).on('load', () => {
        (player as any).toggleSubtitle(false);
      });

      (player as any).on('gloss:end', () => {
        isSinalizando.current = false;
        processarFila();
      });

      (player as any).on('error', () => {
        isSinalizando.current = false;
        processarFila();
      });
    }

    const ws = new WebSocket('ws://127.0.0.1:8765');
    wsRef.current = ws;

    ws.onopen = () => console.log("Conectado ao motor Python!");
    
    ws.onmessage = (event) => {
      const textoRecebido = event.data;
      console.log("Python ouviu:", textoRecebido);
      
      filaDeTextos.current.push(textoRecebido);
      processarFila(); 
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, []);

  const toggleMute = () => {
    const novoEstado = !isMuted;
    setIsMuted(novoEstado);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(novoEstado ? "COMANDO:MUTE" : "COMANDO:UNMUTE");
    }
  };

  return (
    <div className="app-container" data-tauri-drag-region>
      <button
        className={`mic-button ${isMuted ? 'muted' : 'listening'}`}
        onClick={toggleMute}
        title={isMuted ? "Ativar Microfone" : "Mutar Microfone"}
      >
        {isMuted ? (
          <FaMicrophoneSlash size={16} color="white" />
        ) : (
          <FaMicrophone size={16} color="white" />
        )}
      </button>

      <div className="avatar-area" ref={vlibrasRef} data-tauri-drag-region></div>
    </div>
  );
}

export default App;