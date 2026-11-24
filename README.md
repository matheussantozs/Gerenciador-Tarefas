# TaskFlow Pro — Projeto Full-Stack (Node.js + Neon PostgreSQL + Vercel)

Aplicação Web Full-Stack responsiva para gerenciamento de tarefas e prazos.

## Como rodar localmente

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Verifique se o arquivo `.env` contém sua `DATABASE_URL` do Neon.
3. Inicie o servidor:
   ```bash
   npm start
   ```
4. Acesse no navegador: `http://localhost:3000`

## Como publicar na Vercel (HTTPS)

1. Envie este projeto para um repositório no **GitHub** (o `.gitignore` já protege o `.env`).
2. Acesse [vercel.com](https://vercel.com), clique em **Add New > Project** e importe o repositório.
3. Em **Environment Variables**, adicione:
   - **Name:** `DATABASE_URL`
   - **Value:** *(cole a URL de conexão do seu banco no Neon)*
4. Clique em **Deploy**.
