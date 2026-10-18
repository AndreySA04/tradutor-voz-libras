import { LuHand, LuMinus, LuX } from 'react-icons/lu';
import { fecharJanela, minimizarJanela } from '../motor/tauri';

export type TipoStatus = 'conectando' | 'iniciando' | 'ouvindo' | 'sinalizando' | 'mudo' | 'erro';

const ROTULOS: Record<TipoStatus, string> = {
  conectando: 'Conectando',
  iniciando: 'Iniciando',
  ouvindo: 'Ouvindo',
  sinalizando: 'Sinalizando',
  mudo: 'Mudo',
  erro: 'Erro',
};

export function BarraTitulo({ status }: { status: TipoStatus }) {
  return (
    <header className="barra" data-tauri-drag-region>
      <div className="marca" data-tauri-drag-region>
        <span className="marca__logo" aria-hidden="true">
          <LuHand />
        </span>
        <h1 className="marca__nome" data-tauri-drag-region>
          Libras <span data-tauri-drag-region>ao vivo</span>
        </h1>
      </div>

      <span className={`status status--${status}`} role="status" data-tauri-drag-region>
        <span className="status__ponto" aria-hidden="true" />
        {ROTULOS[status]}
      </span>

      <div className="janela">
        <button id="btn-minimizar" className="janela__botao" onClick={minimizarJanela} aria-label="Minimizar">
          <LuMinus />
        </button>
        <button id="btn-fechar" className="janela__botao janela__botao--fechar" onClick={fecharJanela} aria-label="Fechar">
          <LuX />
        </button>
      </div>
    </header>
  );
}
