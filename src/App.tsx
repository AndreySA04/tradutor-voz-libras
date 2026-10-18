import { useRef, useState } from 'react';
import { LuMic, LuMicOff, LuSkipForward } from 'react-icons/lu';
import { BarraTitulo, TipoStatus } from './components/BarraTitulo';
import { PainelLegenda } from './components/PainelLegenda';
import { AvisoMotor } from './components/AvisoMotor';
import { useVLibras } from './vlibras/useVLibras';
import { useMotorVoz } from './motor/useMotorVoz';
import './App.css';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMuted, setIsMuted] = useState(false);

  const { estado: fila, adicionar, pular } = useVLibras(containerRef);

  const { conexao, estadoMotor, mensagemMotor, parcial, nivel, falhasSeguidas } = useMotorVoz({
    mudo: isMuted,
    onFrase: adicionar,
  });

  const temFilaOuSinalizacao = Boolean(fila?.atual || (fila?.pendentes.length ?? 0) > 0);

  // Calcula o estado atual para o indicador visual da barra de título
  let status: TipoStatus = 'ouvindo';
  if (conexao === 'conectando') {
    status = 'conectando';
  } else if (conexao === 'desconectado' || estadoMotor === 'erro') {
    status = falhasSeguidas >= 3 || estadoMotor === 'erro' ? 'erro' : 'conectando';
  } else if (!fila?.carregado || estadoMotor === 'carregando') {
    status = 'iniciando';
  } else if (isMuted) {
    status = 'mudo';
  } else if (fila?.atual) {
    status = 'sinalizando';
  } else {
    status = 'ouvindo';
  }

  const toggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  return (
    <div className="app-container">
      {/* Barra de título personalizada (arrastável) */}
      <BarraTitulo status={status} />

      {/* Banner de aviso caso o motor Python esteja com erro ou desligado */}
      <AvisoMotor
        conexao={conexao}
        estadoMotor={estadoMotor}
        mensagemMotor={mensagemMotor}
        falhasSeguidas={falhasSeguidas}
      />

      {/* Área central com o Avatar 3D e controles flutuantes */}
      <main className="palco" data-tauri-drag-region>
        {/* Controles flutuantes sobre o avatar */}
        <div className="controles-flutuantes">
          <button
            id="btn-microfone"
            className={`botao-acao botao-mic ${isMuted ? 'botao-mic--mutado' : 'botao-mic--ativo'} ${
              nivel > 0.1 && !isMuted ? 'botao-mic--falando' : ''
            }`}
            onClick={toggleMute}
            title={isMuted ? 'Ativar microfone' : 'Mutar microfone'}
            aria-label={isMuted ? 'Ativar microfone' : 'Mutar microfone'}
          >
            {isMuted ? <LuMicOff size={18} /> : <LuMic size={18} />}
            {!isMuted && nivel > 0.05 && (
              <span
                className="pulso-voz"
                style={{
                  transform: `scale(${1 + Math.min(0.6, nivel * 0.8)})`,
                  opacity: Math.min(0.8, nivel * 1.2),
                }}
              />
            )}
          </button>

          {temFilaOuSinalizacao && (
            <button
              id="btn-pular-fila"
              className="botao-acao botao-pular"
              onClick={pular}
              title="Pular animação atual e limpar fila"
              aria-label="Pular animação atual e limpar fila"
            >
              <LuSkipForward size={16} />
              <span className="botao-pular__texto">Pular</span>
            </button>
          )}
        </div>

        {/* Loader elegante exibido enquanto o Unity WebGL carrega os assets */}
        {fila && !fila.carregado && (
          <div className="avatar-loading" role="status" aria-live="polite">
            <div className="avatar-loading__spinner" />
            <span className="avatar-loading__texto">Carregando avatar 3D...</span>
          </div>
        )}

        {/* Container do Canvas Unity / VLibras */}
        <div className="avatar-area" ref={containerRef} data-tauri-drag-region />
      </main>

      {/* Painel inferior com transcrição em tempo real, glosa e medidor */}
      <PainelLegenda
        fila={fila}
        parcial={parcial}
        nivel={nivel}
        mudo={isMuted}
        online={conexao === 'conectado'}
      />
    </div>
  );
}