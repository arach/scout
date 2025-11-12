import { Mic } from "lucide-react"
import { cn } from "@/lib/utils"
import { silkscreenSizes, type SilkscreenSize } from "@/lib/font-sizes"

interface ScoutLogoProps {
  size?: SilkscreenSize
  showIcon?: boolean
  className?: string
  iconClassName?: string
  textClassName?: string
}

export function ScoutLogo({
  size = 'xl',
  showIcon = true,
  className,
  iconClassName,
  textClassName
}: ScoutLogoProps) {
  const iconDimensions = {
    xs: { container: 'w-6 h-6', icon: 14 },
    sm: { container: 'w-7 h-7', icon: 16 },
    base: { container: 'w-8 h-8', icon: 18 },
    lg: { container: 'w-8 h-8', icon: 20 },
    xl: { container: 'w-8 h-8', icon: 20 },
    '2xl': { container: 'w-10 h-10', icon: 24 },
  }

  const dimensions = iconDimensions[size]

  return showIcon ? (
    <div className={cn("flex items-center space-x-2", className)}>
      <div className={cn(
        dimensions.container,
        "bg-primary rounded-lg flex items-center justify-center",
        iconClassName
      )}>
        <Mic className={cn("text-primary-foreground")} style={{ width: dimensions.icon, height: dimensions.icon }} />
      </div>
      <span className={cn(
        silkscreenSizes[size],
        "font-bold text-foreground",
        textClassName
      )}>
        Scout
      </span>
    </div>
  ) : (
    <span className={cn(
      silkscreenSizes[size],
      "font-bold text-foreground",
      className,
      textClassName
    )}>
      Scout
    </span>
  )
}