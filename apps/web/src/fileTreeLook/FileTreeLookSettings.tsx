// T3 Space fork: the Labs switch and the Appearance section for file trees.
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { searchableSetting } from "../components/settings/settingsSearch";
import {
  DIFF_TREE_ON_OPEN,
  FILE_TREE_FOLDERS,
  FILE_TREE_FONTS,
  FILE_TREE_ICON_PACKS,
  useFileTreeLookSettings,
  type FileTreeLook,
} from "./fileTreeLook";

const FONT_LABELS = { default: "T3 default", interface: "Interface font", code: "Code font" };
const ICON_LABELS = {
  t3: "T3 (default)",
  material: "Material Icon Theme",
  complete: "Pierre complete",
  standard: "Pierre standard",
  minimal: "Pierre minimal",
};
const FOLDER_LABELS = { default: "T3 default", icons: "Folder icons", both: "Arrows and icons" };
const DIFF_TREE_LABELS = { remember: "As I left it", open: "Open", closed: "Closed" };
const SIZES = [0, 11, 12, 13, 14, 15];
const INDENTS = [0, 4, 8, 12, 16, 20];
const pixels = (value: number) => (value === 0 ? "T3 default" : `${value}px`);

export function FileTreeLookLabsRow() {
  const [settings, setSettings] = useFileTreeLookSettings();
  return (
    <SettingsRow
      {...searchableSetting("file-tree-look")}
      description="Tune file trees: font, size, indent, icon pack, whether changed files in chat start expanded, and whether a diff opens with its file tree. The settings appear under Appearance. This device only."
      control={
        <Switch
          checked={settings.enabled}
          onCheckedChange={(checked) => setSettings({ ...settings, enabled: Boolean(checked) })}
          aria-label="File tree tuning"
        />
      }
    />
  );
}

function ChoiceControl<T extends string | number>(props: {
  label: string;
  value: T;
  options: ReadonlyArray<T>;
  format: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <Select
      value={String(props.value)}
      onValueChange={(raw) => {
        const next = props.options.find((option) => String(option) === raw);
        if (next !== undefined) props.onChange(next);
      }}
    >
      <SelectTrigger size="sm" className="w-full min-w-0 sm:w-44" aria-label={props.label}>
        <SelectValue>{props.format(props.value)}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {props.options.map((option) => (
          <SelectItem key={String(option)} value={String(option)}>
            {props.format(option)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function FileTreeLookSection() {
  const [settings, setSettings] = useFileTreeLookSettings();
  if (!settings.enabled) return null;
  const set = (patch: Partial<FileTreeLook>) => setSettings({ ...settings, ...patch });
  return (
    <SettingsSection id="appearance-file-trees" title="File trees">
      <SettingsRow
        title="Font"
        description="The Files panel and diff trees use the interface font by default; changed files in chat use the code font."
        control={
          <ChoiceControl
            label="File tree font"
            value={settings.font}
            options={FILE_TREE_FONTS}
            format={(value) => FONT_LABELS[value]}
            onChange={(font) => set({ font })}
          />
        }
      />
      <SettingsRow
        title="Font size"
        control={
          <ChoiceControl
            label="File tree font size"
            value={settings.fontSize}
            options={SIZES}
            format={pixels}
            onChange={(fontSize) => set({ fontSize })}
          />
        }
      />
      <SettingsRow
        title="Indent"
        description="How far each folder level is indented."
        control={
          <ChoiceControl
            label="File tree indent"
            value={settings.indent}
            options={INDENTS}
            format={pixels}
            onChange={(indent) => set({ indent })}
          />
        }
      />
      <SettingsRow
        title="Icon pack"
        description="T3 adds icons for documents and more languages to Pierre complete. Material Icon Theme matches VS Code's extension, named folders included. Minimal shows one file icon."
        control={
          <ChoiceControl
            label="File icon pack"
            value={settings.icons}
            options={FILE_TREE_ICON_PACKS}
            format={(value) => ICON_LABELS[value]}
            onChange={(icons) => set({ icons })}
          />
        }
      />
      <SettingsRow
        title="Folders"
        description="Folder icons swap each arrow for an open or closed folder. Arrows and icons shows both, like VS Code."
        control={
          <ChoiceControl
            label="Folders"
            value={settings.folders}
            options={FILE_TREE_FOLDERS}
            format={(value) => FOLDER_LABELS[value]}
            onChange={(folders) => set({ folders })}
          />
        }
      />
      <SettingsRow
        title="Colored icons"
        description="Color file icons by type. Off, they follow the text color."
        control={
          <Switch
            checked={settings.colored}
            onCheckedChange={(checked) => set({ colored: Boolean(checked) })}
            aria-label="Colored file icons"
          />
        }
      />
      <SettingsRow
        title="Expand changed files in chat"
        description="Changed-files blocks start with every folder open. Each block's collapse button still remembers its own state."
        control={
          <Switch
            checked={settings.inlineExpanded}
            onCheckedChange={(checked) => set({ inlineExpanded: Boolean(checked) })}
            aria-label="Expand changed files in chat"
          />
        }
      />
      <SettingsRow
        title="Diff file tree"
        description="Whether a diff or pull request opens with its file tree. As I left it remembers the last toggle."
        control={
          <ChoiceControl
            label="Diff file tree on open"
            value={settings.diffTreeOnOpen}
            options={DIFF_TREE_ON_OPEN}
            format={(value) => DIFF_TREE_LABELS[value]}
            onChange={(diffTreeOnOpen) => set({ diffTreeOnOpen })}
          />
        }
      />
      <SettingsRow
        title="All files button in diffs"
        description="A button at the top right of a diff's file tree switches between changed files and every project file. Changed files open their diff; others open in the file viewer."
        control={
          <Switch
            checked={settings.diffAllFilesToggle}
            onCheckedChange={(checked) => set({ diffAllFilesToggle: Boolean(checked) })}
            aria-label="All files button in diffs"
          />
        }
      />
    </SettingsSection>
  );
}
