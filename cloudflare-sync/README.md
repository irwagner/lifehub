# LifeHub Sync + App Mobile (Cloudflare Free Tier)

Este pacote hospeda **gratuitamente** na Cloudflare (Workers + KV + Assets):
1. O **LifeHub Mobile** (PWA instalável no **iPhone** e **Android** com funcionamento 100% offline).
2. A **API de Sincronização Zero-Knowledge (AES-256-GCM)** que conecta seu celular ao **LifeHub Desktop Windows**.

## Custos
- **R$ 0 / mês** no plano gratuito da Cloudflare:
  - 100.000 requisições/dia no Workers
  - 100.000 leituras/dia + 1.000 escritas/dia + 1 GB no KV (um cofre LifeHub criptografado ocupa ~20 KB)
  - Hospedagem estática do app mobile inclusa no mesmo endereço `https://lifehub-sync.<seu-subdominio>.workers.dev`

## Como publicar em 3 passos (uma única vez)

Na raiz do projeto LifeHub:

```powershell
# 1. Gerar o build do App Mobile (pasta dist-mobile/)
npm run build:mobile

# 2. Entrar na pasta do Worker e instalar o Wrangler
cd cloudflare-sync
npm install
npx wrangler login

# 3. Criar o namespace KV gratuito (copie o "id" exibido e cole em wrangler.jsonc)
npm run kv:create

# 4. Publicar Worker + App Mobile no seu endereço gratuito *.workers.dev
npm run deploy
```

## Como conectar Desktop + iPhone / Android
1. No **LifeHub Desktop**, vá em **Configurações → Sincronização Celular (Cloudflare Free)**.
2. Cole a URL gerada (ex.: `https://lifehub-sync.sua-conta.workers.dev`), clique em **Gerar Chave Secreta** e em **Sincronizar Agora**.
3. Clique em **Copiar Link de Pareamento** e envie para seu celular (WhatsApp/Telegram para você mesmo).
4. Abra o link no **Safari (iPhone)** ou **Chrome (Android)**: o app já abre pareado!
   - **iPhone:** toque em **Compartilhar → Adicionar à Tela de Início**.
   - **Android:** toque em **Menu (⋮) → Instalar aplicativo**.
