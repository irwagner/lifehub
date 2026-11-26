# Política de Privacidade — LifeHub (Central de Vida)

**Última atualização:** 26 de novembro de 2026  
**Aplicativo:** LifeHub (`com.lifehub.mobile`)  
**Desenvolvedor / Repositório:** https://github.com/irwagner/lifehub

## 1. Arquitetura Local-First (Seus dados são seus)
O LifeHub foi projetado para funcionar **100% offline** em banco de dados SQLite armazenado localmente no seu dispositivo. Nós **não** operamos servidores centrais de coleta de dados, não vendemos dados e não exibimos anúncios ou rastreadores de terceiros.

## 2. Permissões do Dispositivo
- **Câmera (`android.permission.CAMERA`):** utilizada **exclusivamente** quando o usuário toca em *"Conectar ao PC (QR Code)"* ou *"Escanear QR Code do PC"* para ler o código de pareamento exibido no computador. Nenhuma foto ou vídeo é gravada, enviada ou compartilhada.
- **Internet (`android.permission.INTERNET`):** utilizada somente para recursos **opcionais** ativados manualmente pelo usuário (sincronização criptografada, backup no Google Drive/Sheets, atualização pelo GitHub ou consultas ao Assistente IA Gemini).

## 3. Sincronização Opcional (Criptografia Ponta a Ponta — E2EE)
Se o usuário optar por sincronizar PC e celular via Cloudflare Workers ou Google Drive:
- Todo o banco de dados é criptografado localmente no dispositivo com **AES-256-GCM** (chave derivada com PBKDF2-SHA256) **antes** de qualquer transmissão.
- A chave secreta do cofre nunca é enviada em texto claro a terceiros.
- No modo **Google Drive (OAuth 2.0)**, o aplicativo solicita apenas o escopo restrito `https://www.googleapis.com/auth/drive.file`, tendo acesso somente aos arquivos criados pelo próprio LifeHub (pasta `LifeHub/lifehub-vault-e2ee.json`).

## 4. Assistente IA Opcional (Google Gemini)
O Assistente IA é totalmente opcional (opt-in) e utiliza a chave API fornecida pelo próprio usuário no Google AI Studio. Nenhum dado é enviado ao Google Gemini enquanto o usuário não configurar sua própria chave e enviar manualmente uma mensagem no chat da IA. O usuário também pode ocultar valores financeiros (`R$`) nas configurações da IA.

## 5. Exclusão de Dados
Como os dados ficam no próprio dispositivo do usuário (e, se ativado, no cofre pessoal do Cloudflare ou Google Drive do próprio usuário):
- Para apagar todos os dados locais: **Configurações → Backup → Limpar Todos os Dados** ou desinstale o aplicativo.
- Para apagar a cópia no Google Drive: remova o arquivo `lifehub-vault-e2ee.json` na pasta `LifeHub` do seu Google Drive.

## 6. Contato
Para dúvidas sobre privacidade, abra uma issue em https://github.com/irwagner/lifehub/issues.
