"use client";

import { Gamepad2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTheme, type ThemeView } from "@/components/theme-provider";

export default function ThemeBar() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className={cn(
        "border-b border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80",
        "theme8bit:border-b-4 theme8bit:border-black theme8bit:bg-[#262b44] theme8bit:shadow-[0_4px_0_#000] theme8bit:backdrop-blur-none",
      )}
    >
      <div className="mx-auto flex w-full max-w-7xl items-center justify-end px-4 py-2 sm:px-6">
        <ToggleGroup
          variant="outline"
          value={[theme]}
          onValueChange={(value) => {
            const next = value[0] as ThemeView | undefined;
            if (next) setTheme(next);
          }}
          className="theme8bit:border-2 theme8bit:border-black theme8bit:shadow-[3px_3px_0_#000]"
        >
          <ToggleGroupItem
            value="normal"
            aria-label="Normal view"
            className="theme8bit:data-[state=on]:translate-x-px theme8bit:data-[state=on]:translate-y-px theme8bit:data-[state=on]:shadow-none"
          >
            Normal
          </ToggleGroupItem>
          <ToggleGroupItem
            value="8bit"
            aria-label="8-bit view"
            className="theme8bit:data-[state=on]:translate-x-px theme8bit:data-[state=on]:translate-y-px theme8bit:data-[state=on]:shadow-none"
          >
            <Gamepad2 className="size-3.5" />
            8-Bit
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
}
