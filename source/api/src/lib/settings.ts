import { defaultSettings, SETTING_DEFS, validateSetting, type SettingKey, type SettingsMap } from '@bcis/shared';
import type { Ctx } from './context';
import type { DbOrTx } from '../db/client';
import { applicationSettings } from '../db/schema';
import { audit } from './audit';
import { invalid } from './errors';

export async function getSettings(db: DbOrTx): Promise<SettingsMap> {
  const settings = defaultSettings();
  for (const row of await db.select().from(applicationSettings)) {
    if (row.key in settings) settings[row.key as SettingKey] = row.value as string | number | boolean;
  }
  return settings;
}

export async function updateSettings({ db, actor }: Ctx, values: Record<string, string | number | boolean>): Promise<SettingsMap> {
  const before = await getSettings(db);
  const changes: [SettingKey, string | number | boolean][] = [];
  for (const [key, value] of Object.entries(values)) {
    const def = SETTING_DEFS.find((d) => d.key === key);
    if (!def) throw invalid(`Unknown setting "${key}".`);
    const error = validateSetting(def, value);
    if (error) throw invalid(error, { [key]: error });
    if (before[def.key] !== value) changes.push([def.key, value]);
  }
  await db.transaction(async (tx) => {
    for (const [key, value] of changes) {
      await tx
        .insert(applicationSettings)
        .values({ key, value, updatedBy: actor.id })
        .onConflictDoUpdate({ target: applicationSettings.key, set: { value, updatedBy: actor.id, updatedAt: new Date() } });
      await audit(tx, actor, { action: 'settings.update', entityType: 'setting', entityId: key, oldValues: { value: before[key] }, newValues: { value } });
    }
  });
  return getSettings(db);
}
