import type { RoutineMode } from '../types/domain';

export type OptionalModuleKey = 'work_apps' | 'health' | 'family' | 'career' | 'ideas';

export interface LifeHubModulesConfig {
  work_apps: boolean;
  health: boolean;
  family: boolean;
  career: boolean;
  ideas: boolean;
  updatedAt?: string;
}

export interface ModuleDefinition {
  key: OptionalModuleKey;
  label: string;
  shortLabel: string;
  description: string;
}

export const OPTIONAL_MODULES: readonly ModuleDefinition[] = [
  {
    key: 'work_apps',
    label: 'Trabalho por Aplicativos / Autônomo (KM e Veículo)',
    shortLabel: 'Apps & Veículo',
    description: 'Controle de jornadas por hora/km (Uber Moto, 99Moto, entregas ou serviços), combustível e manutenção.',
  },
  {
    key: 'health',
    label: 'Saúde & Hábitos',
    shortLabel: 'Saúde & Hábitos',
    description: 'Acompanhamento de academia, corrida, sono, água e consistência semanal sem pressão.',
  },
  {
    key: 'family',
    label: 'Família & Tempo Livre',
    shortLabel: 'Família',
    description: 'Proteção de fins de semana reservados, passeios, checklists e planejamento familiar.',
  },
  {
    key: 'career',
    label: 'Estudos, Carreira & Projetos',
    shortLabel: 'Estudos & Carreira',
    description: 'Trilhas de estudo personalizadas (faculdade, concursos, idiomas, TI), vagas e portfólio.',
  },
  {
    key: 'ideas',
    label: 'Ideias & Revisão Semanal',
    shortLabel: 'Ideias & Revisão',
    description: 'Captura rápida de ideias por impacto/esforço e balanço semanal guiado.',
  },
] as const;

export type UserProfilePresetId = 'general' | 'clt' | 'apps' | 'career_focus';

export interface UserProfilePreset {
  id: UserProfilePresetId;
  title: string;
  desc: string;
  routineMode: RoutineMode;
  modules: Omit<LifeHubModulesConfig, 'updatedAt'>;
}

export const USER_PROFILE_PRESETS: readonly UserProfilePreset[] = [
  {
    id: 'general',
    title: 'Uso Pessoal / Dia a Dia',
    desc: 'Finanças, contas fixas, cartões, agenda, hábitos e metas sem telas extras.',
    routineMode: 'clt',
    modules: {
      work_apps: false,
      health: true,
      family: true,
      career: false,
      ideas: true,
    },
  },
  {
    id: 'clt',
    title: 'Emprego Fixo / CLT',
    desc: 'Rotina comercial equilibrada com finanças, saúde, família e estudos.',
    routineMode: 'clt',
    modules: {
      work_apps: false,
      health: true,
      family: true,
      career: true,
      ideas: true,
    },
  },
  {
    id: 'apps',
    title: 'Autônomo / Aplicativos',
    desc: 'Controle completo de jornadas, ganhos líquidos por hora/km, combustível e veículo.',
    routineMode: 'apps',
    modules: {
      work_apps: true,
      health: true,
      family: true,
      career: true,
      ideas: true,
    },
  },
  {
    id: 'career_focus',
    title: 'Estudante / Carreira',
    desc: 'Foco em trilhas de estudo (faculdade, concursos, TI, idiomas), projetos e vagas.',
    routineMode: 'ti',
    modules: {
      work_apps: false,
      health: true,
      family: false,
      career: true,
      ideas: true,
    },
  },
] as const;

export const MODULES_CONFIG_STORAGE_KEY = 'lifehub_modules_config_v1';

export const ALL_MODULES_ENABLED: LifeHubModulesConfig = {
  work_apps: true,
  health: true,
  family: true,
  career: true,
  ideas: true,
};

export const UNIVERSAL_DEFAULT_MODULES: LifeHubModulesConfig = {
  work_apps: false,
  health: true,
  family: true,
  career: true,
  ideas: true,
};

export function loadModulesConfig(options?: { onboardingCompleted?: boolean }): LifeHubModulesConfig {
  try {
    const raw = localStorage.getItem(MODULES_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LifeHubModulesConfig>;
      return {
        work_apps: Boolean(parsed.work_apps),
        health: parsed.health !== false,
        family: parsed.family !== false,
        career: parsed.career !== false,
        ideas: parsed.ideas !== false,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
      };
    }
  } catch {
    // ignore storage errors
  }
  // Existing users who already finished onboarding keep all modules active by default (zero disruption)
  if (options?.onboardingCompleted) {
    return { ...ALL_MODULES_ENABLED };
  }
  return { ...UNIVERSAL_DEFAULT_MODULES };
}

export function saveModulesConfig(cfg: LifeHubModulesConfig): LifeHubModulesConfig {
  const normalized: LifeHubModulesConfig = {
    work_apps: Boolean(cfg.work_apps),
    health: Boolean(cfg.health),
    family: Boolean(cfg.family),
    career: Boolean(cfg.career),
    ideas: Boolean(cfg.ideas),
    updatedAt: cfg.updatedAt ?? new Date().toISOString(),
  };
  try {
    localStorage.setItem(MODULES_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // ignore storage quota errors
  }
  return normalized;
}

export function isNavSectionEnabled(
  section: string,
  modules: LifeHubModulesConfig,
): boolean {
  if (section === 'work') return modules.work_apps;
  if (section === 'health') return modules.health;
  if (section === 'family') return modules.family;
  if (section === 'career') return modules.career;
  if (section === 'ideas') return modules.ideas;
  return true;
}
