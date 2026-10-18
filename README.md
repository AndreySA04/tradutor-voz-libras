# ✋ Tradutor de Voz para Libras

Este projeto é uma aplicação desktop desenvolvida como Trabalho de Graduação (TG) para o curso de Análise e Desenvolvimento de Sistemas da Fatec Indaiatuba. O sistema utiliza inteligência artificial para transcrever voz em tempo real e traduzi-la para a Língua Brasileira de Sinais (Libras) através de um avatar 3D.

## 🧠 Como funciona

- O microfone captura o áudio do usuário  
- O Python (Vosk) transcreve a fala em tempo real  
- O texto é enviado via WebSocket para o React  
- O React organiza os textos em uma fila de execução  
- O VLibras renderiza os sinais com um avatar 3D

---

## 🚀 Tecnologias Utilizadas

- React + TypeScript (Interface)
- Tauri v2 (Aplicação Desktop)
- Python + Vosk (Reconhecimento de voz offline)
- WebSocket (Comunicação em tempo real)
- VLibras (Avatar 3D integrado localmente)

---

## 📦 Estrutura do Projeto
```text
tradutor-voz-libras/
├── src/                         # Interface Gráfica (React + TS)
│   ├── assets/                  # Imagens e ícones da UI
│   ├── vlibras-core/            # Arquivos do motor VLibras (Player.js)
│   ├── App.tsx                  # Lógica principal, WebSocket e Fila
│   ├── App.css                  # Estilização e transparência do Unity
│   └── main.tsx                 # Ponto de entrada do React
│
├── src-tauri/                   # Camada Nativa (Rust)
│   ├── src/                     # Código-fonte Rust
│   │   └── main.rs              # Inicialização do App e do Sidecar (Python)
│   ├── motor-voz/               # Motor de IA (Python)
│   │   ├── modelo/              # Pesos do modelo Vosk (Offline)
│   │   ├── venv/                # Ambiente virtual (Ignorado no Git)
│   │   ├── motor.py             # Lógica do Vosk + Servidor WebSocket
│   │   └── requirements.txt     # Dependências do Python
│   ├── tauri.conf.json          # Configuração da janela e do Sidecar
│   └── Cargo.toml               # Dependências do ecossistema Rust
│
├── public/                      # Arquivos estáticos do VLibras (Target)
├── package.json                 # Scripts e dependências do Node.js
├── tsconfig.json                # Configurações do TypeScript
├── .gitignore                   # Regras de exclusão de arquivos (Git)
└── README.md                    # Documentação do projeto
```
## ✨ Funcionalidades Principais

O sistema foi projetado para ser uma ferramenta de acessibilidade discreta, eficiente e de alta performance.

---

### 🎙️ Reconhecimento de Voz

**Privacidade e Velocidade:**  
Utiliza o motor Vosk, permitindo que o reconhecimento de fala ocorra localmente, sem a necessidade de enviar dados de áudio para a nuvem.

**Baixo Consumo:**  
Configurado com o modelo *small* para garantir que o motor de voz não sobrecarregue o processamento do computador.

---

### 🤖 Tradução e Fila Inteligente para Libras

**Avatar 3D Integrado:**  
Utilização do personagem Ícaro (VLibras) para a sinalização dos termos traduzidos.

**Fila Inteligente e Anti-Atraso (Smart Queue):**  
- **Agrupamento de frases:** sentenças em espera são unificadas em uma única tradução, evitando pausas e requisições repetidas.
- **Velocidade adaptativa:** o avatar acelera automaticamente (1x → 1.5x → 2x) quando há acúmulo de frases na fila.
- **Modo ao vivo:** frases antigas (>15s) são descartadas em caso de engarrafamento para priorizar a fala atual.
- **Watchdog anti-travamento:** recuperação automática caso o player Unity não emita o término da animação.
- **Botão "Pular":** permite ao usuário limpar a fila e interromper a animação a qualquer momento.

---

### 🖥️ Interface Moderna e Feedback Visual

- **Barra de título personalizada:** arrastável, com controles de janela (minimizar/fechar) e indicador de status (ouvindo, sinalizando, conectando, mudo, erro).
- **Legendas em tempo real:** exibição da frase atual em execução, estrutura de glosa em Libras e barra de progresso.
- **Equalizador de voz ao vivo:** visualizador com ondas de áudio dinâmicas e transcrição parcial enquanto o usuário fala.
- **Design Glassmorphism:** tema escuro sofisticado com cantos arredondados, tipografia Inter e feedback por microinterações.

---

### 🛠️ Resiliência e Inicialização Automática

- **Inicialização transparente:** o Tauri inicia o motor Python automaticamente ao abrir o app e o finaliza ao fechar a janela.
- **WebSocket auto-regenerativo:** reconexão com backoff exponencial (0.5s a 5s) e sincronização do estado de mute.
- **Painel de diagnóstico:** aviso com botão de "Reiniciar motor" caso ocorra queda ou erro no microfone/modelo.

---

### 📌 Observações

- Necessário microfone funcional
- O modelo Vosk em português deve estar presente na pasta `src-tauri/motor-voz/modelo`
- Conexão com a internet necessária para os dicionários e tradução de glosas do VLibras

## ⚙️ Instalação e Execução Local

### 1. Configurar o Modelo de Voz (Python)

1. Certifique-se de que o Python 3.10+ está instalado.
2. Na pasta `src-tauri/motor-voz`, instale as dependências:
   ```bash
   cd src-tauri/motor-voz
   pip install -r requirements.txt
   ```
3. Baixe o modelo `vosk-model-small-pt-0.3` do site oficial do Vosk e extraia na pasta:
   ```bash
   src-tauri/motor-voz/modelo/
   ```

### 2. Executar a Aplicação (Tauri + React)

Na raiz do projeto:
```bash
npm install
npm run tauri dev
```

> **Nota:** O Tauri inicia o motor Python automaticamente em segundo plano. Caso prefira rodar o motor em um terminal separado para depuração, basta executar `python src-tauri/motor-voz/motor.py` antes de iniciar a interface — o Tauri detectará a porta ativa e não iniciará uma segunda instância.