import { useEffect, useRef, useState } from 'react';

const URL_MOTOR = 'ws://127.0.0.1:8765';
const ESPERA_INICIAL_MS = 500;
const ESPERA_MAXIMA_MS = 5000;

export type Conexao = 'conectando' | 'conectado' | 'desconectado';
export type EstadoMotor = 'carregando' | 'pronto' | 'erro';

type Mensagem =
  | { tipo: 'status'; estado: EstadoMotor; mensagem?: string }
  | { tipo: 'parcial'; texto: string }
  | { tipo: 'final'; texto: string }
  | { tipo: 'nivel'; valor: number }
  | { tipo: 'mudo'; valor: boolean };

function interpretar(dados: string): Mensagem {
  try {
    const msg = JSON.parse(dados);
    if (msg && typeof msg === 'object' && typeof msg.tipo === 'string') return msg;
  } catch {
    // não é JSON
  }
  // Compatibilidade com a versão antiga do motor, que mandava só o texto
  return { tipo: 'final', texto: dados };
}

interface Opcoes {
  mudo: boolean;
  onFrase: (texto: string) => void;
}

/**
 * Conexão com o motor de voz (Python) que nunca desiste: se o motor ainda não subiu,
 * caiu ou foi reiniciado, reconecta sozinha com espera crescente (0,5 s → 5 s).
 */
export function useMotorVoz({ mudo, onFrase }: Opcoes) {
  const [conexao, setConexao] = useState<Conexao>('conectando');
  const [estadoMotor, setEstadoMotor] = useState<EstadoMotor>('carregando');
  const [mensagemMotor, setMensagemMotor] = useState('');
  const [parcial, setParcial] = useState('');
  const [nivel, setNivel] = useState(0);
  const [falhasSeguidas, setFalhasSeguidas] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const mudoRef = useRef(mudo);
  const onFraseRef = useRef(onFrase);

  useEffect(() => {
    onFraseRef.current = onFrase;
  }, [onFrase]);

  useEffect(() => {
    let ativo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let espera = ESPERA_INICIAL_MS;

    const conectar = () => {
      if (!ativo) return;
      setConexao('conectando');

      const ws = new WebSocket(URL_MOTOR);
      wsRef.current = ws;

      ws.onopen = () => {
        espera = ESPERA_INICIAL_MS;
        setConexao('conectado');
        setFalhasSeguidas(0);
        // A interface é a dona do estado do microfone: reaplica após cada reconexão
        ws.send(mudoRef.current ? 'COMANDO:MUTE' : 'COMANDO:UNMUTE');
      };

      ws.onmessage = (evento) => {
        const msg = interpretar(String(evento.data));
        switch (msg.tipo) {
          case 'status':
            setEstadoMotor(msg.estado);
            setMensagemMotor(msg.mensagem ?? '');
            break;
          case 'parcial':
            setParcial(msg.texto);
            break;
          case 'final':
            setParcial('');
            onFraseRef.current(msg.texto);
            break;
          case 'nivel':
            setNivel(mudoRef.current ? 0 : msg.valor);
            break;
          case 'mudo':
            break; // informativo; o estado de verdade fica na interface
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (!ativo) return;
        setConexao('desconectado');
        setEstadoMotor('carregando');
        setParcial('');
        setNivel(0);
        setFalhasSeguidas((n) => n + 1);
        timer = setTimeout(conectar, espera);
        espera = Math.min(espera * 2, ESPERA_MAXIMA_MS);
      };
      // 'error' é sempre seguido de 'close', onde a reconexão acontece
    };

    conectar();

    return () => {
      ativo = false;
      clearTimeout(timer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    mudoRef.current = mudo;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(mudo ? 'COMANDO:MUTE' : 'COMANDO:UNMUTE');
    }
    if (mudo) {
      setParcial('');
      setNivel(0);
    }
  }, [mudo]);

  return { conexao, estadoMotor, mensagemMotor, parcial, nivel, falhasSeguidas };
}
