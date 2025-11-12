import { cn } from "@/lib/utils"
import { silkscreenSizes, type SilkscreenSize } from "@/lib/font-sizes"

interface ScoutTextProps {
  size?: SilkscreenSize
  className?: string
  children?: React.ReactNode
}

export function ScoutText({
  size = 'base',
  className,
  children = "Scout"
}: ScoutTextProps) {
  return (
    <span className={cn(
      silkscreenSizes[size],
      "font-bold text-foreground",
      className
    )}>
      {children}
    </span>
  )
}