import { useEffect, useRef } from "react";
import { View } from "react-native";

import {
  ComposerDictationCancelAction,
  ComposerDictationPrimaryAction,
  ComposerDictationStartAction,
  ComposerDictationStatus,
  ComposerDictationToolbar,
} from "./ComposerDictationControl";
import { useVoiceInputController } from "./useVoiceInputController";
import { resolveVoiceComposerPresentation } from "./voiceInputPresentation";

/**
 * Dictation for a question's custom answer. Render it right after the answer
 * input, inside a relative wrapper around both: the idle microphone sits
 * over the input's bottom-right corner and the recording controls cover the
 * input. The transcript is appended to the answer.
 */
export function QuestionDictation(props: {
  readonly ownerKey: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly disabled: boolean;
}) {
  const value = useRef(props.value);
  const listeners = useRef(new Set<() => void>());
  useEffect(() => {
    value.current = props.value;
    for (const listener of listeners.current) listener();
  }, [props.value]);

  const voice = useVoiceInputController({
    ownerKey: props.ownerKey,
    label: "Answer",
    readDraftMessage: () => value.current,
    subscribeToDraftChanges: (onChange) => {
      listeners.current.add(onChange);
      return () => listeners.current.delete(onChange);
    },
    selection: { start: props.value.length, end: props.value.length },
    disabled: props.disabled,
    onChangeDraftMessage: props.onChangeText,
    onChangeSelection: () => {},
  });
  const presentation = resolveVoiceComposerPresentation(voice.state, voice.elapsedSeconds);

  if (presentation.statusLabel === null) {
    return voice.isAvailable ? (
      <View className="absolute right-1 bottom-[5px] z-10">
        <ComposerDictationStartAction
          state={voice.state}
          isAvailable={voice.isAvailable}
          disabled={props.disabled}
          onStart={voice.start}
          onCancel={voice.cancel}
        />
      </View>
    ) : null;
  }
  // While recording, the controls cover the answer box so they're visible
  // without scrolling; the box and its text come back when dictation ends.
  return (
    <View className="absolute inset-0 z-10 justify-center rounded-2xl border border-input-border bg-input">
      <ComposerDictationToolbar showsDictation>
        <View className="h-11 flex-row items-center">
          <ComposerDictationCancelAction presentation={presentation} onCancel={voice.cancel} />
          <ComposerDictationStatus
            audioLevels={voice.audioLevels}
            elapsedSeconds={voice.elapsedSeconds}
            phase={voice.state.phase}
            presentation={presentation}
            onDismissError={voice.cancel}
          />
          <ComposerDictationPrimaryAction
            state={voice.state}
            presentation={presentation}
            isAvailable={voice.isAvailable}
            disabled={props.disabled}
            onStart={voice.start}
            onConfirm={voice.stop}
            onCancel={voice.cancel}
          />
        </View>
      </ComposerDictationToolbar>
    </View>
  );
}
