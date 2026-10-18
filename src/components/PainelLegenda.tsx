import { useEffect, useRef, useState } from 'react';
import type { EstadoFila } from '../vlibras/FilaSinalizacao';

interface Props {
  fila: EstadoFila | null;
  parcial: string;
  nivel: number;
  mudo: boolean;
  online: boolean;
}

const MAX_PARCIAL = 70;

function ultimasPalavras(texto: string) {
  return texto.length > MAX_PARCIAL ? '…' + texto.slice(-MAX_PARCIAL) : texto;
}

/** Barrinhas que reagem ao volume do microfone. */
function Ondas({ nivel, ativo }: { nivel: number; ativo: boolean }) {
  const pesos = [0.55, 1, 0.75, 0.9, 0.5];
  return (
    <span className={`ondas ${ativo ? 'ondas--ativas' : ''}`} aria-hidden="true">
      {pesos.map((peso, i) => (
        <span key={i} style={{ transform: `scaleY(${0.2 + Math.min(1, nivel * peso * 1.4) * 0.8})` }} />
      ))}
    </span>
  );
}

export function PainelLegenda({ fila, parcial, nivel, mudo, online }: Props) {
  const atual = fila?.atual ?? null;
  const pendentes = fila?.pendentes.length ?? 0;

  // Aviso temporário quando a fila descarta frases antigas
  const [avisoDescarte, setAvisoDescarte] = useState(0);
  const descartadasAntes = useRef(fila?.descartadas ?? 0);
  useEffect(() => {
    const total = fila?.descartadas ?? 0;
    const novas = total - descartadasAntes.current;
    descartadasAntes.current = total;
    if (novas <= 0) return;
    setAvisoDescarte(novas);
    const timer = setTimeout(() => setAvisoDescarte(0), 3500);
    return () => clearTimeout(timer);
  }, [fila?.descartadas]);

  let rotulo = 'Aguardando fala';
  if (atual) rotulo = atual.iniciado ? 'Sinalizando' : 'Traduzindo';

  let textoOuvindo = 'Ouvindo…';
  if (!online) textoOuvindo = 'Sem conexão com o motor de voz';
  else if (mudo) textoOuvindo = 'Microfone mutado';
  else if (parcial) textoOuvindo = ultimasPalavras(parcial);

  return (
    <section className="legenda" aria-label="Transcrição e tradução">
      <div className="legenda__cabecalho">
        <span className={`legenda__rotulo ${atual ? 'legenda__rotulo--ativo' : ''}`}>{rotulo}</span>
        {fila && fila.velocidade > 1 && (
          <span className="chip chip--velocidade" title="Velocidade aumentada para acompanhar a fala">
            {fila.velocidade}x
          </span>
        )}
        {pendentes > 0 && (
          <span className="chip" title={fila?.pendentes.join(' · ')}>
            +{pendentes} na fila
          </span>
        )}
      </div>

      <p className={`legenda__atual ${atual ? '' : 'legenda__atual--vazio'}`} aria-live="polite">
        {atual ? atual.texto : 'Fale algo para começar a tradução.'}
      </p>

      {atual?.glosa && <p className="legenda__glosa" title="Glosa (estrutura em Libras)">{atual.glosa}</p>}

      <div
        className={`progresso ${atual && !atual.iniciado ? 'progresso--indeterminado' : ''}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((fila?.progresso ?? 0) * 100)}
      >
        <span style={{ transform: `scaleX(${atual?.iniciado ? Math.max(0.04, fila?.progresso ?? 0) : 0})` }} />
      </div>

      <div className={`ouvindo ${parcial && !mudo ? 'ouvindo--falando' : ''}`}>
        <Ondas nivel={nivel} ativo={online && !mudo} />
        <span className="ouvindo__texto">{textoOuvindo}</span>
      </div>

      {avisoDescarte > 0 && (
        <div className="aviso-descarte" role="status">
          {avisoDescarte === 1 ? '1 frase antiga pulada' : `${avisoDescarte} frases antigas puladas`} para acompanhar a fala
        </div>
      )}
    </section>
  );
}
