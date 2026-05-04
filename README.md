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

### 🤖 Tradução para Libras

**Avatar 3D Integrado:**  
Utilização do personagem Ícaro (VLibras) para a sinalização dos termos traduzidos.

**Fila de Reprodução (Queue System):**  
Implementação de uma lógica de fila no React que impede que uma frase curta interrompa a animação de uma frase longa em andamento, garantindo uma sinalização fluida e completa.

---

### 🖥️ Interface

**Modo Flutuante:**  
A janela é configurada para permanecer sempre acima de outros aplicativos, facilitando o uso durante videochamadas ou consumo de vídeos.

**Design Minimalista:**  
Interface limpa, sem bordas pesadas, focada totalmente no avatar e nos controles essenciais.

**Janela Interativa:**  
O usuário pode arrastar a janela livremente pela tela para posicioná-la onde for mais conveniente.

---

### 🛠️ Controles

**Gerenciamento de Áudio:**  
Botão de Mute/Unmute com feedback visual instantâneo. Ao mutar, o motor Python interrompe o processamento de áudio para garantir a privacidade do usuário.

**Feedback de Status:**  
O ícone do microfone altera sua opacidade e cor (verde/vermelho) para indicar se o sistema está ouvindo ativamente ou em repouso.

---

### 📌 Observações

- Necessário microfone funcional
- O modelo Vosk deve estar presente localmente
- O VLibras depende do carregamento inicial dos assets
## ⚙️ Instalação e Execução Local

Siga os passos abaixo para configurar os dois ambientes necessários.


### 🐍 1. Motor de Reconhecimento de Voz (Python)

Esta parte é responsável por capturar o áudio do microfone e processar a transcrição via Vosk.

#### 📂 Acesse a pasta do motor
```bash
cd src-tauri/motor-voz
```

#### 🧪 Crie e ative um ambiente virtual (Venv)
```bash
python -m venv venv

# No Windows:
.\venv\Scripts\activate

# No Linux/Mac:
source venv/bin/activate
```

#### 📦 Instale as dependências
```bash
pip install -r requirements.txt
```

#### ⚙️ Configure o modelo

- Baixe o modelo em português (vosk-model-small-pt-0.3) no site oficial do Vosk
- Extraia o conteúdo e renomeie a pasta para modelo dentro de:

```bash
src-tauri/motor-voz/
```

#### ▶️ Execute o motor
```bash
python motor.py
```

### 🖥️ 2. Interface Gráfica e Desktop (Tauri + React)

Esta parte gerencia a interface do usuário, a renderização do avatar e a conexão WebSocket com o Python.

#### 📂 Acesse a raiz do projeto
```bash
cd ../..
```

#### 📦 Instale as dependências do Node.js
```bash
npm install
```

#### ▶️ Execute o ambiente de desenvolvimento do Tauri
```bash
npm run tauri dev
```

### 🔄 Fluxo de Comunicação
Para entender como os dados trafegam no sistema:

- O motor Python abre um servidor WebSocket na porta 8765
- A interface React se conecta a esse servidor assim que é iniciada
- Ao detectar voz, o Python envia uma string de texto via socket
- O React recebe o texto, adiciona-o a uma fila de sinais
- O avatar 3D executa as animações conforme a disponibilidade