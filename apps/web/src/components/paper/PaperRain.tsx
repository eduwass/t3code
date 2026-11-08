// T3 Space fork: Paper's "agent is working" mark, six squares that drip like rain.
import { useState } from "react";

import "./paperRain.css";

const COLUMNS = 3;
const ROWS = 2;
const FRAME_MS = 1000 / 60;

/** Same timing as Paper's: each column drips about every 0.8s at its own speed, from a random point. */
function drops() {
  return Array.from({ length: COLUMNS }, (_, column) => {
    const duration = (5 / (0.1 * (0.85 + Math.random() * 0.3))) * FRAME_MS;
    const start = -Math.random() * duration;
    return Array.from({ length: ROWS }, (_, row) => ({
      id: `${column}:${row}`,
      style: {
        animationDuration: `${duration}ms`,
        animationDelay: `${start + (row / 5) * duration}ms`,
      },
    }));
  });
}

export function PaperRain(props: { readonly label?: string }) {
  const [columns] = useState(drops);
  // Columns are laid out row by row: the grid fills left to right.
  const cells = Array.from({ length: ROWS }, (_, row) => columns.map((column) => column[row]!));
  return (
    <span data-paper-rain="" role="img" aria-label={props.label ?? "Drawing in Paper"}>
      {cells.flat().map((cell) => (
        <span key={cell.id} style={cell.style} />
      ))}
    </span>
  );
}
