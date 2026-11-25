import type { ThemeMode, UiSkin } from '../types/domain';

export type SkinGroup = 'reference' | 'classic';

export interface SkinDefinition {
  id: UiSkin;
  name: string;
  tagline: string;
  vibe: string;
  group: SkinGroup;
  sourceRef?: string;
  preferredTheme: ThemeMode;
  swatches: [string, string, string]; // [background, card/sidebar, accent]
}

export const UI_SKINS: SkinDefinition[] = [
  // =========================================================================
  // Skins criadas com base nas imagens de referencias-de-design/
  // =========================================================================
  {
    id: 'ref_agenda_verde',
    name: '01 · Agenda Verde (Editorial)',
    tagline: 'Papel alabastro quente, títulos serifados clássicos, divisórias finas e verde-floresta profundo.',
    vibe: 'Editorial',
    group: 'reference',
    sourceRef: '01-agenda-verde/hoje.png · calendario.png',
    preferredTheme: 'light',
    swatches: ['#f6f5f0', '#ffffff', '#1f513b'],
  },
  {
    id: 'ref_trabalho_salvia',
    name: '01B · Trabalho Sálvia (Noite)',
    tagline: 'Pinheiro-carvão noturno com títulos serifados, divisórias limpas e destaques em verde-sálvia luminoso.',
    vibe: 'Noturno',
    group: 'reference',
    sourceRef: '01-agenda-verde/trabalho.png',
    preferredTheme: 'dark',
    swatches: ['#0c1714', '#13221d', '#85c97a'],
  },
  {
    id: 'ref_linhas_dia',
    name: '02A · Linhas do Dia (Metrô)',
    tagline: 'Cartaz gráfico em papel creme, bordas pretas marcantes, títulos ultra-bold e laranja vermelhão.',
    vibe: 'Poster',
    group: 'reference',
    sourceRef: '02-mapa-e-relogio/linhas-do-dia.png',
    preferredTheme: 'light',
    swatches: ['#fbf3dc', '#fffaf0', '#f2541b'],
  },
  {
    id: 'ref_relogio_noturno',
    name: '02B · Tempo Livre (Relógio)',
    tagline: 'Azul-noite astronômico, serifas elegantes em marfim, linhas prateadas finas e acento amarelo-lua.',
    vibe: 'Astronômico',
    group: 'reference',
    sourceRef: '02-mapa-e-relogio/tempo-livre.png',
    preferredTheme: 'dark',
    swatches: ['#0e1021', '#151830', '#f5e060'],
  },
  {
    id: 'ref_essencial',
    name: '03 · Agenda Essencial',
    tagline: 'Minimalismo calmo com barra pedra quente, fundo branco puro e destaque terracota elegante.',
    vibe: 'Minimalista',
    group: 'reference',
    sourceRef: '03-agenda-essencial/lifehub-desktop.png',
    preferredTheme: 'light',
    swatches: ['#f5f3ef', '#ffffff', '#9d3b2b'],
  },
  {
    id: 'ref_agenda_azul',
    name: '04A · Agenda Azul (Clean)',
    tagline: 'Barra lateral azul-gelo suave, canvas branco nítido e acento azul-cobalto produtivo.',
    vibe: 'Clean',
    group: 'reference',
    sourceRef: '04-agenda-jornada-caderno/agenda-desktop.png',
    preferredTheme: 'light',
    swatches: ['#eef3f8', '#ffffff', '#2563a6'],
  },
  {
    id: 'ref_jornada_menta',
    name: '04B · Jornada Noturna (Menta)',
    tagline: 'Grafite escuro confortável com painéis verde-musgo e botões suaves em verde-menta.',
    vibe: 'Foco Apps',
    group: 'reference',
    sourceRef: '04-agenda-jornada-caderno/jornada-desktop.png',
    preferredTheme: 'dark',
    swatches: ['#15191d', '#22312e', '#b7d9c6'],
  },
  {
    id: 'ref_caderno_oliva',
    name: '04C · Caderno Papel (Oliva)',
    tagline: 'Folha de caderno marfim sobre linho bege, títulos serifados e acento verde-oliva sereno.',
    vibe: 'Caderno',
    group: 'reference',
    sourceRef: '04-agenda-jornada-caderno/caderno-desktop.png',
    preferredTheme: 'light',
    swatches: ['#f4f2ec', '#fdfcf9', '#4b5d47'],
  },
  {
    id: 'ref_foto_laranja',
    name: '05 · Fotografia & Laranja',
    tagline: 'Contraste editorial branco e cinza-pedra, tipografia forte em preto-carvão e laranja vibrante.',
    vibe: 'Editorial',
    group: 'reference',
    sourceRef: '05-fotografia-e-laranja/hoje.png · jornadas.png',
    preferredTheme: 'light',
    swatches: ['#ffffff', '#f3f2ef', '#ef5a24'],
  },

  // =========================================================================
  // Skins anteriores preservadas (Orbital padrão + 5 skins clássicas)
  // =========================================================================
  {
    id: 'orbital',
    name: 'Orbital (Padrão)',
    tagline: 'Visual original preservado: índigo moderno, profundidade suave e cantos arredondados.',
    vibe: 'Moderno',
    group: 'classic',
    preferredTheme: 'dark',
    swatches: ['#070b14', '#0e1526', '#6366f1'],
  },
  {
    id: 'emerald_noir',
    name: 'Esmeralda Noir',
    tagline: 'Grafite esmeralda executivo com destaque financeiro verde-menta e contraste limpo.',
    vibe: 'Executivo',
    group: 'classic',
    preferredTheme: 'dark',
    swatches: ['#050d0a', '#0b1813', '#10b981'],
  },
  {
    id: 'amber_carbon',
    name: 'Carbono & Âmbar',
    tagline: 'Painel industrial escuro com fibra carbono, cantos firmes e acento âmbar/laranja.',
    vibe: 'Moto / Tech',
    group: 'classic',
    preferredTheme: 'dark',
    swatches: ['#0c0a09', '#171412', '#f59e0b'],
  },
  {
    id: 'cyber_neon',
    name: 'Cyber Terminal',
    tagline: 'Violeta profundo com brilho neon ciano/magenta e tipografia técnica estilo terminal.',
    vibe: 'Dev / TI',
    group: 'classic',
    preferredTheme: 'dark',
    swatches: ['#090514', '#140c29', '#06b6d4'],
  },
  {
    id: 'nordic_frost',
    name: 'Nórdico Fosco',
    tagline: 'Ardósia calma com contraste suave para conforto visual em jornadas longas.',
    vibe: 'Minimalista',
    group: 'classic',
    preferredTheme: 'dark',
    swatches: ['#181f2a', '#212b3a', '#38bdf8'],
  },
  {
    id: 'retro_classic',
    name: 'Clássico 98 / Winamp',
    tagline: 'Cantos retos, bordas chanfradas 3D e estética nostálgica das skins clássicas de PC.',
    vibe: 'Retrô',
    group: 'classic',
    preferredTheme: 'dark',
    swatches: ['#1b1e24', '#262b33', '#22c55e'],
  },
];

export const REFERENCE_SKINS: SkinDefinition[] = UI_SKINS.filter((s) => s.group === 'reference');
export const CLASSIC_SKINS: SkinDefinition[] = UI_SKINS.filter((s) => s.group === 'classic');
export const VALID_SKIN_IDS: readonly UiSkin[] = UI_SKINS.map((s) => s.id);
