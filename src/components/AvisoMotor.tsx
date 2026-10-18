import { useEffect, useState } from 'react';
import { LuRotateCw, LuTriangleAlert } from 'react-icons/lu';
import type { Conexao, EstadoMotor } from '../motor/useMotorVoz';
import { consultarMotor, emTauri, reiniciarMotor } from '../motor/tauri';

interface Props {
  conexao: Conexao;
  estadoMotor: EstadoMotor;
  mensagemMotor: string;
  falhasSeguidas: number;
}

/** Mostra problemas do motor de voz sobre o avatar, com opção de reiniciá-lo. */
export function AvisoMotor({ conexao, estadoMotor, mensagemMotor, falhasSeguidas }: Props) {
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [reiniciando, setReiniciando] = useState(false);
  const [erroReinicio, setErroReinicio] = useState<string | null>(null);

  const offline = conexao !== 'conectado';
  const comErro = !offline && estadoMotor === 'erro';
  // Ignora as primeiras falhas: é normal o app abrir antes do motor terminar de subir
  const visivel = (offline && falhasSeguidas >= 3) || comErro;

  useEffect(() => {
    if (!offline || falhasSeguidas < 3) {
      setDetalhe(null);
      return;
    }
    let cancelado = false;
    consultarMotor().then((info) => {
      if (cancelado || !info) return;
      if (info.erro) setDetalhe(info.erro);
      else if (!info.rodando && !info.porta_ativa) setDetalhe('O processo do motor de voz foi encerrado.');
      else setDetalhe(null);
    });
    return () => {
      cancelado = true;
    };
  }, [offline, falhasSeguidas]);

  if (!visivel) return null;

  const reiniciar = async () => {
    setReiniciando(true);
    setErroReinicio(null);
    try {
      await reiniciarMotor();
    } catch (e) {
      setErroReinicio(String(e));
    } finally {
      setReiniciando(false);
    }
  };

  let titulo = 'Motor de voz desconectado';
  let descricao = detalhe ?? 'Tentando reconectar automaticamente…';
  if (comErro) {
    titulo = 'Problema no motor de voz';
    descricao = mensagemMotor || 'Erro desconhecido.';
  } else if (!emTauri()) {
    descricao = 'Inicie o motor com "python motor.py" em src-tauri/motor-voz.';
  }

  return (
    <div className="aviso" role="alert">
      <LuTriangleAlert className="aviso__icone" aria-hidden="true" />
      <div className="aviso__conteudo">
        <strong>{titulo}</strong>
        <span>{erroReinicio ?? descricao}</span>
      </div>
      {emTauri() && (
        <button id="btn-reiniciar-motor" className="aviso__botao" onClick={reiniciar} disabled={reiniciando}>
          <LuRotateCw className={reiniciando ? 'girando' : ''} aria-hidden="true" />
          {reiniciando ? 'Reiniciando' : 'Reiniciar'}
        </button>
      )}
    </div>
  );
}
