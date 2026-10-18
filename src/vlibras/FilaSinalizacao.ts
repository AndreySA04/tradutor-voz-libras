/**
 * Fila de sinalização do VLibras.
 *
 * Problema: a fala é bem mais rápida do que o avatar consegue sinalizar. Uma fila simples
 * (uma frase por vez, na ordem) acumula atraso sem limite numa conversa longa.
 *
 * Estratégias usadas aqui:
 * 1. Agrupamento: frases que estão esperando são juntadas em uma única tradução
 *    (menos requisições à API e uma animação contínua, sem pausas entre frases).
 * 2. Velocidade adaptativa: quanto maior o atraso/fila, mais rápido o avatar sinaliza.
 * 3. Modo ao vivo: frases que esperaram demais são descartadas (exceto a mais recente),
 *    para o avatar sempre acompanhar o que está sendo dito agora.
 * 4. Watchdog: se o player nunca avisar que terminou (falha de rede, glosa vazia...),
 *    a fila é liberada sozinha em vez de travar para sempre.
 */

/** Subconjunto do Player do VLibras usado pela fila. */
export interface PlayerVLibras {
  translate(texto: string): void;
  stop(): void;
  setSpeed(velocidade: number): void;
  toggleSubtitle(): void;
  on(evento: string, callback: (...args: any[]) => void): void;
  gloss?: string;
}

export interface ConfigFila {
  /** Frases que esperaram mais do que isso são descartadas (a mais recente nunca é). */
  atrasoMaximoMs: number;
  /** Tamanho máximo (em caracteres) de um grupo de frases traduzido de uma vez. */
  caracteresPorLote: number;
  /** Tempo máximo entre pedir a tradução e a animação começar. */
  timeoutInicioMs: number;
  /** Teto de segurança para a duração da animação, por palavra. */
  msPorPalavra: number;
}

export const CONFIG_PADRAO: ConfigFila = {
  atrasoMaximoMs: 15_000,
  caracteresPorLote: 160,
  timeoutInicioMs: 35_000,
  msPorPalavra: 3_000,
};

export interface EstadoFila {
  /** O avatar (Unity) terminou de carregar. */
  carregado: boolean;
  /** Texto sendo sinalizado agora (`iniciado` = a animação já começou; antes disso está traduzindo). */
  atual: { texto: string; glosa: string | null; iniciado: boolean } | null;
  /** Progresso da sinalização atual (0..1). */
  progresso: number;
  /** Frases aguardando. */
  pendentes: string[];
  /** Total de frases descartadas para acompanhar a fala. */
  descartadas: number;
  /** Velocidade atual do avatar (multiplicador). */
  velocidade: number;
}

interface ItemFila {
  texto: string;
  recebidoEm: number;
}

/** Valores aceitos pelo player oficial do VLibras: 0.5, 1, 1.5, 2 e 2.5. */
function velocidadeIdeal(pendentes: number, atrasoMs: number): number {
  if (pendentes >= 2 || atrasoMs > 10_000) return 2;
  if (pendentes >= 1 || atrasoMs > 5_000) return 1.5;
  return 1;
}

export class FilaSinalizacao {
  private fila: ItemFila[] = [];
  private ocupado = false;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private ouvintes = new Set<(estado: EstadoFila) => void>();
  private estado: EstadoFila = {
    carregado: false,
    atual: null,
    progresso: 0,
    pendentes: [],
    descartadas: 0,
    velocidade: 1,
  };

  constructor(
    private readonly player: PlayerVLibras,
    private readonly config: ConfigFila = CONFIG_PADRAO,
  ) {
    player.on('load', () => {
      player.toggleSubtitle(); // usamos nossa própria legenda
      player.setSpeed(1);
      this.atualizar({ carregado: true });
      this.processar();
    });

    player.on('gloss:start', () => {
      if (!this.ocupado) {
        // Tradução que chegou depois de o usuário pular a fila: não deve tocar
        player.stop();
        return;
      }
      const glosa = typeof player.gloss === 'string' ? player.gloss : null;
      const palavras = (glosa ?? this.estado.atual?.texto ?? '').split(/\s+/).length;
      const limite = (palavras * this.config.msPorPalavra) / this.estado.velocidade;
      this.armarWatchdog(Math.max(15_000, limite));
      if (this.estado.atual) {
        this.atualizar({ atual: { ...this.estado.atual, glosa, iniciado: true } });
      }
    });

    player.on('response:glosa', (contador: unknown, total: unknown) => {
      const c = Number(contador);
      const t = Number(total);
      if (this.ocupado && t > 0 && Number.isFinite(c)) {
        this.atualizar({ progresso: Math.min(1, Math.max(0, c / t)) });
      }
    });

    player.on('gloss:end', () => this.encerrarAtual(false));
    player.on('error', () => this.encerrarAtual(false));
  }

  getEstado(): EstadoFila {
    return this.estado;
  }

  assinar(ouvinte: (estado: EstadoFila) => void): () => void {
    this.ouvintes.add(ouvinte);
    ouvinte(this.estado);
    return () => this.ouvintes.delete(ouvinte);
  }

  adicionar(texto: string) {
    const limpo = texto.trim();
    if (!limpo) return;
    this.fila.push({ texto: limpo, recebidoEm: Date.now() });
    this.atualizar({ pendentes: this.textosPendentes() });
    this.processar();
  }

  /** Esvazia a fila e interrompe a sinalização atual ("pular para o agora"). */
  pular() {
    this.fila = [];
    this.atualizar({ pendentes: [] });
    if (this.ocupado) this.encerrarAtual(true);
  }

  private processar() {
    if (!this.estado.carregado || this.ocupado || this.fila.length === 0) return;

    const agora = Date.now();

    let descartadas = 0;
    while (this.fila.length > 1 && agora - this.fila[0].recebidoEm > this.config.atrasoMaximoMs) {
      this.fila.shift();
      descartadas++;
    }

    const lote = [this.fila.shift()!];
    let tamanho = lote[0].texto.length;
    while (this.fila.length > 0 && tamanho + 1 + this.fila[0].texto.length <= this.config.caracteresPorLote) {
      const proximo = this.fila.shift()!;
      lote.push(proximo);
      tamanho += 1 + proximo.texto.length;
    }

    const texto = lote.map((item) => item.texto).join(' ');
    const velocidade = velocidadeIdeal(this.fila.length, agora - lote[0].recebidoEm);
    if (velocidade !== this.estado.velocidade) this.player.setSpeed(velocidade);

    this.ocupado = true;
    this.atualizar({
      atual: { texto, glosa: null, iniciado: false },
      progresso: 0,
      pendentes: this.textosPendentes(),
      descartadas: this.estado.descartadas + descartadas,
      velocidade,
    });

    this.armarWatchdog(this.config.timeoutInicioMs);
    this.player.translate(texto);
  }

  private encerrarAtual(interromper: boolean) {
    if (!this.ocupado) return;
    clearTimeout(this.watchdog);
    this.ocupado = false; // antes do stop(), que pode disparar 'gloss:end' de forma síncrona
    if (interromper) this.player.stop();
    this.atualizar({ atual: null, progresso: 0 });
    this.processar();
  }

  private armarWatchdog(ms: number) {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      console.warn('[VLibras] Sinalização não terminou no tempo esperado; liberando a fila.');
      this.encerrarAtual(true);
    }, ms);
  }

  private textosPendentes() {
    return this.fila.map((item) => item.texto);
  }

  private atualizar(parcial: Partial<EstadoFila>) {
    this.estado = { ...this.estado, ...parcial };
    this.ouvintes.forEach((ouvinte) => ouvinte(this.estado));
  }
}
