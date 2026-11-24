# LifeHub — Central de Vida

Aplicativo desktop **local-first para Windows** (Tauri 2 + React + TypeScript + Vite + Tailwind CSS + SQLite), projetado para centralizar finanças pessoais, trabalho por aplicativos (Uber Moto e 99Moto — **iFood fora do escopo**), rotina CLT/Aplicativos/TI, calendário, tarefas, saúde, família, estudos/carreira TI, ideias e revisão semanal.

## Princípios implementados
- **Offline-first & Privacidade**: dados gravados apenas localmente em SQLite; nenhuma credencial de terceiros, nenhum scraping, nenhuma sincronização em nuvem nesta fase.
- **Sem dados inventados em produção**: na primeira execução, o banco inicia limpo (apenas configurações estruturais, categorias padrão, hábitos base e trilhas de TI). Existe um botão explícito e opcional para carregar **Dados de Demonstração**.
- **Flexibilidade de rotina**: suporte real aos modos **Trabalho CLT**, **Trabalho por Aplicativos** e **Emprego de TI**, com templates semanais e alternância sem perda de histórico.
- **Financeiro verdadeiro**: separação clara entre faturamento bruto, combustível, pedágio/estacionamento, manutenção estimada por km, depreciação (campo separado), parcela fixa da moto e lucro líquido.
- **Proteção de fins de semana com o filho**: modo todos / alternados (quinzenal com data âncora escolhida pelo usuário, sem assumir data inicial) / manual, bloqueando trabalho no sábado nos templates e alertando em conflitos manuais.

## Arquitetura do Repositório
- `src-tauri/`: aplicação desktop Tauri 2 para Windows com plugin oficial `tauri-plugin-sql` (feature `sqlite`) e permissões locais em `capabilities/default.json`.
- `src/db/`:
  - `migrations.ts`: schema SQLite completo com chaves estrangeiras, índices e migrações incrementais idempotentes.
  - `tauriAdapter.ts`: adaptador nativo usando `@tauri-apps/plugin-sql` (`sqlite:lifehub.db`).
  - `sqljsAdapter.ts`: adaptador SQLite real via WebAssembly (`sql.js`, 100% offline com `public/sql-wasm.wasm`) para execução em navegador/Vite e testes automatizados em memória.
- `src/services/`: cálculos financeiros e de jornadas (`calculations.ts`), recorrência de fins de semana com o filho (`recurrence.ts`), templates de agenda (`scheduleTemplates.ts`), validações Zod (`validation.ts`), backup/restauração atômica (`backup.ts`) e seed de demonstração opcional (`demoSeed.ts`).
- `src/repositories/`: camada de acesso SQLite por domínio (`settingsRepo`, `financeRepo`, `workRepo`, `calendarRepo`, `habitsRepo`, `familyRepo`, `careerRepo`, `ideasRepo`, `dashboardRepo`).
- `src/pages/` e `src/components/`: interface moderna em `pt-BR`, modo escuro padrão (com alternância para claro), datas `DD/MM/YYYY`, horário 24h e moeda `BRL`.

## Requisitos no Windows
### Para rodar o frontend + SQLite local (imediato)
- Node.js 20+ e `pnpm` (já verificados neste ambiente: Node `v26.5.1`, pnpm `11.18.0`).

### Para compilar e executar o binário desktop nativo (Tauri 2)
- Microsoft Edge WebView2 Runtime (já presente neste ambiente).
- Visual Studio Build Tools com C++ (Visual Studio 18 Professional já presente neste ambiente).
- **Rust toolchain (`rustup`, `rustc`, `cargo`)**: ainda não instalado nesta máquina. Para instalar no Windows:
  1. Baixe e execute `rustup-init.exe` em https://rustup.rs/ (ou via `winget install Rustlang.Rustup`).
  2. Reabra o terminal e confirme com `rustc --version` e `cargo --version`.

## Como executar no Windows

### 1. Instalar dependências
```powershell
pnpm install
```

### 2. Executar testes automatizados e checagem de tipos
```powershell
pnpm typecheck
pnpm test
```

### 3. Executar em modo desenvolvimento web (SQLite WASM offline)
```powershell
pnpm dev
```
Abra `http://localhost:1420` no navegador.

### 4. Executar o aplicativo desktop nativo Windows (Tauri 2 + SQLite nativo)
*(requer Rust instalado)*
```powershell
pnpm tauri:dev
```

### 5. Gerar instalador Windows (`.msi` / `.exe` NSIS)
*(requer Rust instalado)*
```powershell
pnpm tauri:build
```

## O que está pronto nesta versão (MVP 1 + bases de MVP 2 e 3)
- **Configuração inicial (Onboarding)**: modo CLT/Aplicativos/TI, dias/semana, metas, regra de fins de semana com filho e opção explícita de dados demo.
- **Dashboard (`Hoje`)**: calculado em tempo real do SQLite com saldo, receitas/despesas do mês, progresso de meta, resumo semanal Uber/99, agenda de hoje, tarefas prioritárias, hábitos, estudos/carreira e próximos fins de semana com o filho, além dos 5 atalhos rápidos (`+ Transação`, `+ Jornada Uber/99`, `+ Compromisso`, `+ Tarefa`, `+ Ideia`).
- **Calendário & Tarefas**: FullCalendar (MIT) em `pt-BR` com visões Dia/Semana/Mês, arrastar/redimensionar persistido no SQLite, aplicação de templates semanais (`apps_5d`, `apps_4d`, `apps_6d`, `clt`, `ti`) e gerenciador de tarefas.
- **Financeiro Pessoal**: contas, categorias, receitas/despesas/transferências, origem separada (salário, aplicativos, serviços TI, outros), previsto vs realizado, parcelamento mensal com precisão de centavos e metas de reserva.
- **Trabalho por Aplicativos**: registro de jornadas Uber Moto / 99Moto (sem iFood), gestão de motos e despesas da moto, indicadores por hora/km (semana, 7 e 30 dias) e Simulador de Cenários (4/5/6 dias + parcela da moto).
- **Saúde & Hábitos**, **Família**, **Estudos & Carreira TI**, **Ideias (Kanban) & Revisão Semanal**: todos com CRUD real no SQLite.
- **Configurações & Backup**: alternância de tema (escuro/claro), troca de modo de rotina, exportação/restauração atômica de Backup JSON validado, exportação `.sqlite` e limpeza controlada.

## Próximo backlog (planejado)
- Compilar e testar o instalador Windows `.msi`/`.exe` após instalar Rust (`rustup`).
- Importação de extratos CSV/OFX com detecção de duplicidades.
- Lembretes nativos do Windows (`tauri-plugin-notification`) sem expor valores financeiros sensíveis.
- Sincronização opcional com smartphone e integração Google Calendar mediante consentimento explícito.
