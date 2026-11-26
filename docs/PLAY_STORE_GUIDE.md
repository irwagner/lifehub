# Guia Completo: Como Publicar o LifeHub na Google Play Store

O projeto LifeHub já está preparado tecnicamente para a Google Play Store:
- **`applicationId`**: `com.lifehub.mobile` (pode ser alterado antes do primeiro envio se desejar um domínio próprio, ex.: `br.com.seunome.lifehub`).
- **`targetSdkVersion`**: `35` (Android 15 — exigido pela Google Play em 2025/2026).
- **Formato exigido pela Play Store (`.aab`)**: o workflow [`.github/workflows/release-mobile.yml`](../.github/workflows/release-mobile.yml) gera e assina automaticamente **`LifeHub-Android.aab`** em toda release `v*` usando a chave permanente (`lifehub-release.keystore`).
- **Política de Privacidade pronta**: [`docs/PRIVACY_POLICY.md`](./PRIVACY_POLICY.md) (URL pública direta no GitHub).

---

## Passo 1 — Criar a Conta no Google Play Console
1. Acesse [play.google.com/console](https://play.google.com/console).
2. Pague a taxa única de registro de desenvolvedor (**US$ 25**, válida vitaliciamente).
3. Conclua a verificação de identidade (RG/CNH + comprovante de endereço + perfil de pagamentos).

## Passo 2 — Criar o App na Console
1. Clique em **Criar app**:
   - **Nome:** `LifeHub — Central de Vida`
   - **Idioma padrão:** Português (Brasil)
   - **Tipo:** App | **Gratuito**
2. Preencha o checklist do painel **Configurar seu app**:
   - **Política de Privacidade:** cole o link público `https://github.com/irwagner/lifehub/blob/main/docs/PRIVACY_POLICY.md` (ou uma página em Cloudflare Pages).
   - **Acesso ao app:** marque *"Todas as funcionalidades estão disponíveis sem acesso especial"* (pois o app funciona 100% offline sem precisar de login!).
   - **Anúncios:** *"Não, meu app não contém anúncios"*.
   - **Classificação indicativa:** preencha o questionário IARC (resultado esperado: Livre / L).
   - **Público-alvo:** 18+ (ou 13+, por envolver finanças pessoais).
   - **Segurança dos dados (Data Safety):**
     - O app coleta ou compartilha dados com terceiros? **Não** (dados ficam no dispositivo; sync e IA são opcionais e controlados pelo próprio usuário com E2EE).
     - Caso ative login Google Drive OAuth, informe que há backup opcional criptografado em trânsito e que o usuário pode excluir seus dados a qualquer momento.

## Passo 3 — Assets Gráficos da Ficha da Loja
Prepare no painel **Presença na loja → Ficha principal**:
- **Ícone do app:** `512 × 512 px` PNG (32 bits, sem transparência excessiva).
- **Gráfico de recursos (banner):** `1024 × 500 px` PNG/JPG.
- **Capturas de tela (Celular):** mínimo **2 screenshots** (recomendado 4 a 6: Tela Inicial/Boas-vindas, Dashboard Hoje, Finanças/Cartões, Uber/99, Calendário, IA Gemini).
- **Descrição curta (até 80 caracteres):** ex. `Finanças, rotina, Uber/99, agenda e IA Gemini 100% offline ou com sync E2EE.`

## Passo 4 — Enviar o Arquivo `LifeHub-Android.aab`
1. Baixe `LifeHub-Android.aab` da última release em [github.com/irwagner/lifehub/releases](https://github.com/irwagner/lifehub/releases).
2. No Play Console, aceite a **Assinatura de apps pelo Google Play (Play App Signing)** — a chave atual do GitHub Actions funcionará como sua **Chave de Upload (Upload Key)**.
3. **Atenção à regra de Contas Pessoais (obrigatória pelo Google):**
   - Contas pessoais criadas após novembro/2023 precisam primeiro publicar em **Teste Fechado (Closed Testing)** com **pelo menos 12 testadores** (amigos/familiares com conta Gmail) que aceitem o convite e mantenham o app instalado por **14 dias consecutivos**.
   - Depois dos 14 dias, clique em **Solicitar acesso à Produção** na Console, responda o formulário curto sobre o teste e o app fica disponível publicamente na Google Play Store!

## Passo 5 — Atualizações Futuras
Sempre que publicar uma nova tag `v0.x.y` no GitHub:
1. O `versionCode` em `android/app/build.gradle` aumenta automaticamente (ex.: `502`, `503`…).
2. O GitHub Actions gera um novo `LifeHub-Android.aab` assinado com a mesma Upload Key.
3. Basta subir o novo `.aab` na Google Play Console → **Produção → Criar nova versão**.
