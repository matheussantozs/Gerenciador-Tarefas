require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());

// Habilita CORS para permitir acesso tanto pela mesma origem quanto via Live Server local
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Higieniza a string de conexão do Neon (remove channel_binding que causa erro no driver pg)
function prepararConnectionString(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl.trim());
    url.searchParams.delete('channel_binding');
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

const connectionString = prepararConnectionString(process.env.DATABASE_URL);

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
  : null;

let bancoInicializado = false;

// Cria ou atualiza a tabela automaticamente no Neon na primeira requisição
async function garantirEstruturaBanco() {
  if (!pool) {
    throw new Error('Variável DATABASE_URL não configurada no arquivo .env ou na Vercel.');
  }
  if (bancoInicializado) return;

  await pool.query(`
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
  `);

  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS descricao TEXT DEFAULT '';`);
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS categoria VARCHAR(50) DEFAULT 'Geral';`);
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS prioridade VARCHAR(20) DEFAULT 'media';`);
  await pool.query(`ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS data_limite DATE NULL;`);

  bancoInicializado = true;
}

// 0. Rota de Diagnóstico / Health Check
app.get('/api/health', async (req, res) => {
  try {
    await garantirEstruturaBanco();
    const dbCheck = await pool.query('SELECT NOW() AS agora');
    res.json({
      status: 'online',
      banco: 'conectado',
      hora_servidor_db: dbCheck.rows[0].agora,
    });
  } catch (err) {
    console.error('Erro no health check:', err);
    res.status(500).json({
      status: 'erro',
      erro: err.message || 'Falha na conexão com o PostgreSQL (Neon).',
    });
  }
});

// 1. Estatísticas gerais para o Dashboard
app.get('/api/estatisticas', async (req, res) => {
  try {
    await garantirEstruturaBanco();
    const statsQuery = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE concluida = TRUE)::int AS concluidas,
        COUNT(*) FILTER (WHERE concluida = FALSE)::int AS pendentes,
        COUNT(*) FILTER (WHERE concluida = FALSE AND prioridade = 'alta')::int AS alta_prioridade,
        COUNT(*) FILTER (WHERE concluida = FALSE AND data_limite IS NOT NULL AND data_limite < CURRENT_DATE)::int AS atrasadas
      FROM tarefas;
    `);
    res.json(statsQuery.rows[0]);
  } catch (err) {
    console.error('Erro ao buscar estatísticas:', err);
    res.status(500).json({ erro: err.message || 'Erro ao calcular estatísticas.' });
  }
});

// 2. Listar tarefas com busca, filtros e ordenação (GET)
app.get('/api/tarefas', async (req, res) => {
  try {
    await garantirEstruturaBanco();
    const { busca, status, categoria, prioridade, ordenar } = req.query;

    const condicoes = [];
    const valores = [];

    if (busca && busca.trim() !== '') {
      valores.push(`%${busca.trim()}%`);
      condicoes.push(`(titulo ILIKE $${valores.length} OR descricao ILIKE $${valores.length})`);
    }

    if (status === 'pendentes') {
      condicoes.push('concluida = FALSE');
    } else if (status === 'concluidas') {
      condicoes.push('concluida = TRUE');
    }

    if (categoria && categoria !== 'todas') {
      valores.push(categoria);
      condicoes.push(`categoria = $${valores.length}`);
    }

    if (prioridade && prioridade !== 'todas') {
      valores.push(prioridade);
      condicoes.push(`prioridade = $${valores.length}`);
    }

    const whereClause = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

    let orderClause = 'ORDER BY concluida ASC, id DESC';
    if (ordenar === 'prazo') {
      orderClause = 'ORDER BY concluida ASC, data_limite ASC NULLS LAST, id DESC';
    } else if (ordenar === 'prioridade') {
      orderClause = `ORDER BY concluida ASC,
        CASE prioridade WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END ASC,
        id DESC`;
    }

    const sql = `
      SELECT
        id,
        titulo,
        COALESCE(descricao, '') AS descricao,
        COALESCE(categoria, 'Geral') AS categoria,
        COALESCE(prioridade, 'media') AS prioridade,
        TO_CHAR(data_limite, 'YYYY-MM-DD') AS data_limite,
        concluida,
        criado_em
      FROM tarefas
      ${whereClause}
      ${orderClause}
    `;

    const result = await pool.query(sql, valores);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao listar tarefas:', err);
    res.status(500).json({ erro: err.message || 'Erro ao buscar tarefas no banco de dados.' });
  }
});

