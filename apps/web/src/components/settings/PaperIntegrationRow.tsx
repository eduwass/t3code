// T3 Space fork: the switch for everything Paper.
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function PaperIntegrationRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("paper-integration")}
      settingKeys={["paperIntegrationEnabled"]}
      description="Show the Paper frames an agent drew as thumbnails in the thread, each linking to that frame in Paper. Applies on every device connected to this machine."
      control={
        <ScopedSwitch
          settingKeys={["paperIntegrationEnabled"]}
          checked={settings.paperIntegrationEnabled}
          onCheckedChange={(checked) =>
            updateSettings({ paperIntegrationEnabled: Boolean(checked) })
          }
          aria-label="Paper integration"
        />
      }
    />
  );
}
