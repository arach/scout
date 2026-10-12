-- Applies only to the terminal opened by Scout's HUD launcher.
o.window({ class = "^com[.]openscout[.]hud$" }, {
  float = true,
  pin = true,
  tag = "-default-opacity",
  opacity = "1 override 1 override",
  size = { 560, "monitor_h * 0.82" },
  move = { 36, "monitor_h * 0.09" },
})
