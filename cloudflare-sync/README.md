# LifeHub Sync + App Mobile (Cloudflare Free Tier)

Este pacote hospeda **gratuitamente** na Cloudflare (**Workers + Durable Objects SQLite + Static Assets**):
1. O **LifeHub Mobile** (PWA instalável no **iPhone** e **Android** com funcionamento 100% offline).
2. A **API de Sincronização Zero-Knowledge (AES-256-GCM)** com consistência forte via SQLite por cofre, conectando seu celular ao **LifeHub Desktop Windows**.

## Custos
- **R$ 0 / mês** no plano gratuito da Cloudflare:
  - 100.000 requisições/dia no Workers e Durable Objects SQLite (5 GB grátis)
  - Hospedagem estática do app mobile inclusa no mesmo endereço `https://lifehub-sync.<seu-subdominio>.workers.dev`

## Como publicar (1 comando após autenticar)

Na raiz do projeto LifeHub:

```powershell
# 1. Gerar o build do App Mobile (pasta dist-mobile/)
npm run build:mobile

# 2. Entrar na pasta do Worker e publicar (cria o Durable Object SQLite automaticamente)
cd cloudflare-sync
npm install
npm run deploy
```

> Autenticação: use `npx wrangler login` ou defina `CLOUDFLARE_API_TOKEN` (com permissão **Account → Workers Scripts → Edit**) e `CLOUDFLARE_ACCOUNT_ID` em `cloudflare-sync/.env`.
