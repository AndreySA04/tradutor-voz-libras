import request from 'superagent';

// Cache em memória compartilhado entre todas as requisições
const cacheGlosas = new Map();

// Tenta restaurar do localStorage para persistir entre reinicializações
const CHAVE_STORAGE = '@vlibras_glosa_cache_v1';
try {
  const salvo = localStorage.getItem(CHAVE_STORAGE);
  if (salvo) {
    const itens = JSON.parse(salvo);
    for (const [k, v] of Object.entries(itens)) {
      cacheGlosas.set(k, v);
    }
  }
} catch {
  // Ignora se localStorage indisponível
}

function salvarCacheNoStorage() {
  try {
    // Guarda os últimos 300 termos mais frequentes
    const obj = {};
    const entradas = Array.from(cacheGlosas.entries()).slice(-300);
    for (const [k, v] of entradas) {
      obj[k] = v;
    }
    localStorage.setItem(CHAVE_STORAGE, JSON.stringify(obj));
  } catch {
    // quota exceeded ou storage desabilitado
  }
}

// Dicionário pré-aquecido de termos e saudações comuns para resposta instantânea (0 ms de rede)
const PRE_AQUECIDOS = {
  'olá': 'OI',
  'ola': 'OI',
  'oi': 'OI',
  'tudo bem': 'TUDO BEM',
  'olá tudo bem': 'OI TUDO BEM',
  'ola tudo bem': 'OI TUDO BEM',
  'oi tudo bem': 'OI TUDO BEM',
  'bom dia': 'BOM DIA',
  'boa tarde': 'BOA TARDE',
  'boa noite': 'BOA NOITE',
  'sim': 'SIM',
  'não': 'NÃO',
  'nao': 'NÃO',
  'obrigado': 'OBRIGADO',
  'obrigada': 'OBRIGADO',
  'por favor': 'POR-FAVOR',
  'desculpa': 'DESCULPA',
  'com licença': 'COM-LICENÇA',
  'com licenca': 'COM-LICENÇA',
  'tchau': 'TCHAU',
  'até logo': 'ATÉ LOGO',
  'ate logo': 'ATÉ LOGO',
  'programação': 'PROGRAMAÇÃO',
  'programacao': 'PROGRAMAÇÃO',
  'software': 'SOFTWARE',
  'computador': 'COMPUTADOR',
};

for (const [termo, glosa] of Object.entries(PRE_AQUECIDOS)) {
  if (!cacheGlosas.has(termo)) {
    cacheGlosas.set(termo, glosa);
  }
}

// Controle de requisições em voo para evitar duplicar chamadas para o mesmo texto
const emAndamento = new Map();

function normalizar(texto) {
  return String(texto || '')
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:]+$/, '');
}

function GlosaTranslator(endpoint) {
  this.endpoint = endpoint;
}

GlosaTranslator.prototype.translate = function (text, domain, callback) {
  const chave = normalizar(text);

  if (!chave) {
    queueMicrotask(() => callback(''));
    return;
  }

  // 1. Acerto no cache: responde imediatamente sem latência de rede
  if (cacheGlosas.has(chave)) {
    const glosaCached = cacheGlosas.get(chave);
    queueMicrotask(() => callback(glosaCached));
    return;
  }

  // 2. Se já existe uma requisição em andamento para este mesmo texto, junta-se a ela
  if (emAndamento.has(chave)) {
    emAndamento.get(chave).push(callback);
    return;
  }

  emAndamento.set(chave, [callback]);

  const dispararTodos = (glosa, erro) => {
    const lista = emAndamento.get(chave) || [];
    emAndamento.delete(chave);
    for (const cb of lista) {
      try {
        cb(glosa, erro);
      } catch (e) {
        console.error('Erro no callback do tradutor:', e);
      }
    }
  };

  const time = 15000;
  let hasTimeout = false;

  const timeout = setTimeout(() => {
    hasTimeout = true;
    dispararTodos(undefined, 'timeout_error');
  }, time);

  request
    .post(this.endpoint, { text: text, domain: domain })
    .end(function (err, response) {
      if (hasTimeout) return;
      clearTimeout(timeout);

      if (err) {
        dispararTodos(undefined, err);
      } else {
        const glosaFinal = response.text || '';
        if (glosaFinal) {
          cacheGlosas.set(chave, glosaFinal);
          salvarCacheNoStorage();
        }
        dispararTodos(glosaFinal);
      }
    });
};

export default GlosaTranslator;