// 3. Criar nova tarefa completa (POST)
app.post('/api/tarefas', async (req, res) => {
  const { titulo, descricao, categoria, prioridade, data_limite } = req.body;
  if (!titulo || titulo.trim() === '') {
    return res.status(400).json({ erro: 'O título da tarefa é obrigatório.' });
  }

  const prioridadesValidas = ['baixa', 'media', 'alta'];
  const prioridadeFinal = prioridadesValidas.includes(prioridade) ? prioridade : 'media';
  const categoriaFinal = categoria && categoria.trim() ? categoria.trim() : 'Geral';
  const descricaoFinal = descricao ? descricao.trim() : '';
  const dataFinal = data_limite && data_limite.trim() !== '' ? data_limite.trim() : null;

  try {
    await garantirEstruturaBanco();
    const result = await pool.query(
      `INSERT INTO tarefas (titulo, descricao, categoria, prioridade, data_limite)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, titulo, descricao, categoria, prioridade, TO_CHAR(data_limite, 'YYYY-MM-DD') AS data_limite, concluida, criado_em`,
      [titulo.trim(), descricaoFinal, categoriaFinal, prioridadeFinal, dataFinal]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao criar tarefa:', err);
    res.status(500).json({ erro: err.message || 'Erro ao salvar tarefa no banco.' });
  }
});

// 4. Editar uma tarefa completa (PUT)
app.put('/api/tarefas/:id', async (req, res) => {
  const { id } = req.params;
  const { titulo, descricao, categoria, prioridade, data_limite, concluida } = req.body;

  if (!titulo || titulo.trim() === '') {
    return res.status(400).json({ erro: 'O título da tarefa é obrigatório.' });
  }

  const prioridadesValidas = ['baixa', 'media', 'alta'];
  const prioridadeFinal = prioridadesValidas.includes(prioridade) ? prioridade : 'media';
  const categoriaFinal = categoria && categoria.trim() ? categoria.trim() : 'Geral';
  const descricaoFinal = descricao ? descricao.trim() : '';
  const dataFinal = data_limite && data_limite.trim() !== '' ? data_limite.trim() : null;

  try {
    await garantirEstruturaBanco();
    const result = await pool.query(
      `UPDATE tarefas
       SET titulo = $1,
           descricao = $2,
           categoria = $3,
           prioridade = $4,
           data_limite = $5,
           concluida = COALESCE($6, concluida)
       WHERE id = $7
       RETURNING id, titulo, descricao, categoria, prioridade, TO_CHAR(data_limite, 'YYYY-MM-DD') AS data_limite, concluida, criado_em`,
      [titulo.trim(), descricaoFinal, categoriaFinal, prioridadeFinal, dataFinal, concluida, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'Tarefa não encontrada.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao editar tarefa:', err);
    res.status(500).json({ erro: err.message || 'Erro ao atualizar tarefa.' });
  }
});

// 5. Alternar status de conclusão (PATCH)
app.patch('/api/tarefas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await garantirEstruturaBanco();
    const result = await pool.query(
      `UPDATE tarefas
       SET concluida = NOT concluida
       WHERE id = $1
       RETURNING id, titulo, descricao, categoria, prioridade, TO_CHAR(data_limite, 'YYYY-MM-DD') AS data_limite, concluida, criado_em`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'Tarefa não encontrada.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao alternar tarefa:', err);
    res.status(500).json({ erro: err.message || 'Erro ao atualizar status da tarefa.' });
  }
});

// 6. Limpar todas as tarefas concluídas (DELETE em lote)
app.delete('/api/tarefas-concluidas', async (req, res) => {
  try {
    await garantirEstruturaBanco();
    const result = await pool.query('DELETE FROM tarefas WHERE concluida = TRUE RETURNING id');
    res.json({ removidas: result.rowCount });
  } catch (err) {
    console.error('Erro ao limpar concluídas:', err);
    res.status(500).json({ erro: err.message || 'Erro ao limpar tarefas concluídas.' });
  }
});

// 7. Excluir tarefa individual (DELETE)
app.delete('/api/tarefas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await garantirEstruturaBanco();
    const result = await pool.query('DELETE FROM tarefas WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'Tarefa não encontrada.' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('Erro ao excluir tarefa:', err);
    res.status(500).json({ erro: err.message || 'Erro ao excluir tarefa.' });
  }
});

// Execução local (fora da Vercel)
if (!process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, '../public')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;
