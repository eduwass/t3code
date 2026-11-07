// T3 Space fork: the switches for everything Paper.
import { PaperConnectionsGroup } from "./PaperConnectionsGroup";
import { ScopedSwitch } from "./ScopedSwitch";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function PaperIntegrationRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const environmentId = useSettingsScope().target?.environmentId ?? null;
  return (
    <>
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
      {settings.paperIntegrationEnabled && environmentId !== null ? (
        <div className="px-4 py-3 sm:px-5">
          <PaperConnectionsGroup environmentId={environmentId} />
        </div>
      ) : null}
      {settings.paperIntegrationEnabled ? (
        <SettingsRow
          serverScoped
          {...searchableSetting("paper-live-frames")}
          settingKeys={["paperLiveFramesEnabled"]}
          description="Open thumbnails as the real frame, rendered as HTML, so it stays sharp at any zoom. Uses whichever Paper connection is in use. Right-click a thumbnail to try one."
          control={
            <ScopedSwitch
              settingKeys={["paperLiveFramesEnabled"]}
              checked={settings.paperLiveFramesEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ paperLiveFramesEnabled: Boolean(checked) })
              }
              aria-label="Live Paper frames"
            />
          }
        />
      ) : null}
    </>
  );
}
