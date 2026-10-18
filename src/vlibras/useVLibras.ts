import { RefObject, useEffect, useState } from 'react';
import { Player } from '../vlibras-core/Player.js';
import { EstadoFila, FilaSinalizacao, PlayerVLibras } from './FilaSinalizacao';

// O Unity do VLibras não pode ser destruído/recriado com segurança, então existe uma única
// instância por janela (isso também evita carregar o avatar duas vezes no StrictMode).
let instancia: FilaSinalizacao | null = null;

function obterFila(container: HTMLElement): FilaSinalizacao {
  if (!instancia) {
    const player = new Player({ targetPath: '/target' } as any) as unknown as PlayerVLibras & {
      load(wrapper: HTMLElement): void;
    };
    instancia = new FilaSinalizacao(player);
    player.load(container);
  }
  return instancia;
}

export function useVLibras(container: RefObject<HTMLDivElement | null>) {
  const [estado, setEstado] = useState<EstadoFila | null>(null);

  useEffect(() => {
    if (!container.current) return;
    return obterFila(container.current).assinar(setEstado);
  }, [container]);

  return {
    estado,
    adicionar: (texto: string) => instancia?.adicionar(texto),
    pular: () => instancia?.pular(),
  };
}
