// T3 Space fork: Paper's "agent is working" mark, six squares that drip like rain.
import { useEffect, useState } from "react";
import { Animated, Easing, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

const COLUMNS = 3;
const ROWS = 2;
const SIZE = 3;
const FRAME_MS = 1000 / 60;
const COLOR = "#6E9BFF";

/** Same timing as Paper's: each column drips about every 0.8s at its own speed, from a random point. */
function makeDrops() {
  return Array.from({ length: COLUMNS }, (_, column) => {
    const duration = (5 / (0.1 * (0.85 + Math.random() * 0.3))) * FRAME_MS;
    const start = Math.random() * duration;
    return Array.from({ length: ROWS }, (_, row) => {
      const value = new Animated.Value(0);
      const animation = Animated.sequence([
        Animated.delay((start + (row / 5) * duration) % duration),
        Animated.loop(
          Animated.timing(value, {
            toValue: 1,
            duration,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ),
      ]);
      const opacity = value.interpolate({
        inputRange: [0, 0.18, 0.27, 0.33, 0.39, 0.48, 1],
        outputRange: [1, 0.97, 0.69, 0.31, 0.08, 0, 0],
      });
      return { id: `${column}:${row}`, animation, opacity };
    });
  });
}

export function PaperRain() {
  const reduceMotion = useReducedMotion();
  const [columns] = useState(makeDrops);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the native animation loops only while mounted
  useEffect(() => {
    if (reduceMotion) return;
    const drops = columns.flat();
    for (const drop of drops) drop.animation.start();
    return () => {
      for (const drop of drops) drop.animation.stop();
    };
  }, [columns, reduceMotion]);
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Drawing in Paper"
      style={{ flexDirection: "row", gap: SIZE }}
    >
      {columns.map((column) => (
        <View key={column[0]!.id} style={{ gap: SIZE }}>
          {column.map((drop) => (
            <Animated.View
              key={drop.id}
              style={{
                width: SIZE,
                height: SIZE,
                backgroundColor: COLOR,
                opacity: reduceMotion ? 0.8 : drop.opacity,
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
