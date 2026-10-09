import { type IconName, type IconShape, iconShapes } from "./icon-data";

export type { IconName };

function shapeKey(shape: IconShape): string {
  return shape.tag === "path" ? shape.d : JSON.stringify(shape);
}

export function Icon({ name, size }: { name: IconName; size?: "xs" | "sm" | "lg" }) {
  return (
    <svg
      className={size ? `ui-icon ui-icon--${size}` : "ui-icon"}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {(iconShapes[name] ?? []).map((shape) => {
        switch (shape.tag) {
          case "path":
            return <path key={shapeKey(shape)} d={shape.d} />;
          case "circle":
            return <circle key={shapeKey(shape)} cx={shape.cx} cy={shape.cy} r={shape.r} />;
          case "rect":
            return (
              <rect
                key={shapeKey(shape)}
                x={shape.x}
                y={shape.y}
                width={shape.width}
                height={shape.height}
                rx={shape.rx}
              />
            );
          default:
            return null;
        }
      })}
    </svg>
  );
}
