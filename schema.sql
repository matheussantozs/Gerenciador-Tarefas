-- Execute este script no SQL Editor do Neon (opcional, pois a API também cria automaticamente)
CREATE TABLE IF NOT EXISTS tarefas (
  id SERIAL PRIMARY KEY,
  titulo VARCHAR(255) NOT NULL,
  descricao TEXT DEFAULT '',
  categoria VARCHAR(50) DEFAULT 'Geral',
  prioridade VARCHAR(20) DEFAULT 'media',
  data_limite DATE NULL,
  concluida BOOLEAN DEFAULT FALSE,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Caso você já tenha criado a tabela antiga, estes comandos adicionam as novas colunas sem apagar dados:
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS descricao TEXT DEFAULT '';
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS categoria VARCHAR(50) DEFAULT 'Geral';
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS prioridade VARCHAR(20) DEFAULT 'media';
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS data_limite DATE NULL;
