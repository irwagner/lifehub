import type { UiSkin } from '../types/domain';

export interface SkinDefinition {
  id: UiSkin;
  name: string;
  tagline: string;
  vibe: string;
  swatches: [string, string, string]; // [background, card, accent]
}

export const UI_SKINS: SkinDefinition[] = [
  {
    id: 'orbital',
    name: 'Orbital (Padrão)',
    tagline: 'Visual atual preservado: índigo moderno, profundidade suave e cantos arredondados.',
    vibe: 'Moderno',
    swatches: ['#070b14', '#0e1526', '#6366f1'],
  },
  {
    id: 'emerald_noir',
    name: 'Esmeralda Noir',
    tagline: 'Grafite esmeralda executivo com destaque financeiro verde-menta e contraste limpo.',
    vibe: 'Executivo',
    swatches: ['#050d0a', '#0b1813', '#10b981'],
  },
  {
    id: 'amber_carbon',
    name: 'Carbono & Âmbar',
    tagline: 'Painel industrial escuro com fibra carbono, cantos firmes e acento âmbar/laranja.',
    vibe: 'Moto / Tech',
    swatches: ['#0c0a09', '#171412', '#f59e0b'],
  },
  {
    id: 'cyber_neon',
    name: 'Cyber Terminal',
    tagline: 'Violeta profundo com brilho neon ciano/magenta e tipografia técnica estilo terminal.',
    vibe: 'Dev / TI',
    swatches: ['#090514', '#140c29', '#06b6d4'],
  },
  {
    id: 'nordic_frost',
    name: 'Nórdico Fosco',
    tagline: 'Ardósia calma com contraste suave para conforto visual em jornadas longas.',
    vibe: 'Minimalista',
    swatches: ['#181f2a', '#212b3a', '#38bdf8'],
  },
  {
    id: 'retro_classic',
    name: 'Clássico 98 / Winamp',
    tagline: 'Cantos retos, bordas chanfradas 3D e estética nostálgica das skins clássicas de PC.',
    vibe: 'Retrô',
    swatches: ['#1b1e24', '#262b33', '#22c55e'],
  },
];

export const VALID_SKIN_IDS: readonly UiSkin[] = UI_SKINS.map((s) => s.id);
