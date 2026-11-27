import { describe, expect, it } from 'vitest';
import { createInMemoryTestDatabase } from '../db/client';
import { createStudyTrack, deleteStudyTrack, listStudyTracks } from '../repositories/careerRepo';
import {
  ALL_MODULES_ENABLED,
  USER_PROFILE_PRESETS,
  isNavSectionEnabled,
  loadModulesConfig,
  saveModulesConfig,
} from '../services/modulesConfig';

describe('Personalização Universal de Módulos & Trilhas Customizadas (v0.6.0)', () => {
  it('mantém todos os módulos ativos para usuários antigos e aplica presets limpos para novos usuários', () => {
    const legacy = loadModulesConfig({ onboardingCompleted: true });
    expect(legacy).toEqual(ALL_MODULES_ENABLED);

    const fresh = loadModulesConfig({ onboardingCompleted: false });
    expect(fresh.work_apps).toBe(false);
    expect(fresh.health).toBe(true);
    expect(fresh.career).toBe(true);

    const generalPreset = USER_PROFILE_PRESETS.find((p) => p.id === 'general')!;
    expect(isNavSectionEnabled('work', generalPreset.modules)).toBe(false);
    expect(isNavSectionEnabled('finance', generalPreset.modules)).toBe(true);
    expect(isNavSectionEnabled('calendar', generalPreset.modules)).toBe(true);

    const appsPreset = USER_PROFILE_PRESETS.find((p) => p.id === 'apps')!;
    expect(isNavSectionEnabled('work', appsPreset.modules)).toBe(true);

    const saved = saveModulesConfig({ ...generalPreset.modules, career: true });
    expect(saved.career).toBe(true);
    expect(saved.work_apps).toBe(false);
  });

  it('permite criar e remover trilhas de estudo de qualquer área (não só TI)', async () => {
    const db = await createInMemoryTestDatabase();
    const created = await createStudyTrack(db, {
      name: 'Inglês Conversação',
      target_hours: 30,
    });
    expect(created.name).toBe('Inglês Conversação');
    expect(created.target_hours).toBe(30);

    const list1 = await listStudyTracks(db);
    expect(list1.some((t) => t.id === created.id)).toBe(true);

    await deleteStudyTrack(db, created.id);
    const list2 = await listStudyTracks(db);
    expect(list2.some((t) => t.id === created.id)).toBe(false);

    await db.close();
  });
});
